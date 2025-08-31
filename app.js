// ===== Stato & persistenza =====
const state = {
  people: {},           // id -> { id, name, photo, parents: [id,id?], gender }
  spouses: [],          // [ [idA, idB], ... ]
  order: [],            // ordine rendering (ids)
  nextId: 1,
  transform: { x: 300, y: 120, k: 1 },
  selected: null,
  offsets: {}           // id -> { dx, dy } spostamenti manuali dei nodi
};

const STORAGE_KEY = 'family_tree_v2';

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    people: state.people,
    spouses: state.spouses,
    order: state.order,
    nextId: state.nextId,
    offsets: state.offsets
  }));
}

function normalizeAndAdoptState(data) {
  Object.values(data.people).forEach(p => { if (p.gender == null) p.gender = ''; });
  state.people  = data.people;
  state.spouses = data.spouses || [];
  state.order   = data.order;
  state.nextId  = data.nextId || (Math.max(0, ...state.order.map(Number)) + 1);
  state.offsets = data.offsets || {};
}

function loadState() {
  const CANDIDATE_KEYS = [
    'family_tree_v2', 'family_tree', 'albero_genealogico', 'tree_state'
  ];
  for (const key of CANDIDATE_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      if (!data || !data.people || !data.order) continue;
      normalizeAndAdoptState(data);
      saveState();
      return true;
    } catch {}
  }
  return false;
}

// --- loader da URL param o da file locale data.json (stessa origine) ---
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function parseSrcParam() {
  const u = new URL(window.location.href);
  const src = u.searchParams.get("src");
  return src ? src.trim() : "";
}

async function loadFromUrlIfPresent() {
  const src = parseSrcParam();
  if (src) {
    try {
      const data = await fetchJson(src);
      if (data && data.people && data.order) {
        normalizeAndAdoptState(data);
        saveState();
        return true;
      }
    } catch (e) {
      console.warn("Caricamento da ?src fallito:", e);
    }
  }
  try {
    const data = await fetchJson("./data.json?ts=" + Date.now());
    if (data && data.people && data.order) {
      normalizeAndAdoptState(data);
      saveState();
      return true;
    }
  } catch (_) {}
  return false;
}

// ===== Helpers =====
const byId = id => state.people[id];
const normPair = (a,b) => [String(a), String(b)].sort();

function uniquePushSpouse(a, b) {
  const [x,y] = normPair(a,b);
  if (x === y) return;
  if (!state.spouses.find(([i,j]) => i===x && j===y)) state.spouses.push([x,y]);
}

function removeSpouseLinksOf(id) {
  state.spouses = state.spouses.filter(([a,b]) => a!==id && b!==id);
}

function removeParentRefsTo(id) {
  for (const pid of state.order) {
    const ps = byId(pid).parents || [];
    byId(pid).parents = ps.filter(p => p !== id);
  }
}

// File -> dataURL
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// ===== Operazioni (qui manteniamo solo visualizzazione; CRUD UI può essere aggiunta) =====
async function addPerson(name, photoUrl, photoFile, parentA = null, parentB = null, spouseWith = null, gender = '') {
  const id = String(state.nextId++);
  let photo = (photoUrl || '').trim();
  if (photoFile) {
    try { photo = await fileToDataURL(photoFile); } catch {}
  }
  state.people[id] = { id, name: name.trim(), photo, parents: [], gender };
  if (parentA) state.people[id].parents.push(parentA);
  if (parentB && parentB !== parentA) state.people[id].parents.push(parentB);
  state.order.push(id);
  if (spouseWith) uniquePushSpouse(id, spouseWith);
  layout();
  render();
  saveState();
  return id;
}

function deleteSelected() {
  const id = state.selected;
  if (!id) { alert('Seleziona prima una persona'); return; }
  delete state.people[id];
  delete state.offsets[id];
  state.order = state.order.filter(x => x !== id);
  removeParentRefsTo(id);
  removeSpouseLinksOf(id);
  state.selected = null;
  layout(); render(); saveState();
}

// ===== Layout =====
function computeDepths() {
  const indeg = {}; const depth = {}; const children = {};
  for (const id of state.order) { indeg[id] = (byId(id).parents || []).length; children[id] = []; }
  for (const id of state.order) { for (const p of byId(id).parents) { if (children[p]) children[p].push(id); } }
  const q = [];
  for (const id of state.order) if (indeg[id] === 0) { depth[id] = 0; q.push(id); }
  while (q.length) {
    const u = q.shift();
    for (const v of children[u]) {
      depth[v] = Math.max(depth[v] ?? 0, (depth[u] ?? 0) + 1);
      indeg[v]--; if (indeg[v] === 0) q.push(v);
    }
  }
  for (const id of state.order) if (depth[id] == null) depth[id] = 0;
  return { depth };
}

const positions = {};
function layout() {
  const { depth } = computeDepths();
  const byLevel = {};
  for (const id of state.order) {
    const d = depth[id];
    if (!byLevel[d]) byLevel[d] = [];
    byLevel[d].push(id);
  }
  const levelGap = 220; const nodeGap = 260; // un po' più largo per schede
  for (const [lvl, arr] of Object.entries(byLevel)) {
    arr.forEach((id, i) => {
      positions[id] = { x: i * nodeGap, y: Number(lvl) * levelGap };
    });
  }
  for (const id of state.order) {
    const ps = byId(id).parents;
    if (ps && ps.length) {
      const xs = ps.map(p => positions[p]?.x).filter(x => x != null);
      if (xs.length) {
        const avg = xs.reduce((a,b)=>a+b,0)/xs.length;
        positions[id].x = avg;
      }
    }
  }
  const xs = Object.values(positions).map(p=>p.x);
  const minX = Math.min(...xs, 0);
  if (minX < 0) for (const id of state.order) positions[id].x -= minX;
}

function getPos(id) {
  const p = positions[id] || {x:0, y:0};
  const o = state.offsets[id] || {dx:0, dy:0};
  return { x: p.x + o.dx, y: p.y + o.dy };
}

// ===== Rendering =====
const canvas = document.getElementById('canvas');
const linksSvg = document.getElementById('links');

function render() {
  canvas.querySelectorAll('.node').forEach(n => n.remove());
  for (const id of state.order) {
    const p = byId(id); const pos = getPos(id);
    const node = document.createElement('div');
    node.className = 'node ' + (p.gender === 'M' ? 'male' : p.gender === 'F' ? 'female' : '');
    node.style.left = (pos.x + 30) + 'px'; node.style.top = (pos.y + 30) + 'px';
    node.dataset.id = id;
    node.innerHTML = `
      <div class="person-card">
        <span class="badge-sex">${p.gender || ''}</span>
        <img class="avatar" src="${p.photo || 'https://via.placeholder.com/200?text=Foto'}" alt="${p.name}">
        <div>
          <div class="label">${p.name || 'Senza nome'}</div>
          <div class="sub">ID ${id}</div>
        </div>
      </div>
    `;
    node.addEventListener('click', () => selectNode(id));
    canvas.appendChild(node);
  }
  drawLinks();
  applyTransform();
}

function pathCubic(x1,y1,x2,y2) {
  const dx = (x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`;
}

function drawLinks() {
  linksSvg.innerHTML = '';
  for (const id of state.order) {
    const child = getPos(id);
    const ps = byId(id).parents || [];
    for (const pId of ps) {
      const par = getPos(pId);
      if (!par) continue;
      const x1 = par.x + 110; const y1 = par.y + 110;
      const x2 = child.x + 110; const y2 = child.y + 20;
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('class','link');
      path.setAttribute('d', pathCubic(x1,y1,x2,y2));
      linksSvg.appendChild(path);
    }
  }
  for (const [a,b] of state.spouses) {
    const pa = getPos(a), pb = getPos(b);
    if (!pa || !pb) continue;
    const x1 = pa.x + 110, y1 = pa.y + 60;
    const x2 = pb.x + 110, y2 = pb.y + 60;
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('class','link spouse');
    path.setAttribute('d', pathCubic(x1,y1,x2,y2));
    linksSvg.appendChild(path);
  }
}

// ===== Selezione nodo =====
function selectNode(id) {
  state.selected = id;
  canvas.querySelectorAll('.node').forEach(n => n.classList.remove('selected'));
  const el = canvas.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.add('selected');
}

// ===== Drag & Drop nodi (facoltativo: commentato; abilita se vuoi spostamento manuale) =====
// let draggingNode = null;
// let dragStart = null;
// canvas.addEventListener('mousedown', (e) => {
//   const nodeEl = e.target.closest('.node'); if (!nodeEl) return;
//   const id = nodeEl.dataset.id; draggingNode = id;
//   nodeEl.classList.add('dragging');
//   const o = state.offsets[id] || (state.offsets[id] = {dx:0, dy:0});
//   dragStart = { mx: e.clientX, my: e.clientY, dx0: o.dx, dy0: o.dy };
//   e.preventDefault();
// });
// window.addEventListener('mousemove', (e) => {
//   if (!draggingNode || !dragStart) return;
//   const id = draggingNode; const o = state.offsets[id] || (state.offsets[id] = {dx:0, dy:0});
//   const k = state.transform.k || 1;
//   o.dx = dragStart.dx0 + (e.clientX - dragStart.mx) / k;
//   o.dy = dragStart.dy0 + (e.clientY - dragStart.my) / k;
//   render();
// });
// window.addEventListener('mouseup', () => {
//   if (!draggingNode) return;
//   const el = canvas.querySelector(`.node[data-id="${CSS.escape(draggingNode)}"]`);
//   if (el) el.classList.remove('dragging');
//   draggingNode = null; dragStart = null; saveState();
// });

// ===== Pan & Zoom =====
const viewport = document.getElementById('viewport');
let panning = false; let last = {x:0,y:0};

viewport.addEventListener('mousedown', (e) => {
  if (e.target.closest('.node') || e.target.closest('header') || e.target.closest('aside')) return;
  panning = true; last = {x:e.clientX, y:e.clientY};
});
window.addEventListener('mouseup', ()=> panning=false);
window.addEventListener('mousemove', (e)=>{
  if (!panning) return;
  const dx = e.clientX - last.x; const dy = e.clientY - last.y;
  state.transform.x += dx; state.transform.y += dy; last = {x:e.clientX, y:e.clientY};
  applyTransform();
  saveState();
});

viewport.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const delta = Math.sign(e.deltaY) * 0.1;
  const k0 = state.transform.k;
  let k = Math.min(2.2, Math.max(0.4, k0 * (1 - delta)));
  const rect = viewport.getBoundingClientRect();
  const cx = e.clientX - rect.left; const cy = e.clientY - rect.top;
  const x0 = (cx - state.transform.x) / k0; const y0 = (cy - state.transform.y) / k0;
  state.transform.k = k;
  state.transform.x = cx - x0 * k;
  state.transform.y = cy - y0 * k;
  applyTransform();
  saveState();
}, { passive: false });

viewport.addEventListener('dblclick', ()=>{
  state.transform = { x: 300, y: 120, k: 1 };
  applyTransform();
  saveState();
});

function applyTransform() {
  const t = state.transform;
  const m = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
  canvas.style.transform = m;
}

// ===== Fit to view & Print =====
function computeBounds() {
  if (state.order.length === 0) return {minX:0, minY:0, maxX:0, maxY:0};
  let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of state.order) {
    const {x,y} = getPos(id);
    const left = x + 30;
    const top  = y + 30;
    const right = left + 220;
    const bottom = top + 110;
    if (left < minX) minX = left;
    if (top  < minY) minY = top;
    if (right  > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return {minX, minY, maxX, maxY};
}
function fitToView(pad = 40) {
  const vp = document.getElementById('viewport');
  const {minX, minY, maxX, maxY} = computeBounds();
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const vw = vp.clientWidth, vh = vp.clientHeight;
  const scale = Math.min((vw - pad*2)/contentW, (vh - pad*2)/contentH);
  const k = Math.max(0.4, Math.min(2.2, scale));
  state.transform.k = k;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  state.transform.x = vw/2 - cx * k;
  state.transform.y = vh/2 - cy * k;
  applyTransform();
  saveState();
}
function printView() {
  const prev = {...state.transform};
  fitToView(30);
  const restore = () => {
    state.transform = prev;
    applyTransform();
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  setTimeout(()=>window.print(), 100);
}

// ===== Zoom card con doppio click (con stopPropagation per non resettare) =====
canvas.addEventListener('dblclick', e => {
  const nodeEl = e.target.closest('.node');
  if (!nodeEl) return;
  e.preventDefault();
  e.stopPropagation();

  const id = nodeEl.dataset.id;
  const p = byId(id);
  if (!p) return;

  const overlay = document.createElement('div');
  overlay.className = 'overlay-card';
  overlay.innerHTML = `
    <div class="overlay-content">
      <button class="close-btn">×</button>
      <img src="${p.photo || 'https://via.placeholder.com/400?text=Foto'}" alt="${p.name}">
      <h2>${p.name || 'Senza nome'}</h2>
      <p><strong>ID:</strong> ${id}</p>
      <p><strong>Genitori:</strong> ${p.parents?.join(', ') || '—'}</p>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.close-btn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.remove(); });
});
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') document.querySelector('.overlay-card')?.remove();
});

// ===== Controls buttons =====
document.getElementById('zoomIn')?.addEventListener('click', () => {
  const evt = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
  document.getElementById('viewport').dispatchEvent(evt);
});
document.getElementById('zoomOut')?.addEventListener('click', () => {
  const evt = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  document.getElementById('viewport').dispatchEvent(evt);
});
document.getElementById('reset')?.addEventListener('click', () => {
  state.transform = { x: 300, y: 120, k: 1 }; applyTransform(); saveState();
});
document.getElementById('fit')?.addEventListener('click', () => fitToView(40));
document.getElementById('print')?.addEventListener('click', () => printView());

// ===== Avvio =====
function bootstrapDemo() {
  const idNonno = String(state.nextId++);
  const idNonna = String(state.nextId++);
  const idPadre = String(state.nextId++);
  const idMadre = String(state.nextId++);
  const idTu    = String(state.nextId++);

  state.people[idNonno] = { id:idNonno, name:'Giuseppe (nonno)', photo:'', parents:[], gender:'M' };
  state.people[idNonna] = { id:idNonna, name:'Anna (nonna)',     photo:'', parents:[], gender:'F' };
  state.people[idPadre] = { id:idPadre, name:'Marco (padre)',     photo:'', parents:[idNonno,idNonna], gender:'M' };
  state.people[idMadre] = { id:idMadre, name:'Lucia (madre)',     photo:'', parents:[], gender:'F' };
  state.people[idTu]    = { id:idTu,    name:'Renato (tu)',       photo:'', parents:[idPadre,idMadre], gender:'M' };
  state.order.push(idNonno,idNonna,idPadre,idMadre,idTu);
  uniquePushSpouse(idNonno,idNonna);
  uniquePushSpouse(idPadre,idMadre);
}

(async function init(){
  let ok = loadState();
  if (!ok) ok = await loadFromUrlIfPresent();
  if (!ok) bootstrapDemo();
  layout(); render(); saveState();
})();

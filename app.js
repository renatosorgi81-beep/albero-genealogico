
// ===== Stato & persistenza =====
const state = {
  people: {},           // id -> { id, name, photo, parents: [id,id?] }
  spouses: [],          // [ [idA, idB], ... ] (ordinati per id)
  order: [],            // rendering order (ids)
  nextId: 1,
  transform: { x: 300, y: 120, k: 1 },
  selected: null,
  offsets: {}        // <-- AGGIUNTO: offset manuali per nodo { id: {dx,dy} }
};

const STORAGE_KEY = 'family_tree_v2';

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    people: state.people,
    spouses: state.spouses,
    order: state.order,
    nextId: state.nextId
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.people || !data.order) return false;
    state.people = data.people;
    state.spouses = data.spouses || [];
    state.order = data.order;
    state.nextId = data.nextId || (Math.max(0, ...state.order.map(Number)) + 1);
    return true;
  } catch (e) {
    console.warn('Ripristino fallito, avvio pulito', e);
    return false;
  }
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

// ===== Operazioni =====
async function addPerson(name, photoUrl, photoFile, parentA = null, parentB = null, spouseWith = null) {
  const id = String(state.nextId++);
  let photo = (photoUrl || '').trim();
  if (photoFile) {
    try { photo = await fileToDataURL(photoFile); } catch {}
  }
  state.people[id] = { id, name: name.trim(), photo, parents: [] };
  if (parentA) state.people[id].parents.push(parentA);
  if (parentB && parentB !== parentA) state.people[id].parents.push(parentB);
  state.order.push(id);
  if (spouseWith) uniquePushSpouse(id, spouseWith);
  layout();
  render();
  refreshSelectors();
  saveState();
  return id;
}

function deleteSelected() {
  const id = state.selected;
  if (!id) { alert('Seleziona prima una persona'); return; }
  // rimuovi dai dati
  delete state.people[id];
  state.order = state.order.filter(x => x !== id);
  removeParentRefsTo(id);
  removeSpouseLinksOf(id);
  state.selected = null;
  layout(); render(); refreshSelectors(); saveState();
}

// ===== Layout semplice per livelli =====
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
  return { depth, children };
}

const positions = {}; // id -> {x, y}
function layout() {
  const { depth } = computeDepths();
  const byLevel = {};
  for (const id of state.order) {
    const d = depth[id];
    if (!byLevel[d]) byLevel[d] = [];
    byLevel[d].push(id);
  }
  const levelGap = 200; const nodeGap = 200;
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

// ===== Rendering =====
const canvas = document.getElementById('canvas');
const linksSvg = document.getElementById('links');

function render() {
  canvas.querySelectorAll('.node').forEach(n => n.remove());
  for (const id of state.order) {
    const p = byId(id); const pos = positions[id] || {x:0,y:0};
    const node = document.createElement('div');
    node.className = 'node'; node.style.left = (pos.x + 30) + 'px'; node.style.top = (pos.y + 30) + 'px';
    node.dataset.id = id;
    node.innerHTML = `
      <img class="avatar" src="${p.photo || 'https://via.placeholder.com/200?text=Foto'}" alt="${p.name}">
      <div class="label">${p.name || 'Senza nome'}</div>
      <div class="sub">ID ${id}${(p.parents?.length?` • gen: ${p.parents.join(', ')}`:'')}</div>
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
  // parent links
  for (const id of state.order) {
    const child = positions[id];
    const ps = byId(id).parents || [];
    for (const pId of ps) {
      const par = positions[pId];
      if (!par) continue;
      const x1 = par.x + 100; const y1 = par.y + 110;
      const x2 = child.x + 100; const y2 = child.y + 20;
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('class','link');
      path.setAttribute('d', pathCubic(x1,y1,x2,y2));
      linksSvg.appendChild(path);
    }
  }
  // spouse links (dashed)
  for (const [a,b] of state.spouses) {
    const pa = positions[a], pb = positions[b];
    if (!pa || !pb) continue;
    const x1 = pa.x + 100, y1 = pa.y + 65;
    const x2 = pb.x + 100, y2 = pb.y + 65;
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('class','link spouse');
    path.setAttribute('d', pathCubic(x1,y1,x2,y2));
    linksSvg.appendChild(path);
  }
}

function selectNode(id) {
  state.selected = id;
  canvas.querySelectorAll('.node').forEach(n => n.classList.remove('selected'));
  const el = canvas.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.add('selected');
}

// ===== Pan & Zoom =====
const viewport = document.getElementById('viewport');
let dragging = false; let last = {x:0,y:0};

viewport.addEventListener('mousedown', (e) => {
  if (e.target.closest('.node') || e.target.closest('header') || e.target.closest('aside')) return;
  dragging = true; last = {x:e.clientX, y:e.clientY};
});
window.addEventListener('mouseup', ()=> dragging=false);
window.addEventListener('mousemove', (e)=>{
  if (!dragging) return;
  const dx = e.clientX - last.x; const dy = e.clientY - last.y;
  state.transform.x += dx; state.transform.y += dy; last = {x:e.clientX, y:e.clientY};
  applyTransform();
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
}, { passive: false });

viewport.addEventListener('dblclick', ()=>{
  state.transform = { x: 300, y: 120, k: 1 };
  applyTransform();
});

function applyTransform() {
  const t = state.transform;
  const m = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
  canvas.style.transform = m;
}

// ===== Export / Import =====
document.getElementById('export').addEventListener('click', ()=>{
  const data = { people: state.people, spouses: state.spouses, order: state.order, nextId: state.nextId };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'albero.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
});

document.getElementById('import').addEventListener('change', async (e)=>{
  const file = e.target.files?.[0]; if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (!data.people || !data.order) throw new Error('Formato non valido');
    state.people = data.people; state.order = data.order; state.nextId = data.nextId || (Math.max(0, ...data.order.map(Number))+1);
    state.spouses = data.spouses || [];
    layout(); render(); refreshSelectors(); saveState();
  } catch (err) {
    alert('Errore importazione: ' + err.message);
  }
});

// ===== UI =====
const nameInput = document.getElementById('name');
const photoInput = document.getElementById('photo');
const photoFileInput = document.getElementById('photoFile');
const parentA = document.getElementById('parentA');
const parentB = document.getElementById('parentB');
const spouseWith = document.getElementById('spouseWith');

function refreshSelectors() {
  const options = ["", ...state.order];
  for (const sel of [parentA, parentB, spouseWith]) {
    const cur = sel.value;
    sel.innerHTML = "";
    const none = document.createElement('option'); none.value = ""; none.textContent = "(nessuno)"; sel.appendChild(none);
    options.slice(1).forEach(id => {
      const o = document.createElement('option');
      o.value = id; o.textContent = byId(id).name || `ID ${id}`;
      sel.appendChild(o);
    });
    sel.value = options.includes(cur) ? cur : "";
  }
}

document.getElementById('add').addEventListener('click', async ()=>{
  const name = nameInput.value.trim();
  if (!name) { alert('Inserisci almeno il nome completo'); return; }
  const pa = parentA.value || null;
  const pb = parentB.value || null;
  const sw = spouseWith.value || null;
  const file = photoFileInput.files?.[0] || null;
  const id = await addPerson(name, photoInput.value.trim(), file, pa, pb, sw);
  nameInput.value = ''; photoInput.value = ''; if (photoFileInput.value) photoFileInput.value = '';
  parentA.value = ''; parentB.value = ''; spouseWith.value = '';
  selectNode(id);
});

document.getElementById('delete').addEventListener('click', deleteSelected);

// zoom buttons
document.getElementById('zoomIn').addEventListener('click', ()=>{
  const e = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
  viewport.dispatchEvent(e);
});
document.getElementById('zoomOut').addEventListener('click', ()=>{
  const e = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  viewport.dispatchEvent(e);
});
document.getElementById('reset').addEventListener('click', ()=>{
  state.transform = { x: 300, y: 120, k: 1 }; applyTransform();
});

// ===== Avvio =====
function bootstrapDemo() {
  const idNonno = String(state.nextId++);
  const idNonna = String(state.nextId++);
  const idPadre = String(state.nextId++);
  const idMadre = String(state.nextId++);
  const idTu    = String(state.nextId++);

  state.people[idNonno] = { id:idNonno, name:'Giuseppe (nonno)', photo:'https://images.unsplash.com/photo-1602471060926-5f1e1c3f1b8a?q=80&w=300', parents:[] };
  state.people[idNonna] = { id:idNonna, name:'Anna (nonna)',     photo:'https://images.unsplash.com/photo-1551836022-4c4c79ecde51?q=80&w=300', parents:[] };
  state.people[idPadre] = { id:idPadre, name:'Marco (padre)',    photo:'https://images.unsplash.com/photo-1547425260-76bcadfb4f2c?q=80&w=300', parents:[idNonno, idNonna] };
  state.people[idMadre] = { id:idMadre, name:'Lucia (madre)',    photo:'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=300', parents:[] };
  state.people[idTu]    = { id:idTu,    name:'Renato (tu)',      photo:'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=300', parents:[idPadre, idMadre] };
  state.order.push(idNonno,idNonna,idPadre,idMadre,idTu);
  uniquePushSpouse(idNonno, idNonna);
  uniquePushSpouse(idPadre, idMadre);
}

(function init(){
  const ok = loadState();
  if (!ok) bootstrapDemo();
  layout(); render(); refreshSelectors();
  saveState();
})();

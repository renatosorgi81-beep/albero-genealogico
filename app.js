// ===== Stato & persistenza =====
const state = {
  people: {},           // id -> { id, name, photo, parents: [id,id?], gender: 'M'|'F'|'' }
  spouses: [],          // [ [idA, idB], ... ]
  order: [],            // ids
  nextId: 1,
  transform: { x: 300, y: 120, k: 1 },
  selected: null,
  offsets: {}           // id -> { dx, dy }
};

const STORAGE_KEY = 'family_tree_v2';

// dimensioni card / margini
const CARD = { width: 220, height: 110, margin: 30 };

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    people: state.people,
    spouses: state.spouses,
    order: state.order,
    nextId: state.nextId,
    offsets: state.offsets
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.people || !data.order) return false;
    Object.values(data.people).forEach(p => { if (p.gender == null) p.gender = ''; });
    state.people  = data.people;
    state.spouses = data.spouses || [];
    state.order   = data.order;
    state.nextId  = data.nextId || (Math.max(0, ...state.order.map(Number)) + 1);
    state.offsets = data.offsets || {};
    return true;
  } catch {
    return false;
  }
}

// ===== Helpers =====
const byId = id => state.people[id];
const normPair = (a,b) => [String(a), String(b)].sort();
function spouseOf(id) {
  for (const [a,b] of state.spouses) { if (a===id) return b; if (b===id) return a; }
  return null;
}
function uniquePushSpouse(a, b) {
  const [x,y] = normPair(a,b);
  if (x === y) return;
  if (!state.spouses.find(([i,j]) => i===x && j===y)) state.spouses.push([x,y]);
}
function removeSpouseLinksOf(id) { state.spouses = state.spouses.filter(([a,b]) => a!==id && b!==id); }
function removeParentRefsTo(id) {
  for (const pid of state.order) {
    const ps = byId(pid).parents || [];
    byId(pid).parents = ps.filter(p => p !== id);
  }
}

// file -> dataURL
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// ===== Operazioni =====
async function addPerson(name, photoUrl, photoFile, parentA = null, parentB = null, spouseWith = null, gender = '') {
  const id = String(state.nextId++);
  let photo = (photoUrl || '').trim();
  if (photoFile) { try { photo = await fileToDataURL(photoFile); } catch {} }
  state.people[id] = { id, name: name.trim(), photo, parents: [], gender: (gender || '').toUpperCase() };
  if (parentA) state.people[id].parents.push(parentA);
  if (parentB && parentB !== parentA) state.people[id].parents.push(parentB);
  state.order.push(id);
  if (spouseWith) uniquePushSpouse(id, spouseWith);
  layout(); render(); refreshSelectors(); saveState();
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
  layout(); render(); refreshSelectors(); saveState();
}

// ===== Layout per generazioni, coniugi affiancati =====
const positions = {}; // id -> {x, y}

function layout() {
  // Depth (BFS)
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

  // per livello
  const byLevel = {};
  for (const id of state.order) {
    const d = depth[id];
    if (!byLevel[d]) byLevel[d] = [];
    byLevel[d].push(id);
  }

  const levelGap = 200;
  const coupleGap = 46;
  const slotGap   = 260;

  const occupied = new Set();
  const levelUnits = {};

  for (const [lvl, arr] of Object.entries(byLevel)) {
    const units = [];
    // prima le coppie
    for (const id of arr) {
      if (occupied.has(id)) continue;
      const s = spouseOf(id);
      if (s && byLevel[lvl].includes(s) && !occupied.has(s)) {
        units.push({ type:'couple', a:id, b:s });
        occupied.add(id); occupied.add(s);
      }
    }
    // poi i singoli
    for (const id of arr) {
      if (occupied.has(id)) continue;
      units.push({ type:'single', id });
    }
    levelUnits[lvl] = units;
  }

  // posizionamento
  for (const [lvl, units] of Object.entries(levelUnits)) {
    units.forEach((u, i) => {
      const baseX = i * slotGap;
      const baseY = Number(lvl) * levelGap;
      if (u.type === 'couple') {
        positions[u.a] = { x: baseX - coupleGap/2, y: baseY };
        positions[u.b] = { x: baseX + coupleGap/2, y: baseY };
      } else {
        positions[u.id] = { x: baseX, y: baseY };
      }
    });
  }

  // centra i figli sotto i genitori (media posizioni)
  for (const id of state.order) {
    const ps = byId(id).parents || [];
    if (!ps.length) continue;
    const xs = ps.map(p => positions[p]?.x).filter(x => x != null);
    if (xs.length) {
      const avg = xs.reduce((a,b)=>a+b,0)/xs.length;
      positions[id].x = avg;
    }
  }

  // normalizza x
  const xs = Object.values(positions).map(p=>p.x);
  const minX = Math.min(...xs, 0);
  if (minX < 0) for (const id of state.order) positions[id].x -= minX;
}

// ===== Posizioni finali e bounds =====
function getPos(id) {
  const p = positions[id] || {x:0, y:0};
  const o = state.offsets[id] || {dx:0, dy:0};
  return { x: p.x + o.dx, y: p.y + o.dy };
}

function computeBounds() {
  if (state.order.length === 0) return {minX:0, minY:0, maxX:0, maxY:0};
  let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of state.order) {
    const {x,y} = getPos(id);
    const left = x + CARD.margin;
    const top  = y + CARD.margin;
    const right = left + CARD.width;
    const bottom = top + CARD.height;
    if (left < minX) minX = left;
    if (top  < minY) minY = top;
    if (right  > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return {minX, minY, maxX, maxY};
}

// ===== Rendering =====
const canvas = document.getElementById('canvas');
const linksSvg = document.getElementById('links');

function render() {
  canvas.querySelectorAll('.node').forEach(n => n.remove());

  for (const id of state.order) {
    const p = byId(id); const pos = getPos(id);
    const left = pos.x + CARD.margin;
    const top  = pos.y + CARD.margin;

    const sexClass = p.gender === 'M' ? 'male' : (p.gender === 'F' ? 'female' : '');
    const node = document.createElement('div');
    node.className = `node ${sexClass}`;
    node.style.left = left + 'px';
    node.style.top  = top  + 'px';
    node.dataset.id = id;

    const badge = p.gender ? `<div class="badge-sex">${p.gender}</div>` : '';

    node.innerHTML = `
      <div class="person-card">
        <img class="avatar" src="${p.photo || 'https://via.placeholder.com/120?text=Foto'}" alt="${p.name}">
        <div class="label">${p.name || 'Senza nome'}</div>
        <div class="sub">ID ${id}${(p.parents?.length?` • gen: ${p.parents.join(', ')}`:'')}</div>
        ${badge}
      </div>
    `;

    node.addEventListener('click', () => selectNode(id));
    canvas.appendChild(node);
  }

  drawLinks();
  applyTransform();
}

// ancoraggi card
function anchors(id) {
  const {x,y} = getPos(id);
  const left = x + CARD.margin;
  const top  = y + CARD.margin;
  const cx = left + CARD.width/2;
  const yTop = top;
  const yMid = top + CARD.height/2;
  const yBot = top + CARD.height;
  return { cx, yTop, yMid, yBot };
}

// path ortogonale (L-shape): dalla (x1,y1) alla (x2,y2)
function pathOrtho(x1,y1,x2,y2) {
  const mx = x1;               // scendo dritto dal punto 1
  const my = y2;               // poi vado orizzontale fino a x2
  return `M ${x1} ${y1} L ${mx} ${my} L ${x2} ${y2}`;
}

function drawLinks() {
  linksSvg.innerHTML = '';

  // mappa giunti coppia (key = "a|b")
  const joint = new Map();
  for (const [a,b] of state.spouses) {
    const pa = anchors(a), pb = anchors(b);
    const x = (pa.cx + pb.cx) / 2;
    const y = pa.yMid; // stessa riga dei coniugi
    joint.set(normPair(a,b).join('|'), {x, y});
    // linea coniugi (orizzontale)
    const pathS = document.createElementNS('http://www.w3.org/2000/svg','path');
    pathS.setAttribute('class','link spouse');
    pathS.setAttribute('d', `M ${pa.cx} ${pa.yMid} L ${pb.cx} ${pb.yMid}`);
    linksSvg.appendChild(pathS);
  }

  // Figli: se hanno due genitori che sono coniugi, scendono dal giunto
  for (const id of state.order) {
    const ps = (byId(id).parents || []);
    const child = anchors(id);
    if (ps.length === 2) {
      const key = normPair(ps[0], ps[1]).join('|');
      const j = joint.get(key);
      if (j) {
        // giunto -> figlio (ortogonale, verticale poi orizzontale)
        const path = document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('class','link');
        path.setAttribute('d', pathOrtho(j.x, j.y, child.cx, child.yTop));
        linksSvg.appendChild(path);
        continue;
      }
    }
    // altrimenti: da ognuno dei genitori singolarmente
    for (const pId of ps) {
      const par = anchors(pId);
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('class','link');
      path.setAttribute('d', pathOrtho(par.cx, par.yBot, child.cx, child.yTop));
      linksSvg.appendChild(path);
    }
  }

  // Fratelli (opzionale, spesso non serve col giunto)
  const siblingGroups = new Map();
  for (const id of state.order) {
    const ps = (byId(id).parents || []).slice().sort();
    if (!ps.length) continue;
    const key = ps.join('|');
    if (!siblingGroups.has(key)) siblingGroups.set(key, []);
    siblingGroups.get(key).push(id);
  }
  for (const ids of siblingGroups.values()) {
    if (ids.length < 2) continue;
    ids.sort((a,b)=> anchors(a).cx - anchors(b).cx);
    for (let i=0; i<ids.length-1; i++) {
      const ra = anchors(ids[i]), rb = anchors(ids[i+1]);
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('class','link sibling');
      path.setAttribute('d', `M ${ra.cx} ${ra.yMid} L ${rb.cx} ${rb.yMid}`);
      linksSvg.appendChild(path);
    }
  }
}

function selectNode(id) {
  state.selected = id;
  canvas.querySelectorAll('.node').forEach(n => n.classList.remove('selected'));
  const el = canvas.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.add('selected');

  const p = byId(id);
  if (p) {
    const editName = document.getElementById('editName');
    const editPhoto = document.getElementById('editPhoto');
    const editPhotoFile = document.getElementById('editPhotoFile');
    const editGender = document.getElementById('editGender');
    if (editName) editName.value = p.name || "";
    if (editPhoto) editPhoto.value = p.photo || "";
    if (editPhotoFile) editPhotoFile.value = "";
    if (editGender) editGender.value = p.gender || "";
    refreshEditSelectors(id);
  }
}

// ===== Drag & Drop nodi =====
let draggingNode = null;
let dragStart = null;

canvas.addEventListener('mousedown', (e) => {
  const nodeEl = e.target.closest('.node');
  if (!nodeEl) return;
  const id = nodeEl.dataset.id;
  draggingNode = id;
  nodeEl.classList.add('dragging');
  const o = state.offsets[id] || (state.offsets[id] = {dx:0, dy:0});
  dragStart = { mx: e.clientX, my: e.clientY, dx0: o.dx, dy0: o.dy };
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!draggingNode || !dragStart) return;
  const o = state.offsets[draggingNode] || (state.offsets[draggingNode] = {dx:0, dy:0});
  const k = state.transform.k || 1;
  o.dx = dragStart.dx0 + (e.clientX - dragStart.mx) / k;
  o.dy = dragStart.dy0 + (e.clientY - dragStart.my) / k;
  render();
});

window.addEventListener('mouseup', () => {
  if (!draggingNode) return;
  const el = canvas.querySelector(`.node[data-id="${CSS.escape(draggingNode)}"]`);
  if (el) el.classList.remove('dragging');
  draggingNode = null; dragStart = null; saveState();
});

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
  applyTransform(); saveState();
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
  applyTransform(); saveState();
}, { passive: false });

viewport.addEventListener('dblclick', ()=>{
  state.transform = { x: 300, y: 120, k: 1 };
  applyTransform(); saveState();
});

function applyTransform() {
  const t = state.transform;
  canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
}

// ===== Fit / Print =====
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
  applyTransform(); saveState();
}
function printView() {
  const prev = {...state.transform};
  fitToView(30);
  const restore = () => {
    state.transform = prev; applyTransform();
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  setTimeout(()=>window.print(), 100);
}

// ===== Export / Import =====
document.getElementById('export').addEventListener('click', ()=>{
  const data = { people: state.people, spouses: state.spouses, order: state.order, nextId: state.nextId, offsets: state.offsets };
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
    Object.values(data.people).forEach(p => { if (p.gender == null) p.gender = ''; });
    state.people  = data.people;
    state.order   = data.order;
    state.nextId  = data.nextId || (Math.max(0, ...data.order.map(Number))+1);
    state.spouses = data.spouses || [];
    state.offsets = data.offsets || {};
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
const genderSelect = document.getElementById('gender');

function refreshSelectors() {
  const options = ["", ...state.order];
  for (const sel of [parentA, parentB, spouseWith]) {
    if (!sel) continue;
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
  const pa = parentA?.value || null;
  const pb = parentB?.value || null;
  const sw = spouseWith?.value || null;
  const gender = (genderSelect?.value || '').toUpperCase();
  const file = photoFileInput.files?.[0] || null;
  const id = await addPerson(name, photoInput.value.trim(), file, pa, pb, sw, gender);
  nameInput.value = ''; photoInput.value = ''; if (photoFileInput.value) photoFileInput.value = '';
  if (parentA) parentA.value = ''; if (parentB) parentB.value = '';
  if (spouseWith) spouseWith.value = ''; if (genderSelect) genderSelect.value = '';
  selectNode(id);
});

document.getElementById('delete').addEventListener('click', deleteSelected);

// Editor modifica
function refreshEditSelectors(currentId) {
  const editParentA = document.getElementById('editParentA');
  const editParentB = document.getElementById('editParentB');
  const editSpouseWith = document.getElementById('editSpouseWith');
  if (!editParentA || !editParentB || !editSpouseWith) return;

  const selects = [editParentA, editParentB, editSpouseWith];
  selects.forEach(sel => {
    sel.innerHTML = "";
    const none = document.createElement('option');
    none.value = ""; none.textContent = "(nessuno)";
    sel.appendChild(none);
    state.order.forEach(id => {
      if (id === currentId) return;
      const o = document.createElement('option');
      o.value = id; o.textContent = byId(id).name || `ID ${id}`;
      sel.appendChild(o);
    });
  });

  const p = byId(currentId);
  if (!p) return;
  editParentA.value = p.parents[0] || "";
  editParentB.value = p.parents[1] || "";
  const spouse = state.spouses.find(([a,b]) => a===currentId || b===currentId);
  editSpouseWith.value = spouse ? (spouse[0]===currentId ? spouse[1] : spouse[0]) : "";
}

const applyEditBtn = document.getElementById('applyEdit');
if (applyEditBtn) {
  applyEditBtn.addEventListener('click', async ()=>{
    const id = state.selected;
    if (!id) { alert("Seleziona prima un nodo da modificare"); return; }
    const p = byId(id); if (!p) return;

    const editName = document.getElementById('editName');
    const editPhoto = document.getElementById('editPhoto');
    const editPhotoFile = document.getElementById('editPhotoFile');
    const editParentA = document.getElementById('editParentA');
    const editParentB = document.getElementById('editParentB');
    const editSpouseWith = document.getElementById('editSpouseWith');
    const editGender = document.getElementById('editGender');

    p.name = (editName?.value || "").trim();
    let photo = (editPhoto?.value || "").trim();
    const file = editPhotoFile?.files?.[0] || null;
    if (file) { photo = await fileToDataURL(file); }
    p.photo = photo;

    const pa = editParentA?.value || null;
    const pb = editParentB?.value || null;
    p.parents = [];
    if (pa) p.parents.push(pa);
    if (pb && pb !== pa) p.parents.push(pb);

    p.gender = (editGender?.value || '').toUpperCase();

    removeSpouseLinksOf(id);
    const sw = editSpouseWith?.value || null;
    if (sw) uniquePushSpouse(id, sw);

    layout(); render(); refreshSelectors(); saveState();
    alert("Dati aggiornati!");
  });
}

// Controls
document.getElementById('zoomIn').addEventListener('click', ()=>{
  const e = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
  viewport.dispatchEvent(e);
});
document.getElementById('zoomOut').addEventListener('click', ()=>{
  const e = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  viewport.dispatchEvent(e);
});
document.getElementById('reset').addEventListener('click', ()=>{
  state.transform = { x: 300, y: 120, k: 1 }; applyTransform(); saveState();
});
document.getElementById('fit').addEventListener('click', ()=> fitToView(40));
document.getElementById('print').addEventListener('click', printView);

// Demo iniziale
function bootstrapDemo() {
  const idA = String(state.nextId++);
  const idB = String(state.nextId++);
  const idC = String(state.nextId++);
  const idD = String(state.nextId++);
  const idE = String(state.nextId++);

  state.people[idA] = { id:idA, name:'Giuseppe (nonno)', gender:'M', photo:'', parents:[] };
  state.people[idB] = { id:idB, name:'Anna (nonna)',     gender:'F', photo:'', parents:[] };
  state.people[idC] = { id:idC, name:'Marco (padre)',    gender:'M', photo:'', parents:[idA,idB] };
  state.people[idD] = { id:idD, name:'Lucia (madre)',    gender:'F', photo:'', parents:[] };
  state.people[idE] = { id:idE, name:'Renato (tu)',      gender:'M', photo:'', parents:[idC,idD] };
  state.order.push(idA,idB,idC,idD,idE);
  uniquePushSpouse(idA, idB);
  uniquePushSpouse(idC, idD);
}

(function init(){
  const ok = loadState();
  if (!ok) bootstrapDemo();
  layout(); render(); refreshSelectors(); saveState();
})();

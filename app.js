
// --- Dati ---
const state = {
  people: {},   // id -> { id, name, photo, parents: [id,id?] }
  order: [],    // rendering order (ids)
  nextId: 1,
  transform: { x: 300, y: 120, k: 1 },
  selected: null,
};

// Helpers
const byId = id => state.people[id];

function addPerson(name, photo, parentA = null, parentB = null) {
  const id = String(state.nextId++);
  state.people[id] = { id, name: name.trim(), photo: (photo || '').trim(), parents: [] };
  if (parentA) state.people[id].parents.push(parentA);
  if (parentB && parentB !== parentA) state.people[id].parents.push(parentB);
  state.order.push(id);
  layout();
  render();
  refreshSelectors();
  return id;
}

function refreshSelectors() {
  const options = ["", ...state.order];
  for (const sel of [parentA, parentB]) {
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

// --- Layout semplice per livelli ---
// 1) Compute depth via BFS from roots (no parents).
function computeDepths() {
  const indeg = {}; const depth = {}; const children = {};
  for (const id of state.order) {
    indeg[id] = (byId(id).parents || []).length;
    children[id] = [];
  }
  for (const id of state.order) {
    for (const p of byId(id).parents) {
      if (children[p]) children[p].push(id);
    }
  }
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

// 2) Place nodes on grid by depth (y) and order (x). Then center children under average x of their parents.
const positions = {}; // id -> {x, y}
function layout() {
  const { depth, children } = computeDepths();
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
  if (minX < 0) {
    for (const id of state.order) positions[id].x -= minX;
  }
}

// --- Rendering ---
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
}

function selectNode(id) {
  state.selected = id;
  canvas.querySelectorAll('.node').forEach(n => n.classList.remove('selected'));
  const el = canvas.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.add('selected');
}

// --- Pan & Zoom ---
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

// --- Export / Import ---
document.getElementById('export').addEventListener('click', ()=>{
  const data = { people: state.people, order: state.order, nextId: state.nextId };
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
    layout(); render(); refreshSelectors();
  } catch (err) {
    alert('Errore importazione: ' + err.message);
  }
});

// --- UI add ---
const nameInput = document.getElementById('name');
const photoInput = document.getElementById('photo');
const parentA = document.getElementById('parentA');
const parentB = document.getElementById('parentB');

document.getElementById('add').addEventListener('click', ()=>{
  const name = nameInput.value.trim();
  if (!name) { alert('Inserisci almeno il nome completo'); return; }
  const pa = parentA.value || null;
  const pb = parentB.value || null;
  const id = addPerson(name, photoInput.value.trim(), pa, pb);
  nameInput.value = ''; photoInput.value = '';
  parentA.value = ''; parentB.value = '';
  selectNode(id);
});

// --- Zoom buttons ---
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

// --- Demo iniziale ---
const idNonno = addPerson('Giuseppe (nonno)', 'https://images.unsplash.com/photo-1602471060926-5f1e1c3f1b8a?q=80&w=300');
const idNonna = addPerson('Anna (nonna)', 'https://images.unsplash.com/photo-1551836022-4c4c79ecde51?q=80&w=300');
const idPadre = addPerson('Marco (padre)', 'https://images.unsplash.com/photo-1547425260-76bcadfb4f2c?q=80&w=300', idNonno, idNonna);
const idMadre = addPerson('Lucia (madre)', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=300');
addPerson('Renato (tu)', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=300', idPadre, idMadre);
refreshSelectors();

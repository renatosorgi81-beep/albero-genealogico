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
    const ps =

/* app.js – Albero Genealogico (vanilla, senza librerie esterne)
 * Funzioni principali:
 * - Gestione dati (Store): localStorage + import/export
 * - Render grafico (Graph): SVG, nodi tondi con foto, linee, pan & zoom, drag
 * - UI: toolbar, editor laterale, ricerca, scorciatoie
 */

// ---------- Utilità ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function debounce(fn, wait = 300){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function download(filename, data, type='application/json'){
  const blob = new Blob([data], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

function initials(firstName, lastName){
  const f = (firstName||'').trim()[0] || '';
  const l = (lastName||'').trim()[0] || '';
  return (f + l).toUpperCase() || '∎';
}

// ---------- Dati & Store ----------
const DEFAULT_DATA = {
  people: [
    { id: uuid(), firstName: 'Mario', lastName: 'Rossi', relation: 'padre', photo: null, notes: '', x: 0, y: 0 },
    { id: uuid(), firstName: 'Anna', lastName: 'Bianchi', relation: 'madre', photo: null, notes: '', x: 0, y: 0 },
    { id: uuid(), firstName: 'Luca', lastName: 'Rossi', relation: 'figlio', photo: null, notes: '', x: 0, y: 0 },
  ],
  links: [],
  version: 1
};

(function seedExample(){
  const p = DEFAULT_DATA.people;
  DEFAULT_DATA.links.push({ type: 'spouse', fromId: p[0].id, toId: p[1].id });
  DEFAULT_DATA.links.push({ type: 'parent', fromId: p[0].id, toId: p[2].id });
  DEFAULT_DATA.links.push({ type: 'parent', fromId: p[1].id, toId: p[2].id });
})();

const Store = {
  key: 'familyTree_v1',
  load(){
    try{
      const raw = localStorage.getItem(this.key);
      if(!raw) return structuredClone(DEFAULT_DATA);
      const data = JSON.parse(raw);
      if(!data.people || !Array.isArray(data.people)) throw new Error('Schema invalido');
      if(!data.links || !Array.isArray(data.links)) throw new Error('Schema invalido');
      return data;
    }catch(e){
      console.warn('Errore load Store, ripristino default:', e);
      return structuredClone(DEFAULT_DATA);
    }
  },
  save(data){
    localStorage.setItem(this.key, JSON.stringify(data));
  },
  reset(){
    localStorage.removeItem(this.key);
  },
  export(data){
    download('family.json', JSON.stringify(data, null, 2));
  },
  async import(file){
    const text = await file.text();
    const data = JSON.parse(text);
    if(!data || typeof data !== 'object') throw new Error('JSON non valido');
    if(!Array.isArray(data.people) || !Array.isArray(data.links)) throw new Error('Schema non valido');
    return data;
  }
};

// ---------- Stato ----------
const AppState = {
  data: Store.load(),
  selectedId: null,
  mode: 'idle', // 'idle' | 'linkParent' | 'linkSpouse'
  pendingLinkFrom: null,
  dirty: false,
  setDirty(flag=true){
    this.dirty = flag;
    updateModeBadge();
  }
};

// ---------- Layout ----------
function computeGenerations(data){
  const parentsOf = new Map();
  data.links.filter(l => l.type === 'parent').forEach(l => {
    if(!parentsOf.has(l.toId)) parentsOf.set(l.toId, new Set());
    parentsOf.get(l.toId).add(l.fromId);
  });

  const gen = new Map();
  const ids = data.people.map(p => p.id);
  ids.forEach(id => gen.set(id, 0));

  let changed = true, safety = 0;
  while(changed && safety++ < 1000){
    changed = false;
    ids.forEach(id => {
      const parents = parentsOf.get(id);
      if(parents && parents.size){
        let maxParentGen = 0;
        parents.forEach(pid => { maxParentGen = Math.max(maxParentGen, gen.get(pid) ?? 0); });
        const newGen = maxParentGen + 1;
        if(newGen > (gen.get(id) ?? 0)){ gen.set(id, newGen); changed = true; }
      }
    });
  }
  return gen;
}

function autoLayout(data){
  const gen = computeGenerations(data);
  const groups = new Map();
  data.people.forEach(p => {
    const g = gen.get(p.id) ?? 0;
    if(!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p.id);
  });

  const gapY = 160;
  const gapX = 160;
  const gens = Array.from(groups.keys()).sort((a,b)=>a-b);
  gens.forEach((g) => {
    const arr = groups.get(g);
    arr.sort();
    const startX = -((arr.length - 1) * gapX) / 2;
    arr.forEach((id, i) => {
      const person = data.people.find(p => p.id === id);
      person.baseX = startX + i * gapX;
      person.baseY = 40 + g * gapY;
    });
  });

  data.links.filter(l => l.type==='spouse').forEach(l => {
    const a = data.people.find(p => p.id === l.fromId);
    const b = data.people.find(p => p.id === l.toId);
    if(!a || !b) return;
    const avgX = (a.baseX + b.baseX) / 2;
    a.baseX = avgX - 40;
    b.baseX = avgX + 40;
    const midY = (a.baseY + b.baseY) / 2;
    a.baseY = b.baseY = midY;
  });
}

// ---------- Verifiche relazioni ----------
function haveSpouseLink(data, aId, bId){
  const [x,y] = [aId, bId].sort();
  return data.links.some(l => l.type==='spouse' && [l.fromId, l.toId].sort().join() === [x,y].join());
}

function createsParentCycle(data, parentId, childId){
  const parentsMap = new Map();
  data.links.filter(l => l.type==='parent').forEach(l => {
    if(!parentsMap.has(l.toId)) parentsMap.set(l.toId, []);
    parentsMap.get(l.toId).push(l.fromId);
  });
  const visited = new Set();
  function dfs(current){
    if(current === parentId) return true;
    if(visited.has(current)) return false;
    visited.add(current);
    const ps = parentsMap.get(current) || [];
    for(const p of ps){ if(dfs(p)) return true; }
    return false;
  }
  return dfs(parentId);
}

// ---------- Grafico (SVG) ----------
const svg = document.getElementById('svg');
const svgBg = document.getElementById('svgBg');
const viewport = document.getElementById('viewport');
const linksLayer = document.getElementById('linksLayer');
const nodesLayer = document.getElementById('nodesLayer');

let view = { x:0, y:0, k:1 };
let isPanning = false;
let panStart = { x:0, y:0 };
let viewStart = { x:0, y:0 };

function applyView(){
  viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
}

function clientToWorld(clientX, clientY){
  const rect = svg.getBoundingClientRect();
  const x = (clientX - rect.left - view.x) / view.k;
  const y = (clientY - rect.top - view.y) / view.k;
  return {x,y};
}

svgBg.addEventListener('pointerdown', (e)=>{
  isPanning = true;
  panStart = { x: e.clientX, y: e.clientY };
  viewStart = { x: view.x, y: view.y };
  svgBg.setPointerCapture(e.pointerId);
});
svgBg.addEventListener('pointermove', (e)=>{
  if(!isPanning) return;
  const dx = e.clientX - panStart.x;
  const dy = e.clientY - panStart.y;
  view.x = viewStart.x + dx;
  view.y = viewStart.y + dy;
  applyView();
});
svgBg.addEventListener('pointerup', (e)=>{
  isPanning = false;
  svgBg.releasePointerCapture(e.pointerId);
});
svg.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const delta = -e.deltaY;
  const factor = Math.exp(delta * 0.001);
  const pt = clientToWorld(e.clientX, e.clientY);
  view.x = pt.x * (1 - factor) * view.k + view.x;
  view.y = pt.y * (1 - factor) * view.k + view.y;
  view.k *= factor;
  view.k = Math.min(3, Math.max(0.2, view.k));
  applyView();
}, { passive:false });

function clearLayer(el){ while(el.firstChild) el.removeChild(el.firstChild); }

function render(){
  autoLayout(AppState.data);

  clearLayer(linksLayer);
  clearLayer(nodesLayer);

  AppState.data.links.forEach(l => {
    const a = AppState.data.people.find(p => p.id === l.fromId);
    const b = AppState.data.people.find(p => p.id === l.toId);
    if(!a || !b) return;

    const ax = (a.baseX + (a.x||0));
    const ay = (a.baseY + (a.y||0));
    const bx = (b.baseX + (b.x||0));
    const by = (b.baseY + (b.y||0));

    const midX = (ax + bx)/2;
    const d = `M ${ax} ${ay} C ${midX} ${ay}, ${midX} ${by}, ${bx} ${by}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `link ${l.type==='spouse' ? 'spouse' : ''}`);
    path.setAttribute('stroke', '#7c86a9');
    path.setAttribute('stroke-opacity', '0.65');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('fill', 'none');
    linksLayer.appendChild(path);
  });

  const R = 38;
  AppState.data.people.forEach(p => {
    const x = p.baseX + (p.x||0);
    const y = p.baseY + (p.y||0);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `node${AppState.selectedId===p.id ? ' selected' : ''}`);
    g.setAttribute('tabindex', '0');
    g.setAttribute('data-id', p.id);
    g.setAttribute('transform', `translate(${x},${y})`);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', R);
    circle.setAttribute('cx', 0);
    circle.setAttribute('cy', 0);
    circle.setAttribute('fill', '#151823');
    circle.setAttribute('stroke', '#2a2e3d');
    circle.setAttribute('stroke-width', '1.5');
    g.appendChild(circle);

    const clipId = `clip_${p.id}`;
    const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clip.setAttribute('id', clipId);
    const clipCirc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    clipCirc.setAttribute('r', R-2);
    clipCirc.setAttribute('cx', 0);
    clipCirc.setAttribute('cy', 0);
    clip.appendChild(clipCirc);
    viewport.appendChild(clip);

    if(p.photo){
      const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', p.photo);
      img.setAttribute('width', (R*2-6));
      img.setAttribute('height', (R*2-6));
      img.setAttribute('x', -(R-3));
      img.setAttribute('y', -(R-3));
      img.setAttribute('clip-path', `url(#${clipId})`);
      g.appendChild(img);
    }else{
      const initialsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      initialsText.setAttribute('x', 0);
      initialsText.setAttribute('y', 5);
      initialsText.setAttribute('text-anchor', 'middle');
      initialsText.setAttribute('fill', '#aeb6c4');
      initialsText.setAttribute('font-size', '16');
      initialsText.textContent = initials(p.firstName, p.lastName);
      g.appendChild(initialsText);
    }

    // Badge parentela
    const badgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    badgeGroup.setAttribute('transform', `translate(${R-10},${-R+10})`);
    const badgeBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    badgeBg.setAttribute('rx', 6);
    badgeBg.setAttribute('ry', 6);
    badgeBg.setAttribute('fill', '#7bd88f');
    badgeBg.setAttribute('stroke', '#0e1219');
    badgeBg.setAttribute('stroke-width', '1');
    const badgeLabel = (p.relation || '').toString();
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tmp.setAttribute('font-size', '10');
    tmp.setAttribute('x', 6);
    tmp.setAttribute('y', 12);
    tmp.textContent = badgeLabel || '—';
    badgeGroup.appendChild(badgeBg);
    badgeGroup.appendChild(tmp);
    nodesLayer.appendChild(g);
    const bbox = tmp.getBBox();
    badgeBg.setAttribute('width', bbox.width + 12);
    badgeBg.setAttribute('height', 18);
    g.appendChild(badgeGroup);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'label');
    label.setAttribute('x', 0);
    label.setAttribute('y', R + 10);
    label.setAttribute('fill', '#e9ecf1');
    label.setAttribute('font-size', '12');
    label.textContent = `${p.firstName || ''} ${p.lastName || ''}`.trim() || '—';
    g.appendChild(label);

    g.addEventListener('click', (e)=>{
      e.stopPropagation();
      selectPerson(p.id);
    });
    let dragging = false;
    let dragStartWorld = null;
    g.addEventListener('pointerdown', (e)=>{
      e.stopPropagation();
      g.setPointerCapture(e.pointerId);
      dragging = true;
      dragStartWorld = clientToWorld(e.clientX, e.clientY);
    });
    g.addEventListener('pointermove', (e)=>{
      if(!dragging) return;
      const pt = clientToWorld(e.clientX, e.clientY);
      const dx = pt.x - dragStartWorld.x;
      const dy = pt.y - dragStartWorld.y;
      p.x = (p.x||0) + dx;
      p.y = (p.y||0) + dy;
      dragStartWorld = pt;
      AppState.setDirty(true);
      render();
    });
    g.addEventListener('pointerup', (e)=>{
      dragging = false;
      g.releasePointerCapture(e.pointerId);
    });

    nodesLayer.appendChild(g);
  });

  updateModeBadge();
}

function updateModeBadge(){
  const badge = document.getElementById('modeBadge');
  let text = '';
  if(AppState.mode === 'linkParent'){
    text = 'Modalità: Collega Genitore → Figlio';
  }else if(AppState.mode === 'linkSpouse'){
    text = 'Modalità: Collega Coniugi';
  }else if(AppState.dirty){
    text = 'Modifiche non salvate';
  }else{
    text = '';
  }
  badge.textContent = text;
}

// ---------- Selezione & Editor ----------
const photoInput = document.getElementById('photoInput');
const photoPreview = document.getElementById('photoPreview');
const firstNameInput = document.getElementById('firstName');
const lastNameInput = document.getElementById('lastName');
const relationSelect = document.getElementById('relation');
const relationFree = document.getElementById('relationFree');
const notesInput = document.getElementById('notes');

function bindEditor(p){
  photoPreview.style.backgroundImage = p?.photo ? `url(${p.photo})` : 'none';
  if(firstNameInput) firstNameInput.value = p?.firstName || '';
  if(lastNameInput) lastNameInput.value = p?.lastName || '';
  if(relationSelect) relationSelect.value = (p?.relation && ['padre','madre','figlio','figlia','nonno','nonna','zio','zia','coniuge','altro'].includes(p.relation)) ? p.relation : '';
  if(relationFree) relationFree.value = (relationSelect && relationSelect.value === '' ? (p?.relation || '') : '');
  if(notesInput) notesInput.value = p?.notes || '';
}

function selectPerson(id){
  AppState.selectedId = id;
  const person = AppState.data.people.find(p => p.id === id);
  bindEditor(person);
  render();
}

document.getElementById('btnApply')?.addEventListener('click', ()=>{
  const id = AppState.selectedId;
  if(!id){ alert('Seleziona una persona'); return; }
  const p = AppState.data.people.find(x=>x.id===id);
  p.firstName = firstNameInput.value.trim();
  p.lastName = lastNameInput.value.trim();
  const rel = (relationSelect?.value || '') || (relationFree?.value.trim() || '');
  p.relation = rel || '';
  p.notes = notesInput?.value.trim() || '';
  AppState.setDirty(true);
  render();
});

document.getElementById('btnClearPhoto')?.addEventListener('click', ()=>{
  const id = AppState.selectedId;
  if(!id){ alert('Seleziona una persona'); return; }
  const p = AppState.data.people.find(x=>x.id===id);
  p.photo = null;
  photoPreview.style.backgroundImage = 'none';
  AppState.setDirty(true);
  render();
});

photoInput?.addEventListener('change', ()=>{
  const file = photoInput.files?.[0];
  const id = AppState.selectedId;
  if(!file || !id){ return; }
  const reader = new FileReader();
  reader.onload = () => {
    const p = AppState.data.people.find(x=>x.id===id);
    p.photo = reader.result;
    photoPreview.style.backgroundImage = `url(${p.photo})`;
    AppState.setDirty(true);
    render();
  };
  reader.readAsDataURL(file);
});

// ---------- Toolbar ----------
document.getElementById('btnAdd')?.addEventListener('click', ()=>{
  const p = { id: uuid(), firstName:'', lastName:'', relation:'', photo:null, notes:'', x:0, y:0 };
  AppState.data.people.push(p);
  AppState.setDirty(true);
  selectPerson(p.id);
});

document.getElementById('btnLinkParent')?.addEventListener('click', ()=>{
  AppState.mode = 'linkParent';
  AppState.pendingLinkFrom = AppState.selectedId;
  updateModeBadge();
});
document.getElementById('btnLinkSpouse')?.addEventListener('click', ()=>{
  AppState.mode = 'linkSpouse';
  AppState.pendingLinkFrom = AppState.selectedId;
  updateModeBadge();
});

nodesLayer.addEventListener('click', (e)=>{
  const t = e.target.closest('.node');
  if(!t) return;
  const id = t.getAttribute('data-id');
  if(AppState.mode === 'idle') return;
  if(!AppState.pendingLinkFrom){
    AppState.pendingLinkFrom = id;
    updateModeBadge();
    return;
  }
  if(AppState.pendingLinkFrom === id){
    AppState.mode = 'idle';
    AppState.pendingLinkFrom = null;
    updateModeBadge();
    return;
  }

  if(AppState.mode === 'linkParent'){
    const parentId = AppState.pendingLinkFrom;
    const childId = id;
    if(createsParentCycle(AppState.data, parentId, childId)){
      alert('Collegamento rifiutato: creerebbe un ciclo impossibile.');
    }else{
      AppState.data.links.push({ type:'parent', fromId: parentId, toId: childId });
      AppState.setDirty(true);
    }
  }else if(AppState.mode === 'linkSpouse'){
    const a = AppState.pendingLinkFrom, b = id;
    if(haveSpouseLink(AppState.data, a, b)){
      alert('I due coniugi sono già collegati.');
    }else{
      AppState.data.links.push({ type:'spouse', fromId: a, toId: b });
      AppState.setDirty(true);
    }
  }

  AppState.mode = 'idle';
  AppState.pendingLinkFrom = null;
  render();
});

document.getElementById('btnDelete')?.addEventListener('click', ()=>{
  const id = AppState.selectedId;
  if(!id){ alert('Seleziona una persona'); return; }
  if(!confirm('Eliminare la persona selezionata? Saranno rimossi anche i collegamenti.')) return;
  AppState.data.people = AppState.data.people.filter(p => p.id !== id);
  AppState.data.links = AppState.data.links.filter(l => l.fromId !== id && l.toId !== id);
  AppState.selectedId = null;
  AppState.setDirty(true);
  bindEditor(null);
  render();
});

document.getElementById('btnSave')?.addEventListener('click', ()=>{
  Store.save(AppState.data);
  AppState.setDirty(false);
  updateModeBadge();
});

document.getElementById('btnExport')?.addEventListener('click', ()=>{
  Store.export(AppState.data);
});

document.getElementById('fileImport')?.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  try{
    const data = await Store.import(file);
    AppState.data = data;
    AppState.selectedId = null;
    AppState.mode = 'idle';
    AppState.pendingLinkFrom = null;
    Store.save(AppState.data);
    bindEditor(null);
    render();
    alert('Import completato!');
  }catch(err){
    console.error(err);
    alert('Import fallito: ' + err.message);
  }finally{
    e.target.value = '';
  }
});

document.getElementById('btnReset')?.addEventListener('click', ()=>{
  if(!confirm('Ripristinare i dati iniziali?')) return;
  Store.reset();
  AppState.data = Store.load();
  AppState.selectedId = null;
  AppState.mode = 'idle';
  AppState.pendingLinkFrom = null;
  bindEditor(null);
  render();
});

document.getElementById('btnCenter')?.addEventListener('click', ()=>{
  view.x = svg.clientWidth/2;
  view.y = 120;
  view.k = 1;
  applyView();
});

document.getElementById('btnFit')?.addEventListener('click', ()=>{
  if(AppState.data.people.length === 0) return;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  AppState.data.people.forEach(p => {
    const x = p.baseX + (p.x||0);
    const y = p.baseY + (p.y||0);
    minX = Math.min(minX, x-50);
    minY = Math.min(minY, y-70);
    maxX = Math.max(maxX, x+50);
    maxY = Math.max(maxY, y+70);
  });
  const width = maxX - minX;
  const height = maxY - minY;
  const vw = svg.clientWidth, vh = svg.clientHeight;
  const scale = Math.min((vw-80)/width, (vh-80)/height);
  view.k = Math.max(0.2, Math.min(2.5, scale));
  const centerX = (minX + maxX)/2;
  const centerY = (minY + maxY)/2;
  view.x = vw/2 - centerX * view.k;
  view.y = vh/2 - centerY * view.k;
  applyView();
});

// Ricerca
document.getElementById('searchInput')?.addEventListener('input', debounce((e)=>{
  const q = e.target.value.trim().toLowerCase();
  if(!q){ render(); return; }
  const found = AppState.data.people.find(p => (`${p.firstName} ${p.lastName}`).toLowerCase().includes(q));
  if(found){
    AppState.selectedId = found.id;
    render();
    const x = found.baseX + (found.x||0);
    const y = found.baseY + (found.y||0);
    const vw = svg.clientWidth, vh = svg.clientHeight;
    view.x = vw/2 - x * view.k;
    view.y = vh/2 - y * view.k - 40;
    applyView();
  }
}, 250));

// ---------- Scorciatoie ----------
document.addEventListener('keydown', (e)=>{
  if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if(e.key.toLowerCase() === 'n'){ document.getElementById('btnAdd')?.click(); }
  if(e.key.toLowerCase() === 'g'){ document.getElementById('btnLinkParent')?.click(); }
  if(e.key.toLowerCase() === 'c'){ document.getElementById('btnLinkSpouse')?.click(); }
  if(e.key.toLowerCase() === 's'){ e.preventDefault(); document.getElementById('btnSave')?.click(); }
  if(e.key === 'Delete'){ document.getElementById('btnDelete')?.click(); }
});

// ---------- Avvio ----------
function init(){
  bindEditor(null);
  render();
  document.getElementById('btnFit')?.click();
}
window.addEventListener('load', init);

/* Verdelago · Perdidos e Achados — public, read-only mirror of the internal
   dashboard (the /items view). Reproduces the same .item-tile markup so it looks
   identical; loads the privacy-safe data.json produced by export.js. No login,
   no editing — items are entered on the internal app on the resort network. */

// Same labels the dashboard uses (views/items/index.ejs).
const SL = { found:'Encontrado', stored:'Armazenado', returned:'Devolvido', disposed:'Descartado' };
const CL = { Clothing:'Roupa', Electronics:'Eletrónica', Documents:'Documentos', Keys:'Chaves',
  'Bags & Luggage':'Malas e Bagagem', 'Jewelry & Watches':'Joias e Relógios', Toiletries:'Artigos de Higiene',
  'Books & Media':'Livros e Média', 'Sports Equipment':'Equip. Desportivo', 'Children Items':'Artigos de Criança',
  Other:'Outros' };
const clabel = (c) => CL[c] || c || 'Outros';

const el = {
  grid:     document.getElementById('grid'),
  empty:    document.getElementById('empty'),
  pills:    document.getElementById('pills'),
  search:   document.getElementById('search'),
  category: document.getElementById('category'),
  updated:  document.getElementById('updated'),
  lb:       document.getElementById('lightbox'),
  lbImg:    document.getElementById('lb-img'),
  lbCap:    document.getElementById('lb-cap'),
};

let ITEMS = [];
let status = '';           // '', 'found', 'stored'
let lbSet = [], lbIdx = 0;

const esc = (s) => String(s == null ? '' : s);

function tile(item, idx) {
  const days = item.found_date ? Math.floor((Date.now() - new Date(item.found_date).getTime()) / 86400000) : -1;
  const daysLeft = 90 - days;
  const showTimer = days >= 0;
  const tClass = daysLeft <= 7 ? 'tchip--urgent' : (daysLeft <= 30 ? 'tchip--warn' : 'tchip--ok');
  const tLabel = daysLeft <= 0 ? 'Expirado!' : daysLeft + 'd';
  const delay = Math.min(idx * 32, 400);
  const img = item.images && item.images.length ? item.images[0] : null;

  const a = document.createElement('div');
  a.className = 'item-tile';
  a.style.animationDelay = delay + 'ms';
  a.setAttribute('role', 'button');
  a.tabIndex = 0;

  if (img) {
    const im = document.createElement('img');
    im.className = 'item-tile__img';
    im.loading = 'lazy';
    im.src = './' + img;
    im.alt = esc(item.title);
    a.appendChild(im);
    const ov = document.createElement('div');
    ov.className = 'item-tile__overlay';
    a.appendChild(ov);
  } else {
    const ph = document.createElement('div');
    ph.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
    ph.innerHTML = '<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    a.appendChild(ph);
  }

  const top = document.createElement('div');
  top.className = 'item-tile__top';
  const badge = document.createElement('span');
  badge.className = 'gbadge gbadge--' + esc(item.status);
  badge.innerHTML = '<span class="gbadge__dot"></span>' + (SL[item.status] || esc(item.status));
  top.appendChild(badge);
  if (showTimer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const t = document.createElement('span');
    t.className = 'tchip ' + tClass;
    t.textContent = tLabel;
    wrap.appendChild(t);
    top.appendChild(wrap);
  }
  a.appendChild(top);

  const bottom = document.createElement('div');
  bottom.className = 'item-tile__bottom';
  const title = document.createElement('div');
  title.className = 'item-tile__title';
  title.textContent = esc(item.title);
  const meta = document.createElement('div');
  meta.className = 'item-tile__meta';
  meta.textContent = item.found_location || clabel(item.category);
  bottom.appendChild(title);
  bottom.appendChild(meta);
  a.appendChild(bottom);

  if (img) a.addEventListener('click', () => openLightbox(item));
  return a;
}

function currentList() {
  const q = el.search.value.trim().toLowerCase();
  const cat = el.category.value;
  return ITEMS.filter((it) => {
    if (status && it.status !== status) return false;
    if (cat && it.category !== cat) return false;
    if (!q) return true;
    return [it.title, it.description, it.found_location, it.category, clabel(it.category)]
      .join(' ').toLowerCase().includes(q);
  });
}

function render() {
  const list = currentList();
  el.grid.textContent = '';
  el.empty.hidden = list.length > 0;
  el.grid.style.display = list.length ? 'grid' : 'none';
  const frag = document.createDocumentFragment();
  list.forEach((it, i) => frag.appendChild(tile(it, i)));
  el.grid.appendChild(frag);
}

function updateCounts() {
  const all = ITEMS.length;
  const found = ITEMS.filter((i) => i.status === 'found').length;
  const stored = ITEMS.filter((i) => i.status === 'stored').length;
  const set = { all, found, stored };
  el.pills.querySelectorAll('.fpill__n').forEach((n) => { n.textContent = set[n.dataset.count]; });
}

/* ---------- Lightbox ---------- */
function openLightbox(item) {
  lbSet = item.images.map((p) => './' + p);
  lbIdx = 0;
  el.lbCap.textContent = item.title || '';
  showLb();
  el.lb.hidden = false;
  document.body.style.overflow = 'hidden';
}
function showLb() {
  el.lbImg.src = lbSet[lbIdx];
  el.lb.querySelector('.lb__prev').style.visibility = lbSet.length > 1 ? 'visible' : 'hidden';
  el.lb.querySelector('.lb__next').style.visibility = lbSet.length > 1 ? 'visible' : 'hidden';
}
function closeLb() { el.lb.hidden = true; el.lbImg.src = ''; document.body.style.overflow = ''; }
function stepLb(d) { lbIdx = (lbIdx + d + lbSet.length) % lbSet.length; showLb(); }
el.lb.querySelector('.lb__close').addEventListener('click', closeLb);
el.lb.querySelector('.lb__prev').addEventListener('click', () => stepLb(-1));
el.lb.querySelector('.lb__next').addEventListener('click', () => stepLb(1));
el.lb.addEventListener('click', (e) => { if (e.target === el.lb) closeLb(); });
document.addEventListener('keydown', (e) => {
  if (el.lb.hidden) return;
  if (e.key === 'Escape') closeLb();
  if (e.key === 'ArrowLeft') stepLb(-1);
  if (e.key === 'ArrowRight') stepLb(1);
});

/* ---------- Events ---------- */
el.pills.addEventListener('click', (e) => {
  const pill = e.target.closest('.fpill');
  if (!pill) return;
  e.preventDefault();
  status = pill.dataset.status;
  el.pills.querySelectorAll('.fpill').forEach((p) => p.classList.toggle('fpill--active', p === pill));
  render();
});
el.search.addEventListener('input', render);
el.category.addEventListener('change', render);

/* ---------- Boot ---------- */
fetch('./data.json?v=' + Date.now(), { cache: 'no-store' })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((data) => {
    ITEMS = Array.isArray(data.items) ? data.items : [];
    const cats = [...new Set(ITEMS.map((i) => i.category).filter(Boolean))].sort((a, b) => clabel(a).localeCompare(clabel(b), 'pt'));
    for (const c of cats) {
      const o = document.createElement('option');
      o.value = c; o.textContent = clabel(c);
      el.category.appendChild(o);
    }
    if (data.updated) {
      const d = new Date(data.updated);
      el.updated.textContent = 'Atualizado a ' + d.toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    }
    updateCounts();
    render();
  })
  .catch((err) => {
    el.empty.hidden = false;
    el.empty.querySelector('.empty-state__title').textContent = 'Não foi possível carregar a lista';
    console.error('data.json load failed:', err);
  });

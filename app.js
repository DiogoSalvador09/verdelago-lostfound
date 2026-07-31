/* Verdelago · Perdidos e Achados — public read-only viewer.
   Loads data.json (produced by export.js on the resort PC) and renders a
   searchable gallery. No login, no writing: entry stays on the internal app. */

// Edit these to show a real contact on the footer (optional).
const CONTACT = {
  note: 'Reconhece um artigo como seu? Contacte a receção do Verdelago Resort e indique a referência (Ref.).',
  phone: '',              // ex.: '+351 281 531 000'
  email: '',              // ex.: 'rececao@verdelago.com'
};

const CAT = {
  'Clothing':            { pt: 'Roupa',                  icon: '👕' },
  'Bags & Luggage':      { pt: 'Malas e Bagagem',        icon: '🧳' },
  'Children Items':      { pt: 'Artigos de Criança',     icon: '🧸' },
  'Sports Equipment':    { pt: 'Equipamento Desportivo', icon: '⚽' },
  'Electronics':         { pt: 'Eletrónica',             icon: '🎧' },
  'Jewelry & Watches':   { pt: 'Joalharia e Relógios',   icon: '⌚' },
  'Documents':           { pt: 'Documentos',             icon: '📄' },
  'Keys':                { pt: 'Chaves',                 icon: '🔑' },
  'Toiletries':          { pt: 'Higiene',                icon: '🧴' },
  'Books & Media':       { pt: 'Livros e Media',         icon: '📚' },
  'Other':               { pt: 'Outros',                 icon: '📦' },
};
const catPT   = (c) => (CAT[c] && CAT[c].pt)   || c || 'Outros';
const catIcon = (c) => (CAT[c] && CAT[c].icon) || '📦';

const el = {
  grid:     document.getElementById('grid'),
  status:   document.getElementById('status'),
  search:   document.getElementById('search'),
  category: document.getElementById('category'),
  updated:  document.getElementById('updated'),
  footClaim:document.getElementById('foot-claim'),
  lb:       document.getElementById('lightbox'),
  lbImg:    document.getElementById('lightbox-img'),
  lbCap:    document.getElementById('lightbox-caption'),
};

let ITEMS = [];
let lbSet = [];   // current lightbox image list
let lbIdx = 0;

function fmtDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function render(list) {
  el.grid.textContent = '';
  if (!list.length) {
    el.status.textContent = 'Nenhum artigo corresponde à procura.';
    return;
  }
  el.status.textContent = `${list.length} ${list.length === 1 ? 'artigo' : 'artigos'}`;

  const frag = document.createDocumentFragment();
  for (const it of list) {
    const card = document.createElement('article');
    card.className = 'card';

    // media
    if (it.images && it.images.length) {
      const btn = document.createElement('button');
      btn.className = 'card__media';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Ver foto');
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = './' + it.images[0];
      img.alt = it.title || 'Artigo';
      btn.appendChild(img);
      if (it.images.length > 1) {
        const c = document.createElement('span');
        c.className = 'card__count';
        c.textContent = `1/${it.images.length}`;
        btn.appendChild(c);
      }
      btn.addEventListener('click', () => openLightbox(it));
      card.appendChild(btn);
    } else {
      const ph = document.createElement('div');
      ph.className = 'card__media card__media--empty';
      ph.textContent = catIcon(it.category);
      card.appendChild(ph);
    }

    // body
    const body = document.createElement('div');
    body.className = 'card__body';

    const title = document.createElement('div');
    title.className = 'card__title';
    title.textContent = it.title || 'Artigo';
    body.appendChild(title);

    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `${catIcon(it.category)} ${catPT(it.category)}`;
    body.appendChild(chip);

    if (it.description) {
      const d = document.createElement('p');
      d.className = 'card__desc';
      d.textContent = it.description;
      body.appendChild(d);
    }

    const meta = document.createElement('div');
    meta.className = 'card__meta';
    if (it.found_location) {
      const loc = document.createElement('span');
      loc.textContent = `📍 ${it.found_location}`;
      meta.appendChild(loc);
    }
    if (it.found_date) {
      const dt = document.createElement('span');
      dt.textContent = `🗓 Encontrado a ${fmtDate(it.found_date)}`;
      meta.appendChild(dt);
    }
    const ref = document.createElement('span');
    ref.className = 'card__ref';
    ref.textContent = `Ref. #${it.id}`;
    meta.appendChild(ref);
    body.appendChild(meta);

    card.appendChild(body);
    frag.appendChild(card);
  }
  el.grid.appendChild(frag);
}

function applyFilters() {
  const q = el.search.value.trim().toLowerCase();
  const cat = el.category.value;
  const list = ITEMS.filter((it) => {
    if (cat && it.category !== cat) return false;
    if (!q) return true;
    const hay = [it.title, it.description, it.found_location, it.category, catPT(it.category), '#' + it.id]
      .join(' ').toLowerCase();
    return hay.includes(q);
  });
  render(list);
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
  el.lb.querySelector('.lightbox__prev').style.visibility = lbSet.length > 1 ? 'visible' : 'hidden';
  el.lb.querySelector('.lightbox__next').style.visibility = lbSet.length > 1 ? 'visible' : 'hidden';
}
function closeLb() { el.lb.hidden = true; el.lbImg.src = ''; document.body.style.overflow = ''; }
function stepLb(d) { lbIdx = (lbIdx + d + lbSet.length) % lbSet.length; showLb(); }

el.lb.querySelector('.lightbox__close').addEventListener('click', closeLb);
el.lb.querySelector('.lightbox__prev').addEventListener('click', () => stepLb(-1));
el.lb.querySelector('.lightbox__next').addEventListener('click', () => stepLb(1));
el.lb.addEventListener('click', (e) => { if (e.target === el.lb) closeLb(); });
document.addEventListener('keydown', (e) => {
  if (el.lb.hidden) return;
  if (e.key === 'Escape') closeLb();
  if (e.key === 'ArrowLeft') stepLb(-1);
  if (e.key === 'ArrowRight') stepLb(1);
});

/* ---------- Boot ---------- */
el.search.addEventListener('input', applyFilters);
el.category.addEventListener('change', applyFilters);

if (CONTACT.note) el.footClaim.textContent = CONTACT.note;
const extra = [CONTACT.phone && `☎ ${CONTACT.phone}`, CONTACT.email && `✉ ${CONTACT.email}`].filter(Boolean).join('   ·   ');
if (extra) { const p = document.createElement('p'); p.textContent = extra; el.footClaim.after(p); }

fetch('./data.json?v=' + Date.now(), { cache: 'no-store' })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((data) => {
    ITEMS = Array.isArray(data.items) ? data.items : [];
    // category dropdown from data present
    const cats = [...new Set(ITEMS.map((i) => i.category).filter(Boolean))]
      .sort((a, b) => catPT(a).localeCompare(catPT(b), 'pt'));
    for (const c of cats) {
      const o = document.createElement('option');
      o.value = c; o.textContent = `${catIcon(c)} ${catPT(c)}`;
      el.category.appendChild(o);
    }
    if (data.updated) {
      const d = new Date(data.updated);
      el.updated.textContent = 'Atualizado a ' + d.toLocaleString('pt-PT', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    }
    applyFilters();
  })
  .catch((err) => {
    el.status.textContent = 'Não foi possível carregar a lista neste momento.';
    console.error('data.json load failed:', err);
  });

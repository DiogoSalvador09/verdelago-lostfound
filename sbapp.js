/* Verdelago · Perdidos e Achados — Supabase-backed app on GitHub Pages.
   Behind a shared login (RLS: only authenticated read/write), so guest data is
   never public. Two roles (from the user's app_metadata):
     · manager      -> full dashboard (list, search, +Novo)
     · housekeeping -> upload-only: first-run name, then just photo + send */

const sb = supabase.createClient(CONFIG.url, CONFIG.anon);
const HK_NAMES = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.hkNames)) ? CONFIG.hkNames : [];

const SL = { found:'Encontrado', stored:'Armazenado', returned:'Devolvido', disposed:'Descartado' };
const CL = { Clothing:'Roupa', Electronics:'Eletrónica', Documents:'Documentos', Keys:'Chaves',
  'Bags & Luggage':'Malas e Bagagem', 'Jewelry & Watches':'Joias e Relógios', Toiletries:'Artigos de Higiene',
  'Books & Media':'Livros e Média', 'Sports Equipment':'Equip. Desportivo', 'Children Items':'Artigos de Criança', Other:'Outros' };
const CATS = Object.keys(CL);
const STORES = ['', 'Back Office - Caixa de L&F', 'Back Office - Cofres', 'Housekeeping Storage', 'Sala de Bagagens 1 (Trancada)', 'Sala de Bagagens 2 (Aberta)'];
const clabel = (c) => CL[c] || c || 'Outros';
const esc = (s) => String(s == null ? '' : s);
const $ = (id) => document.getElementById(id);

function guessCat(t) {
  t = (t || '').toLowerCase();
  const m = [
    [/óculos|oculos|sunglass|glasses/, 'Jewelry & Watches'], [/relógio|relogio|watch|pulseira|colar|anel|brinco|joia/, 'Jewelry & Watches'],
    [/carreg|charger|telem|phone|iphone|fones|headphone|auscult|cabo|power ?bank|portátil|laptop|tablet|camera|câmara/, 'Electronics'],
    [/passaporte|cartão|cartao|bilhete|documento|carta/, 'Documents'], [/chave|key/, 'Keys'],
    [/mala|mochila|saco|bolsa|carteira|bag|luggage/, 'Bags & Luggage'],
    [/toalha|roupa|casaco|camisa|t-?shirt|calç|chapéu|chapeu|boné|bone|fato|biquini|bikini|sapato|ténis|tenis|meia/, 'Clothing'],
    [/bola|raquete|touca|barbatana|prancha|bike|bicicleta/, 'Sports Equipment'],
    [/livro|revista|book|kobo|kindle/, 'Books & Media'],
    [/creme|escova|pasta|higiene|shampoo|perfume/, 'Toiletries'], [/criança|crianca|bebé|bebe|brinquedo|fralda|chupeta/, 'Children Items'],
  ];
  for (const [re, c] of m) if (re.test(t)) return c;
  return 'Other';
}

function compress(file) {
  return new Promise(res => {
    if (!/^image\//.test(file.type)) return res(file);
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url); let { width: w, height: h } = im; const max = 1600;
      if (Math.max(w, h) > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h);
      c.toBlob(b => res(b || file), 'image/jpeg', 0.7);
    };
    im.onerror = () => { URL.revokeObjectURL(url); res(file); };
    im.src = url;
  });
}

const nameKey = (s) => (s || '').trim().toLowerCase();

// Every person who enters a name gets a row in `staff` — so managers can see who
// is using the app, since when, and everything each of them has registered.
function deviceId() {
  try {
    let d = localStorage.getItem('device_id');
    if (!d) { d = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('device_id', d); }
    return d;
  } catch (e) { return null; }
}
async function recordStaff(name) {
  const key = nameKey(name);
  if (!key) return;
  try {
    await sb.from('staff').upsert(
      { name: name.trim(), name_key: key, device_id: deviceId(), last_seen: new Date().toISOString() },
      { onConflict: 'name_key' }
    );
  } catch (e) { /* never block a registration because the register failed */ }
}

// Shared insert+upload used by BOTH the manager form and the housekeeping form.
async function createItem(fields, files) {
  const { data: row, error } = await sb.from('items').insert({
    title: fields.title, category: fields.category || guessCat(fields.title), status: 'found',
    found_location: fields.found_location || '', storage_location: fields.storage_location || '',
    found_by: fields.found_by || '', found_by_key: nameKey(fields.found_by), source: fields.source || 'app',
  }).select().single();
  if (error) throw error;
  const paths = [];
  for (let i = 0; i < files.length; i++) {
    const blob = await compress(files[i]);
    const p = `${row.id}/${Date.now()}-${i}.jpg`;
    const { error: ue } = await sb.storage.from('items').upload(p, blob, { contentType: 'image/jpeg', upsert: true });
    if (!ue) paths.push(p);
  }
  if (paths.length) await sb.from('items').update({ photos: paths }).eq('id', row.id);
  return row;
}

/* ================= One-year sign-in ================= */
// Supabase can enforce this server-side (sessions_timebox) but only on paid
// plans, so we hold the clock here: the session itself refreshes forever, and
// after a year we deliberately sign out and ask for the password again.
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
function stampAuth() { try { localStorage.setItem('auth_since', String(Date.now())); } catch (e) {} }
function authAge() {
  try { const v = parseInt(localStorage.getItem('auth_since') || '0', 10); return v ? Date.now() - v : null; }
  catch (e) { return null; }
}
async function enforceYear(session) {
  const age = authAge();
  if (age === null) { stampAuth(); return session; }   // first time we've seen it — start the clock
  if (age > YEAR_MS) {
    await sb.auth.signOut();
    try { localStorage.removeItem('auth_since'); } catch (e) {}
    return null;
  }
  return session;
}

/* ================= Auth / routing ================= */
function showLogin(msg) {
  $('appwrap').hidden = true; $('hk').hidden = true; $('login').style.display = 'flex';
  if (msg) { const e = $('login-err'); e.textContent = msg; e.style.display = 'block'; }
}
function route(session) {
  $('login').style.display = 'none';
  const role = (session.user.app_metadata && session.user.app_metadata.role) || 'manager';
  if (role === 'housekeeping') initHK(); else showApp();
}
async function doLogin() {
  const u = $('u').value.trim(), p = $('p').value;
  if (!u || !p) return;
  // lowercase on purpose: phone keyboards auto-capitalise the first letter, so
  // "Verdelago" must reach the same account as "verdelago".
  const email = (u.includes('@') ? u : u + '@verdelago.pt').toLowerCase();
  $('login-btn').disabled = true; $('login-btn').textContent = 'A entrar…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: p });
  $('login-btn').disabled = false; $('login-btn').textContent = 'Entrar';
  if (error || !data.session) { const e = $('login-err'); e.textContent = 'Utilizador ou palavra-passe inválidos.'; e.style.display = 'block'; return; }
  stampAuth();
  route(data.session);
}
$('login-btn').addEventListener('click', doLogin);
$('p').addEventListener('keyup', (e) => { if (e.key === 'Enter') doLogin(); });
$('logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

/* ================= Manager dashboard ================= */
let ITEMS = [], status = '', signedCache = {};
async function showApp() {
  $('appwrap').hidden = false; $('hk').hidden = true;
  await loadItems();
}
async function loadItems() {
  const { data, error } = await sb.from('items').select('*').order('found_date', { ascending: false }).order('id', { ascending: false });
  if (error) { $('empty').hidden = false; $('empty').querySelector('.empty-state__title').textContent = 'Erro ao carregar'; return; }
  ITEMS = data || [];
  const firsts = ITEMS.filter(i => i.photos && i.photos.length).map(i => i.photos[0]);
  if (firsts.length) { const { data: s } = await sb.storage.from('items').createSignedUrls(firsts, 3600); (s || []).forEach(x => { if (x.signedUrl) signedCache[x.path] = x.signedUrl; }); }
  buildCats(); updateCounts(); render();
}
function buildCats() {
  const sel = $('catf'); sel.length = 1;
  [...new Set(ITEMS.map(i => i.category).filter(Boolean))].sort((a, b) => clabel(a).localeCompare(clabel(b), 'pt'))
    .forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = clabel(c); sel.appendChild(o); });
}
function updateCounts() {
  const s = { all: ITEMS.length, found: ITEMS.filter(i => i.status === 'found').length, stored: ITEMS.filter(i => i.status === 'stored').length };
  document.querySelectorAll('#pills .fpill__n').forEach(n => n.textContent = s[n.dataset.c]);
}
function currentList() {
  const q = $('q').value.trim().toLowerCase(), cat = $('catf').value;
  return ITEMS.filter(it => {
    if (status && it.status !== status) return false;
    if (cat && it.category !== cat) return false;
    if (!q) return true;
    return [it.title, it.description, it.found_location, it.found_by, clabel(it.category)].join(' ').toLowerCase().includes(q);
  });
}
function tile(it, idx) {
  const days = it.found_date ? Math.floor((Date.now() - new Date(it.found_date).getTime()) / 864e5) : -1;
  const left = 90 - days, tc = left <= 7 ? 'tchip--urgent' : (left <= 30 ? 'tchip--warn' : 'tchip--ok');
  const a = document.createElement('div');
  a.className = 'item-tile'; a.style.animationDelay = Math.min(idx * 32, 400) + 'ms'; a.tabIndex = 0;
  const url = it.photos && it.photos.length ? signedCache[it.photos[0]] : null;
  a.innerHTML = url
    ? `<img class="item-tile__img" loading="lazy" src="${url}" alt=""><div class="item-tile__overlay"></div>`
    : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;
  const top = document.createElement('div'); top.className = 'item-tile__top';
  top.innerHTML = `<span class="gbadge gbadge--${esc(it.status)}"><span class="gbadge__dot"></span>${SL[it.status] || esc(it.status)}</span>` + (days >= 0 ? `<span class="tchip ${tc}">${left <= 0 ? 'Expirado!' : left + 'd'}</span>` : '');
  const bot = document.createElement('div'); bot.className = 'item-tile__bottom';
  bot.innerHTML = `<div class="item-tile__title"></div><div class="item-tile__meta"></div>`;
  bot.querySelector('.item-tile__title').textContent = it.title || 'Artigo';
  bot.querySelector('.item-tile__meta').textContent = it.found_location || clabel(it.category);
  a.appendChild(top); a.appendChild(bot);
  if (it.photos && it.photos.length) a.addEventListener('click', () => openLb(it));
  return a;
}
function render() {
  const list = currentList(), g = $('grid');
  g.textContent = ''; $('empty').hidden = list.length > 0; g.style.display = list.length ? 'grid' : 'none';
  const f = document.createDocumentFragment(); list.forEach((it, i) => f.appendChild(tile(it, i))); g.appendChild(f);
  $('count').textContent = `${list.length} ${list.length === 1 ? 'artigo' : 'artigos'}`;
}
$('pills').addEventListener('click', (e) => { const p = e.target.closest('.fpill'); if (!p) return; e.preventDefault(); status = p.dataset.status; document.querySelectorAll('#pills .fpill').forEach(x => x.classList.toggle('fpill--active', x === p)); render(); });
$('q').addEventListener('input', render);
$('catf').addEventListener('change', render);

/* ---------- Equipa: who is using the app, and what each of them registered ---------- */
let STAFF = [];
const fmtDay = (s) => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('pt-PT', { day:'2-digit', month:'2-digit', year:'numeric' }); };

async function loadStaff() {
  const { data } = await sb.from('staff').select('*').order('name');
  STAFF = data || [];
  renderTeam();
}
function renderTeam() {
  const box = $('team');
  // people who registered items but predate the register still deserve a row
  const seen = new Map(STAFF.map(s => [s.name_key, { ...s }]));
  for (const it of ITEMS) {
    const k = (it.found_by || '').trim().toLowerCase();
    if (!k) continue;
    if (!seen.has(k)) seen.set(k, { name: it.found_by.trim(), name_key: k, first_seen: null, last_seen: null, legacy: true });
  }
  const people = [...seen.values()].map(p => {
    const items = ITEMS.filter(i => (i.found_by || '').trim().toLowerCase() === p.name_key);
    return { ...p, items };
  }).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'pt'));

  if (!people.length) { box.innerHTML = '<div class="empty-state" style="padding:60px 20px;"><div class="empty-state__title">Ainda ninguém registou o nome</div></div>'; return; }

  box.innerHTML = people.map((p, idx) => `
    <div class="person" data-i="${idx}">
      <div class="person__head">
        <span class="person__chev">›</span>
        <span class="person__name"></span>
        <span class="person__count">${p.items.length} ${p.items.length === 1 ? 'artigo' : 'artigos'}</span>
        <span class="person__meta">
          ${p.first_seen ? 'Desde ' + fmtDay(p.first_seen) : 'Registos anteriores à app'}<br>
          ${p.last_seen ? 'Última vez ' + fmtDay(p.last_seen) : ''}
        </span>
      </div>
      <div class="person__items" hidden></div>
    </div>`).join('');

  // names via textContent so a staff-entered name can never inject markup
  box.querySelectorAll('.person').forEach((el, i) => {
    const p = people[i];
    el.querySelector('.person__name').textContent = p.name;
    el.querySelector('.person__head').addEventListener('click', async () => {
      const wrap = el.querySelector('.person__items');
      const open = !wrap.hidden;
      wrap.hidden = open; el.classList.toggle('person--open', !open);
      if (!open && !wrap.dataset.filled) {
        const paths = p.items.filter(x => x.photos && x.photos.length).map(x => x.photos[0]);
        let signed = {};
        if (paths.length) {
          const { data } = await sb.storage.from('items').createSignedUrls(paths, 3600);
          (data || []).forEach(s => { if (s.signedUrl) signed[s.path] = s.signedUrl; });
        }
        wrap.innerHTML = p.items.map(it => {
          const u = it.photos && it.photos.length ? signed[it.photos[0]] : null;
          return `<div class="pitem">${u ? `<img src="${u}" alt="">` : ''}<div class="pitem__b"><div class="pitem__t"></div><div class="pitem__d">${fmtDay(it.found_date)}${it.found_location ? ' · ' + '' : ''}</div></div></div>`;
        }).join('');
        wrap.querySelectorAll('.pitem').forEach((n, j) => { n.querySelector('.pitem__t').textContent = p.items[j].title || 'Artigo'; });
        wrap.dataset.filled = '1';
      }
    });
  });
}
$('view-seg').addEventListener('click', (e) => {
  const t = e.target.closest('.vtab'); if (!t) return;
  const v = t.dataset.view;
  document.querySelectorAll('#view-seg .vtab').forEach(x => x.classList.toggle('vtab--active', x === t));
  const showItems = v === 'items';
  $('grid').style.display = showItems ? 'grid' : 'none';
  $('filters').hidden = !showItems;
  $('team').hidden = showItems;
  $('empty').hidden = true;
  if (showItems) render(); else loadStaff();
});

/* lightbox */
let lbSet = [], lbIdx = 0;
async function openLb(it) {
  const { data } = await sb.storage.from('items').createSignedUrls(it.photos, 3600);
  lbSet = (data || []).map(d => d.signedUrl).filter(Boolean); lbIdx = 0;
  if (!lbSet.length) return;
  $('lb-img').src = lbSet[0]; $('lb').hidden = false; document.body.style.overflow = 'hidden';
}
function lbStep(d) { lbIdx = (lbIdx + d + lbSet.length) % lbSet.length; $('lb-img').src = lbSet[lbIdx]; }
$('lb').querySelector('.cl').addEventListener('click', () => { $('lb').hidden = true; document.body.style.overflow = ''; });
$('lb').querySelector('.pv').addEventListener('click', () => lbStep(-1));
$('lb').querySelector('.nx').addEventListener('click', () => lbStep(1));

/* manager +Novo modal */
let selected = [];
CATS.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = clabel(c); $('up-cat').appendChild(o); });
STORES.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s || '— não definido —'; $('up-store').appendChild(o); });
$('new-btn').addEventListener('click', () => { $('up').hidden = false; });
$('up-close').addEventListener('click', closeUp);
function closeUp() { $('up').hidden = true; selected = []; $('up-prev').innerHTML = ''; $('up-form').reset(); $('up-sending').hidden = true; $('up-done').hidden = true; }
$('up-title').addEventListener('input', () => { $('up-cat').value = guessCat($('up-title').value); });
$('up-img').addEventListener('change', function () { Array.prototype.forEach.call(this.files, f => { if (selected.length < 5) selected.push(f); }); renderPrev($('up-prev'), selected); });
function renderPrev(box, arr) {
  box.innerHTML = '';
  arr.forEach((file, i) => {
    const w = document.createElement('div'); w.className = 'pwrap';
    const im = document.createElement('img'); const r = new FileReader(); r.onload = e => im.src = e.target.result; r.readAsDataURL(file); w.appendChild(im);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'rm'; b.innerHTML = '&times;'; b.onclick = () => { arr.splice(i, 1); renderPrev(box, arr); }; w.appendChild(b);
    box.appendChild(w);
  });
}
$('up-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('up-title').value.trim(); if (!title) return;
  $('up-sending').hidden = false;
  try {
    await createItem({ title, category: $('up-cat').value, found_location: $('up-loc').value.trim(), storage_location: $('up-store').value, found_by: $('up-by').value.trim(), source: 'app' }, selected);
    $('up-sending').hidden = true; $('up-done').hidden = false; await loadItems();
  } catch (err) { $('up-sending').hidden = true; alert('Não foi possível registar: ' + (err.message || err)); }
});
$('up-again').addEventListener('click', () => { closeUp(); $('up').hidden = false; });

/* ================= Housekeeping (upload-only) ================= */
let hkFiles = [];
function initHK() {
  $('appwrap').hidden = true; $('hk').hidden = false;
  let name = ''; try { name = localStorage.getItem('hk_name') || ''; } catch (e) {}
  if (name) startHKMain(name); else showOnboard();
}
function showOnboard() {
  $('hk-main').hidden = true; $('hk-onboard').hidden = false;
  const chips = $('hk-chips'); chips.innerHTML = ''; let picked = '';
  HK_NAMES.forEach(n => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = n;
    b.onclick = () => { picked = n; $('hk-name-input').value = n; chips.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b)); };
    chips.appendChild(b);
  });
  $('hk-ob-go').onclick = () => {
    const val = ($('hk-name-input').value || picked || '').trim();
    if (!val) { $('hk-name-input').focus(); return; }
    try { localStorage.setItem('hk_name', val); } catch (e) {}
    recordStaff(val);              // register the person the moment they identify themselves
    startHKMain(val);
  };
}
function startHKMain(name) {
  $('hk-onboard').hidden = true; $('hk-main').hidden = false;
  $('hk-name').textContent = name;
  $('hk-sending').hidden = true; $('hk-done').hidden = true;
}
$('hk-menu').addEventListener('click', () => { $('hk-pop').hidden = !$('hk-pop').hidden; });
$('hk-change').addEventListener('click', () => { $('hk-pop').hidden = true; try { localStorage.removeItem('hk_name'); } catch (e) {} showOnboard(); });
$('hk-logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
$('hk-img').addEventListener('change', function () { Array.prototype.forEach.call(this.files, f => { if (hkFiles.length < 5) hkFiles.push(f); }); renderPrev($('hk-prev'), hkFiles); });
$('hk-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('hk-title').value.trim(); if (!title) return;
  let name = ''; try { name = localStorage.getItem('hk_name') || ''; } catch (e2) {}
  $('hk-sending').hidden = false;
  try {
    await createItem({ title, found_location: $('hk-loc').value.trim(), found_by: name, source: 'housekeeping' }, hkFiles);
    recordStaff(name);             // keeps last_seen current

    hkFiles = []; $('hk-prev').innerHTML = ''; $('hk-form').reset();
    $('hk-sending').hidden = true; $('hk-done').hidden = false;
  } catch (err) { $('hk-sending').hidden = true; alert('Não foi possível registar: ' + (err.message || err)); }
});
$('hk-again').addEventListener('click', () => { $('hk-done').hidden = true; });

/* ================= Install prompt (Android) ================= */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e;
  const bar = $('install-bar'); if (bar) bar.hidden = false;
});
window.addEventListener('appinstalled', () => { const b = $('install-bar'); if (b) b.hidden = true; deferredPrompt = null; });
document.addEventListener('DOMContentLoaded', () => {
  const btn = $('install-go');
  if (btn) btn.addEventListener('click', async () => {
    if (!deferredPrompt) { $('install-bar').hidden = true; return; }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null; $('install-bar').hidden = true;
  });
  const dismiss = $('install-no');
  if (dismiss) dismiss.addEventListener('click', () => { $('install-bar').hidden = true; });
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

/* ================= Boot ================= */
// A QR poster carries #k=<code>. The code maps to a login below, so the
// housekeeping team never types (or even sees) a password: scan → signed in →
// asked only for their name. The code is not the password; swapping it later
// only means reprinting the poster.
const QR_LOGINS = {
  hk: { email: 'housekeeping@verdelago.pt', password: 'Housekeeping2026' },
};
async function tryQrLogin() {
  const m = (location.hash || '').match(/[#&]k=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const creds = QR_LOGINS[m[1]];
  // clear the hash immediately so the code isn't left sitting in the address bar
  history.replaceState(null, '', location.pathname + location.search);
  if (!creds) return null;
  const { data, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) return null;
  stampAuth();
  return data.session;
}

(async () => {
  const { data } = await sb.auth.getSession();
  if (data && data.session) {
    const still = await enforceYear(data.session);
    if (still) { route(still); return; }
    showLogin('Passou um ano desde a última entrada. Introduza a palavra-passe novamente.');
    return;
  }
  const qr = await tryQrLogin();
  if (qr) { route(qr); return; }
  showLogin();
})();

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
let ITEMS = [], status = '', signedCache = {}, view = 'items';
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
  [...new Set(ITEMS.filter(onShelf).map(i => i.category).filter(Boolean))].sort((a, b) => clabel(a).localeCompare(clabel(b), 'pt'))
    .forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = clabel(c); sel.appendChild(o); });
}
// Once an item is handed back it belongs to the Devoluções tab, not the shelf.
const onShelf = (it) => it.status !== 'returned';
function updateCounts() {
  const live = ITEMS.filter(onShelf);
  const s = { all: live.length, found: live.filter(i => i.status === 'found').length, stored: live.filter(i => i.status === 'stored').length };
  document.querySelectorAll('#pills .fpill__n').forEach(n => n.textContent = s[n.dataset.c]);
}
function currentList() {
  const q = $('q').value.trim().toLowerCase(), cat = $('catf').value;
  return ITEMS.filter(it => {
    if (!onShelf(it)) return false;
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
  // a returned or discarded item has no deadline left to count down
  const open = it.status !== 'returned' && it.status !== 'disposed';
  const top = document.createElement('div'); top.className = 'item-tile__top';
  top.innerHTML = `<span class="gbadge gbadge--${esc(it.status)}"><span class="gbadge__dot"></span>${SL[it.status] || esc(it.status)}</span>` + (days >= 0 && open ? `<span class="tchip ${tc}">${left <= 0 ? 'Expirado!' : left + 'd'}</span>` : '');
  const bot = document.createElement('div'); bot.className = 'item-tile__bottom';
  bot.innerHTML = `<div class="item-tile__title"></div><div class="item-tile__meta"></div>`;
  bot.querySelector('.item-tile__title').textContent = it.title || 'Artigo';
  bot.querySelector('.item-tile__meta').textContent = it.found_location || clabel(it.category);
  a.appendChild(top); a.appendChild(bot);
  // every tile opens the full record — items without a photo included
  a.addEventListener('click', () => openDetail(it));
  a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(it); } });
  return a;
}
function render() {
  const list = currentList(), g = $('grid');
  g.textContent = '';
  const f = document.createDocumentFragment(); list.forEach((it, i) => f.appendChild(tile(it, i))); g.appendChild(f);
  if (view !== 'items') return;          // another tab owns the header count and what's visible
  $('empty').hidden = list.length > 0; g.style.display = list.length ? 'grid' : 'none';
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
  view = t.dataset.view;
  document.querySelectorAll('#view-seg .vtab').forEach(x => x.classList.toggle('vtab--active', x === t));
  $('grid').style.display = view === 'items' ? 'grid' : 'none';
  $('filters').hidden = view !== 'items';
  $('returns').hidden = view !== 'returns';
  $('team').hidden = view !== 'team';
  $('empty').hidden = true;
  if (view === 'items') render();
  else if (view === 'returns') renderReturns();
  else loadStaff();
});

/* ================= Full-screen layers (detail, upload, lightbox) =================
   Every layer must be closable three ways — its own visible Voltar/×, the Esc
   key, and the phone's Back button — otherwise a phone with no visible browser
   chrome traps the user until they reload. Each open pushes a history entry;
   the close buttons just go back, and popstate does the actual closing, so the
   stack and the DOM can never disagree. */
const LAYERS = [];
function pushLayer(closeFn) {
  LAYERS.push(closeFn);
  document.body.style.overflow = 'hidden';
  try { history.pushState({ lf: LAYERS.length }, ''); } catch (e) {}
}
function closeLayer() {                       // called by Voltar / × / Esc
  if (!LAYERS.length) return;
  try { history.back(); } catch (e) { runTopLayer(); }
}
function runTopLayer() {
  const fn = LAYERS.pop();
  if (fn) fn();
  if (!LAYERS.length) document.body.style.overflow = '';
}
window.addEventListener('popstate', () => { if (LAYERS.length) runTopLayer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && LAYERS.length) closeLayer(); });

/* ================= Item detail ================= */
const fmtDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? String(s) : d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
};
// "Origem" only earns a row when it tells reception something they can act on.
// 75 of 76 items say they came from the old system, which is noise — so those
// show nothing at all rather than a line nobody can interpret.
const SOURCE_L = { app: 'Registado na app', housekeeping: 'Registado pelo housekeeping', web: 'Registado na app' };
const slabel = (s) => SOURCE_L[s] || '';
const ST_FLOW = [['found', 'Encontrado'], ['stored', 'Armazenado'], ['returned', 'Devolvido'], ['disposed', 'Descartado']];

/* ---------- The return record ----------
   Who took the item, when, and against what ID belongs in its own columns
   (claimed_by / claimed_date / claimed_notes) — but adding columns needs the
   Supabase service key, which this machine does not hold. So it is stored as
   one tagged JSON line inside `notes`: machine-readable, never shown raw to
   staff, and a straight lift into real columns the day they exist. */
const RT_RE = /^\[devolucao\]\s*(\{.*\})[ \t]*$/m;
function parseReturn(notes) {
  const m = (notes || '').match(RT_RE);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}
function stripReturn(notes) {
  return (notes || '').replace(RT_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}
function withReturn(notes, rec) {
  const base = stripReturn(notes);
  return (base ? base + '\n\n' : '') + '[devolucao] ' + JSON.stringify(rec);
}

let DV = null;                 // item currently on screen
let dvPhotos = [], dvIdx = 0;  // signed urls for its photos

async function openDetail(it) {
  DV = it; dvPhotos = []; dvIdx = 0;
  $('dv-top-title').textContent = it.title || 'Artigo';
  $('dv').hidden = false;
  $('dv').scrollTop = 0;
  pushLayer(() => { $('dv').hidden = true; DV = null; });
  renderDetail();
  if (it.photos && it.photos.length) {
    const { data } = await sb.storage.from('items').createSignedUrls(it.photos, 3600);
    if (DV !== it) return;                     // closed (or another item opened) while signing
    dvPhotos = (data || []).map(d => d.signedUrl).filter(Boolean);
    renderDetail();
  }
}
$('dv-back').addEventListener('click', closeLayer);

function row(k, v, opts) {
  if (v == null || v === '' ) { if (!(opts && opts.always)) return ''; }
  const empty = (v == null || v === '');
  const d = document.createElement('div'); d.className = 'dv-row';
  const kk = document.createElement('span'); kk.className = 'dv-row__k'; kk.textContent = k;
  const vv = document.createElement('span'); vv.className = 'dv-row__v' + (empty ? ' dv-row__v--muted' : '');
  vv.textContent = empty ? '—' : String(v);              // textContent: staff-entered text can never inject markup
  d.appendChild(kk); d.appendChild(vv);
  return d.outerHTML;
}

function renderDetail() {
  const it = DV; if (!it) return;
  const body = $('dv-body');
  const days = it.found_date ? Math.floor((Date.now() - new Date(it.found_date).getTime()) / 864e5) : -1;
  const left = 90 - days;
  const tcol = left <= 7 ? '#DC2626' : (left <= 30 ? '#D97706' : '#2E5E4E');
  const pct = Math.max(0, Math.min(100, (days / 90) * 100));
  const active = it.status !== 'returned' && it.status !== 'disposed';

  const hero = dvPhotos.length
    ? `<div class="dv-hero" id="dv-hero"><img src="${dvPhotos[dvIdx]}" alt="">${dvPhotos.length > 1 ? `<span class="dv-hero__n">${dvIdx + 1} / ${dvPhotos.length}</span>` : ''}</div>`
    : (it.photos && it.photos.length
        ? `<div class="dv-hero"><span style="color:#8FA096;font-size:.85rem;">A carregar foto…</span></div>`
        : `<div class="dv-hero" style="cursor:default;"><svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="rgba(46,94,78,.20)" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`);

  const thumbs = dvPhotos.length > 1
    ? `<div class="dv-thumbs">${dvPhotos.map((u, i) => `<div class="dv-thumb${i === dvIdx ? ' dv-thumb--on' : ''}" data-i="${i}"><img src="${u}" alt=""></div>`).join('')}</div>`
    : '';

  const ret = parseReturn(it.notes);
  const notes = [it.description, stripReturn(it.notes)].filter(Boolean).join('\n\n');

  body.innerHTML = `
    ${hero}${thumbs}
    <div class="dv-head">
      <h1 class="dv-title" id="dv-title"></h1>
      <span class="gbadge gbadge--${esc(it.status)}" style="flex:0 0 auto;margin-top:6px;"><span class="gbadge__dot"></span>${SL[it.status] || esc(it.status)}</span>
    </div>
    <p class="dv-sub" id="dv-sub"></p>

    <div class="dv-card">
      ${row('Local encontrado', it.found_location, { always: true })}
      ${row('Onde está guardado', it.storage_location, { always: true })}
      ${row('Categoria', clabel(it.category))}
      ${row('Encontrado por', it.found_by, { always: true })}
      ${row('Data', fmtDate(it.found_date), { always: true })}
      ${row('Registado em', fmtDate(it.created_at))}
      ${row('Origem', slabel(it.source))}
      ${row('Quarto', it.linked_room)}
      ${row('Devolvido a', ret && ret.to)}
      ${row('Data devolução', ret && fmtDate(ret.when))}
      ${row('Notas devolução', ret && ret.note)}
    </div>

    ${notes ? `<div class="dv-label">Notas</div><div class="dv-card"><div class="dv-notes" id="dv-notes"></div></div>` : ''}

    ${active && days >= 0 ? `
      <div class="dv-card">
        <div class="dv-timer">
          <div class="dv-timer__head">
            <span class="dv-timer__label">Prazo de 3 meses</span>
            <span class="dv-timer__val" style="color:${tcol};">${left <= 0 ? 'Expirado!' : left + 'd restantes'}</span>
          </div>
          <div class="dv-timer__track"><div class="dv-timer__fill" style="width:${pct}%;background:${tcol};"></div></div>
          <div class="dv-timer__foot"><span>${fmtDate(it.found_date) || ''}</span><span>${days}d de 90</span></div>
        </div>
      </div>` : ''}

    <div class="dv-saving" id="dv-saving" hidden>A guardar…</div>

    ${active ? `<button class="dv-cta" id="dv-return">Devolver ao hóspede</button>` : ''}

    <div class="dv-label">Estado</div>
    <div class="dv-pills" id="dv-status">
      ${ST_FLOW.map(([v, l]) => `<button class="dv-pill${it.status === v ? ' dv-pill--on' : ''}" data-st="${v}">${l}</button>`).join('')}
    </div>

    ${active ? `
      <div class="dv-label">Mover para</div>
      <div class="dv-pills" id="dv-store">
        ${STORES.filter(Boolean).map(s => `<button class="dv-pill${it.storage_location === s ? ' dv-pill--on' : ''}" data-loc="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>` : ''}

    ${it.status === 'returned' ? `<button class="dv-revert" id="dv-revert">reverter devolução</button>` : ''}`;

  $('dv-title').textContent = it.title || 'Artigo';
  $('dv-sub').textContent = [clabel(it.category), fmtDate(it.found_date)].filter(Boolean).join(' · ');
  if (notes) $('dv-notes').textContent = notes;

  const heroEl = $('dv-hero');
  if (heroEl) heroEl.addEventListener('click', () => openLb(dvPhotos, dvIdx));
  body.querySelectorAll('.dv-thumb').forEach(t => t.addEventListener('click', () => { dvIdx = +t.dataset.i; renderDetail(); }));

  $('dv-status').querySelectorAll('.dv-pill').forEach(b => b.addEventListener('click', () => {
    const st = b.dataset.st;
    if (st === it.status) return;
    // "Devolvido" must capture who took it — never a silent status flip
    if (st === 'returned') { openReturn(it); return; }
    saveDetail(st === 'found' || st === 'stored' ? { status: st, notes: stripReturn(it.notes) } : { status: st });
  }));

  const store = $('dv-store');
  if (store) store.querySelectorAll('.dv-pill').forEach(b => b.addEventListener('click', () => {
    // tapping the current location again clears it
    saveDetail({ storage_location: it.storage_location === b.dataset.loc ? '' : b.dataset.loc });
  }));

  const cta = $('dv-return');
  if (cta) cta.addEventListener('click', () => openReturn(it));
  const rev = $('dv-revert');
  if (rev) rev.addEventListener('click', () => {
    if (!confirm('Reverter a devolução deste artigo?')) return;
    saveDetail({ status: 'found', notes: stripReturn(it.notes) });
  });
}

/* ---------- return dialog ---------- */
let rtItem = null;
function openReturn(it) {
  rtItem = it;
  $('rt-item').textContent = it.title || 'Artigo';
  $('rt-to').value = ''; $('rt-note').value = '';
  $('rt-go').disabled = false; $('rt-go').textContent = 'Confirmar devolução';
  $('rt').hidden = false;
  pushLayer(() => { $('rt').hidden = true; rtItem = null; });
  setTimeout(() => $('rt-to').focus(), 60);
}
$('rt-cancel').addEventListener('click', closeLayer);
$('rt-back').addEventListener('click', closeLayer);
$('rt-note').addEventListener('keyup', (e) => { if (e.key === 'Enter') $('rt-go').click(); });
$('rt-go').addEventListener('click', async () => {
  const it = rtItem; if (!it) return;
  const rec = { to: $('rt-to').value.trim(), note: $('rt-note').value.trim(), when: new Date().toISOString() };
  $('rt-go').disabled = true; $('rt-go').textContent = 'A guardar…';
  const patch = { status: 'returned', notes: withReturn(it.notes, rec) };
  const { error } = await sb.from('items').update(patch).eq('id', it.id);
  if (error) {
    $('rt-go').disabled = false; $('rt-go').textContent = 'Confirmar devolução';
    alert('Não foi possível guardar: ' + (error.message || error)); return;
  }
  Object.assign(it, patch);
  closeLayer();                                   // back to the item, now marked returned
  if (DV === it) renderDetail();
  updateCounts(); render(); renderReturns();
});

/* ---------- Devoluções tab: the return log ---------- */
function renderReturns() {
  const box = $('returns');
  const list = ITEMS.filter(i => i.status === 'returned')
    .map(i => ({ i, r: parseReturn(i.notes) }))
    .sort((a, b) => new Date(b.r && b.r.when || b.i.updated_at || 0) - new Date(a.r && a.r.when || a.i.updated_at || 0));

  if (view === 'returns') $('count').textContent = `${list.length} ${list.length === 1 ? 'devolução' : 'devoluções'}`;

  if (!list.length) {
    box.innerHTML = `<div class="empty-state" style="padding:60px 20px;">
      <div class="empty-state__title">Ainda não há devoluções</div>
      <div style="font-size:.85rem;color:#79837C;margin-top:8px;">Abra um artigo e toque em <b>Devolver ao hóspede</b> para registar a entrega.</div>
    </div>`;
    return;
  }

  box.innerHTML = list.map(({ i, r }) => {
    const u = i.photos && i.photos.length ? signedCache[i.photos[0]] : null;
    return `<div class="rlog" data-id="${i.id}">
      ${u ? `<img class="rlog__img" loading="lazy" src="${u}" alt="">` : `<div class="rlog__ph">◻</div>`}
      <div class="rlog__b">
        <div class="rlog__t"></div>
        <div class="rlog__to"></div>
        <div class="rlog__note"></div>
        <div class="rlog__d">${fmtDate(r && r.when) || fmtDate(i.updated_at) || '—'}</div>
      </div>
    </div>`;
  }).join('');

  // guest names via textContent — never innerHTML
  box.querySelectorAll('.rlog').forEach((el, n) => {
    const { i, r } = list[n];
    el.querySelector('.rlog__t').textContent = i.title || 'Artigo';
    el.querySelector('.rlog__to').textContent = r && r.to ? 'Devolvido a ' + r.to : 'Devolvido';
    const note = el.querySelector('.rlog__note');
    if (r && r.note) note.textContent = r.note; else note.remove();
    el.addEventListener('click', () => openDetail(i));
  });
}

async function saveDetail(patch) {
  const it = DV; if (!it) return;
  const box = $('dv-saving'); if (box) box.hidden = false;
  const { error } = await sb.from('items').update(patch).eq('id', it.id);
  if (box) box.hidden = true;
  if (error) { alert('Não foi possível guardar: ' + (error.message || error)); return; }
  Object.assign(it, patch);                       // ITEMS holds the same object reference
  renderDetail(); updateCounts(); render();
}

/* ================= Lightbox ================= */
let lbSet = [], lbIdx = 0;
function openLb(urls, start) {
  lbSet = (urls || []).filter(Boolean); lbIdx = start || 0;
  if (!lbSet.length) return;
  lbPaint();
  $('lb').hidden = false;
  pushLayer(() => { $('lb').hidden = true; });
}
function lbPaint() {
  $('lb-img').src = lbSet[lbIdx];
  const c = $('lb-count');
  if (c) { c.textContent = lbSet.length > 1 ? `${lbIdx + 1} / ${lbSet.length}` : ''; c.hidden = lbSet.length < 2; }
  const multi = lbSet.length > 1;
  $('lb').querySelector('.pv').hidden = !multi;
  $('lb').querySelector('.nx').hidden = !multi;
}
function lbStep(d) { lbIdx = (lbIdx + d + lbSet.length) % lbSet.length; lbPaint(); }
$('lb').querySelector('.cl').addEventListener('click', closeLayer);
$('lb').querySelector('.pv').addEventListener('click', (e) => { e.stopPropagation(); lbStep(-1); });
$('lb').querySelector('.nx').addEventListener('click', (e) => { e.stopPropagation(); lbStep(1); });
// tapping the dark area closes too — the × alone is easy to miss on a phone
$('lb').addEventListener('click', (e) => { if (e.target.id === 'lb') closeLayer(); });

/* manager +Novo modal */
let selected = [];
CATS.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = clabel(c); $('up-cat').appendChild(o); });
STORES.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s || '— não definido —'; $('up-store').appendChild(o); });
$('new-btn').addEventListener('click', () => {
  resetUp(); $('up').hidden = false;
  pushLayer(() => { $('up').hidden = true; resetUp(); });
});
$('up-close').addEventListener('click', closeLayer);
$('up-back').addEventListener('click', closeLayer);
function resetUp() { selected = []; $('up-prev').innerHTML = ''; $('up-form').reset(); $('up-sending').hidden = true; $('up-done').hidden = true; }
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
// stay on the sheet — closing and reopening would push a second history entry
$('up-again').addEventListener('click', resetUp);

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

/* ================= Install prompt (phones/tablets only) ================= */
// Desktop Chrome also fires beforeinstallprompt, so reception was being told to
// "instalar a aplicação no telemóvel" while sitting at the front-desk PC.
const isHandheld = () => window.matchMedia('(pointer: coarse)').matches &&
                         Math.min(screen.width, screen.height) <= 900;
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e;
  if (!isHandheld()) return;
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
/* ================= Build stamp + self-update ================= */
// Shown in the navbar so anyone can say which build they are actually running —
// "it must be cached" is a guess until someone can read the number off screen.
const BUILD = 'v10';
const stamp = $('build'); if (stamp) stamp.textContent = BUILD;

if ('serviceWorker' in navigator) {
  // If a worker was already in charge, a new one taking over means new assets
  // are live — reload once so staff are never left on the previous build.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true; location.reload();
  });
  window.addEventListener('load', () => {
    // updateViaCache:'none' — never let the HTTP cache hand back an old sw.js,
    // which would freeze the whole update path.
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  });
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

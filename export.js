/* export.js — builds the PUBLIC mirror of the Lost & Found app for GitHub Pages.
 *
 * Mirrors the parts of the internal app that can exist as static files:
 *   · /items      -> the catalogue grid              (data.json .items)
 *   · /items/:id  -> item detail + photo gallery     (same records, all images)
 *   · /dashboard  -> the analytics Painel            (data.json .stats)
 * Creating/editing items and photo uploads need the Node server, so they stay
 * on the internal app — GitHub Pages cannot run server code.
 *
 * PRIVACY: the public feed carries object-descriptive data only. Guest-identifying
 * fields are never exported: linked_name, linked_room, claimed_by, claimed_id_notes,
 * notes, and per-item storage_location (publishing "which safe holds the jewellery"
 * next to a photo of it is a theft risk). Storage appears only as an aggregate count.
 * A PII safety-net scan flags anything that leaks into a public field.
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('C:/Users/verdelagoresort/.local/bin/lost-and-found/node_modules/sql.js');

const LF      = 'C:/Users/verdelagoresort/.local/bin/lost-and-found';
const DB      = path.join(LF, 'data', 'lostandfound.db');
const UPLOADS = path.join(LF, 'public', 'uploads');
const SITE    = 'C:/Users/verdelagoresort/.local/bin/lostfound-web';
const IMG_OUT = path.join(SITE, 'images');

const PII = [
  { kind: 'email',        re: /[\w.+-]+@[\w-]+\.[\w.-]+/i },
  { kind: 'phone/ID',     re: /\d{6,}/ },
  { kind: 'quarto/villa', re: /\b(quarto|room|villa|vila|lote|apart|apto|apt)\s*\.?\s*\d{1,4}\b/i },
];
const scan = (t) => { if (!t) return null; for (const p of PII) if (p.re.test(t)) return p.kind; return null; };

// Activity details are free text written by staff and can mention a room —
// strip that before anything is published.
function scrubDetails(s) {
  if (!s) return '';
  return String(s)
    .replace(/,?\s*\b(quarto|room|villa|vila|lote|apart(?:amento)?|apto|apt)\s*\.?\s*[A-Za-z]?\d{1,4}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const PT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB));
  if (!fs.existsSync(IMG_OUT)) fs.mkdirSync(IMG_OUT, { recursive: true });

  const rows = (sql) => { const r = db.exec(sql); if (!r.length) return [];
    return r[0].values.map((v) => { const o = {}; r[0].columns.forEach((c, i) => (o[c] = v[i])); return o; }); };
  const num = (sql) => { const r = rows(sql); return r.length ? Object.values(r[0])[0] || 0 : 0; };

  // ── Catalogue (items still in our possession) ───────────────────────────────
  const items = [];
  const flagged = [];
  let imagesCopied = 0, imagesMissing = 0;

  for (const r of rows(`
    SELECT id, title, description, category, found_location, found_date, status, found_by
    FROM items
    WHERE status IN ('found','stored') AND (item_type = 'lost' OR item_type IS NULL)
    ORDER BY found_date DESC, id DESC
  `)) {
    const files = rows(`SELECT filename FROM item_images WHERE item_id=${Number(r.id)} ORDER BY id`).map((x) => x.filename);
    const images = [];
    for (const f of files) {
      const src = path.join(UPLOADS, f), dest = path.join(IMG_OUT, f);
      if (fs.existsSync(src)) {
        if (!fs.existsSync(dest)) { fs.copyFileSync(src, dest); imagesCopied++; }
        images.push('images/' + f);
      } else imagesMissing++;
    }
    for (const field of ['title', 'description', 'found_location']) {
      const kind = scan(r[field]);
      if (kind) flagged.push({ id: r.id, field, kind, sample: String(r[field]).slice(0, 60) });
    }
    items.push({
      id: r.id,
      title: r.title || '',
      description: r.description || '',
      category: r.category || 'Other',
      found_location: r.found_location || '',
      found_by: r.found_by || '',
      found_date: r.found_date || '',
      status: r.status,
      images,
    });
  }

  // ── Painel / analytics (mirrors routes/dashboard.js) ────────────────────────
  const total    = num("SELECT COUNT(*) c FROM items");
  const active   = num("SELECT COUNT(*) c FROM items WHERE status IN ('found','stored')");
  const returned = num("SELECT COUNT(*) c FROM items WHERE status='returned'");
  const disposed = num("SELECT COUNT(*) c FROM items WHERE status='disposed'");
  const resolved = returned + disposed;
  const avgRow = rows("SELECT AVG(julianday(claimed_date) - julianday(found_date)) a FROM items WHERE status='returned' AND claimed_date IS NOT NULL AND found_date IS NOT NULL");
  const avgDaysToReturn = (avgRow.length && avgRow[0].a != null) ? Math.round(avgRow[0].a) : null;

  const regByMonth = {}, retByMonth = {};
  rows("SELECT strftime('%Y-%m', created_at) m, COUNT(*) c FROM items WHERE created_at IS NOT NULL GROUP BY m").forEach((r) => (regByMonth[r.m] = r.c));
  rows("SELECT strftime('%Y-%m', claimed_date) m, COUNT(*) c FROM items WHERE status='returned' AND claimed_date IS NOT NULL GROUP BY m").forEach((r) => (retByMonth[r.m] = r.c));
  const now = new Date();
  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly.push({ label: PT_MONTHS[d.getMonth()], year: String(d.getFullYear()).slice(2),
      isYearStart: d.getMonth() === 0, registered: regByMonth[key] || 0, returned: retByMonth[key] || 0 });
  }

  const stats = {
    kpi: {
      total, active, returned, disposed,
      returnRate: resolved ? Math.round((returned / resolved) * 100) : 0,
      registeredToday:     num("SELECT COUNT(*) c FROM items WHERE found_date = date('now')"),
      registeredThisMonth: num("SELECT COUNT(*) c FROM items WHERE date(created_at) >= date('now','start of month')"),
      returnedThisMonth:   num("SELECT COUNT(*) c FROM items WHERE status='returned' AND claimed_date >= date('now','start of month')"),
      avgDaysToReturn,
      expiringSoon: num("SELECT COUNT(*) c FROM items WHERE item_type='lost' AND status IN ('found','stored') AND found_date <= date('now','-83 day') AND found_date > date('now','-90 day')"),
      overdue:      num("SELECT COUNT(*) c FROM items WHERE item_type='lost' AND status IN ('found','stored') AND found_date <= date('now','-90 day')"),
    },
    statusCounts: {
      found:  num("SELECT COUNT(*) c FROM items WHERE status='found'"),
      stored: num("SELECT COUNT(*) c FROM items WHERE status='stored'"),
      returned, disposed,
    },
    typeSplit: {
      lost:    num("SELECT COUNT(*) c FROM items WHERE item_type='lost' OR item_type IS NULL"),
      storage: num("SELECT COUNT(*) c FROM items WHERE item_type='storage'"),
    },
    byCategory: rows("SELECT category, COUNT(*) c FROM items GROUP BY category ORDER BY c DESC"),
    byLocation: rows("SELECT found_location loc, COUNT(*) c FROM items WHERE found_location IS NOT NULL AND TRIM(found_location) <> '' GROUP BY found_location ORDER BY c DESC LIMIT 8"),
    byStorage:  rows("SELECT storage_location loc, COUNT(*) c FROM items WHERE status IN ('found','stored') AND storage_location IS NOT NULL AND TRIM(storage_location) <> '' GROUP BY storage_location ORDER BY c DESC"),
    byFinder:   rows("SELECT found_by fb, COUNT(*) c FROM items WHERE found_by IS NOT NULL AND TRIM(found_by) <> '' GROUP BY found_by ORDER BY c DESC LIMIT 8"),
    monthly,
    expiringList: rows("SELECT id, title, category, found_date, CAST(julianday(date('now')) - julianday(found_date) AS INT) days FROM items WHERE item_type='lost' AND status IN ('found','stored') AND found_date <= date('now','-83 day') ORDER BY found_date ASC LIMIT 12"),
    recentActivity: rows(`
      SELECT a.action, a.details, a.created_at, u.display_name un, i.id item_id, i.title item_title
      FROM activity_log a LEFT JOIN users u ON a.user_id = u.id LEFT JOIN items i ON a.item_id = i.id
      ORDER BY a.created_at DESC LIMIT 15
    `).map((a) => ({ ...a, details: scrubDetails(a.details) })),
    storageLocations: rows("SELECT name FROM storage_locations ORDER BY name").map((r) => r.name),
  };

  // Prune photos no longer referenced (item returned/disposed/deleted).
  const keep = new Set(items.flatMap((i) => i.images.map((p) => p.replace('images/', ''))));
  let pruned = 0;
  for (const f of fs.readdirSync(IMG_OUT)) {
    if (!keep.has(f)) { try { fs.unlinkSync(path.join(IMG_OUT, f)); pruned++; } catch (_) {} }
  }

  // Only bump `updated` when the payload actually changed, so the 10-min sync
  // doesn't create an empty commit every run.
  const body = { count: items.length, items, stats };
  const outPath = path.join(SITE, 'data.json');
  let updated = new Date().toISOString();
  try {
    const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const { updated: _drop, ...prevBody } = prev;
    if (JSON.stringify(prevBody) === JSON.stringify(body)) updated = prev.updated;
  } catch (_) {}
  fs.writeFileSync(outPath, JSON.stringify({ updated, ...body }, null, 2));

  console.log(JSON.stringify({ count: items.length, imagesCopied, imagesMissing, pruned, flaggedCount: flagged.length, flagged }));
})().catch((e) => { console.error('EXPORT_FAIL', e && e.message); process.exit(1); });

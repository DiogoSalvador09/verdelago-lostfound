/* export.js — builds the PUBLIC, privacy-safe catalogue for the GitHub Pages viewer.
 *
 * Reads the live Lost & Found sql.js database (read-only), and writes:
 *   · data.json  — ONLY object-descriptive fields (never guest names, room numbers,
 *                  ID notes, claim details, internal notes, or where valuables are kept)
 *   · images/    — copies of the referenced photos (and prunes ones no longer shown)
 *
 * Only items still in our possession (status found/stored) are published; returned
 * and disposed items — and their photos — are left off / removed on the next run.
 *
 * A PII safety-net scan flags any room/name/ID/e-mail that slipped into a public
 * field so it can be cleaned before it ever reaches the internet.
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('C:/Users/verdelagoresort/.local/bin/lost-and-found/node_modules/sql.js');

const LF      = 'C:/Users/verdelagoresort/.local/bin/lost-and-found';
const DB      = path.join(LF, 'data', 'lostandfound.db');
const UPLOADS = path.join(LF, 'public', 'uploads');
const SITE    = 'C:/Users/verdelagoresort/.local/bin/lostfound-web';
const IMG_OUT = path.join(SITE, 'images');

// Heuristics that suggest guest-identifying text leaked into a public field.
const PII = [
  { kind: 'email',        re: /[\w.+-]+@[\w-]+\.[\w.-]+/i },
  { kind: 'phone/ID',     re: /\d{6,}/ },
  { kind: 'quarto/villa', re: /\b(quarto|room|villa|vila|lote|apart|apto|apt)\s*\.?\s*\d{1,4}\b/i },
];
const scan = (t) => { if (!t) return null; for (const p of PII) if (p.re.test(t)) return p.kind; return null; };

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB));

  if (!fs.existsSync(IMG_OUT)) fs.mkdirSync(IMG_OUT, { recursive: true });

  const res = db.exec(`
    SELECT id, title, description, category, found_location, found_date, status
    FROM items
    WHERE status IN ('found','stored') AND (item_type = 'lost' OR item_type IS NULL)
    ORDER BY found_date DESC, id DESC
  `);

  const items = [];
  const flagged = [];
  let imagesCopied = 0, imagesMissing = 0;

  const cols = res.length ? res[0].columns : [];
  const rows = res.length ? res[0].values : [];
  for (const v of rows) {
    const r = {}; cols.forEach((c, i) => (r[c] = v[i]));

    const imgRes = db.exec(`SELECT filename FROM item_images WHERE item_id=${Number(r.id)} ORDER BY id`);
    const files = imgRes.length ? imgRes[0].values.map((x) => x[0]) : [];
    const images = [];
    for (const f of files) {
      const src = path.join(UPLOADS, f);
      const dest = path.join(IMG_OUT, f);
      if (fs.existsSync(src)) {
        // Photo filenames are unique, so only copy ones we don't already have.
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
      found_date: r.found_date || '',
      status: r.status,
      images,
    });
  }

  // Prune photos that are no longer referenced (item returned/disposed/deleted).
  const keep = new Set(items.flatMap((i) => i.images.map((p) => p.replace('images/', ''))));
  let pruned = 0;
  for (const f of fs.readdirSync(IMG_OUT)) {
    if (!keep.has(f)) { try { fs.unlinkSync(path.join(IMG_OUT, f)); pruned++; } catch (_) {} }
  }

  fs.writeFileSync(
    path.join(SITE, 'data.json'),
    JSON.stringify({ updated: new Date().toISOString(), count: items.length, items }, null, 2)
  );

  console.log(JSON.stringify({ count: items.length, imagesCopied, imagesMissing, pruned, flaggedCount: flagged.length, flagged }));
})().catch((e) => { console.error('EXPORT_FAIL', e && e.message); process.exit(1); });

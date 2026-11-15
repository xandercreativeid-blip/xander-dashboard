// Sinkronisasi dari Google Sheets: setiap tab = satu brand, semua link TikTok/IG/YouTube di tab
// itu ikut masuk. Angka manual di sheet (Views, Likes, ...) dipakai sebagai nilai awal/cadangan.
import fs from 'node:fs';
import XLSX from 'xlsx';
import '../../web/urls.js';
const { parseUrl } = globalThis.XUrls;

const MONTHS = { januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5, juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, agu: 7, agt: 7, agus: 7, aug: 7, sep: 8, sept: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11, may: 4 };

// Tanggal di sheet -> ISO pada pukul 12.00 WIB di hari itu.
export function parseSheetDate(cell) {
  if (!cell) return null;
  let y, m, d;
  if (typeof cell.v === 'number' && cell.v > 30000 && cell.v < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(cell.v) * 86400000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()];
  } else if (typeof cell.v === 'string') {
    const t = cell.v.trim().toLowerCase();
    let x;
    if ((x = t.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/)) && x[2] in MONTHS) [d, m, y] = [+x[1], MONTHS[x[2]], +x[3]];
    else if ((x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+x[1], x[2] - 1, +x[3]];
    else if ((x = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) [d, m, y] = [+x[1], x[2] - 1, +x[3]];
    else return null;
  } else return null;
  return new Date(Date.UTC(y, m, d, 5, 0, 0)).toISOString();
}
const cellNum = (c) => {
  if (!c) return null;
  if (typeof c.v === 'number') return c.v >= 0 ? Math.round(c.v) : null;
  if (typeof c.v === 'string' && /^[\d.,\s]+$/.test(c.v.trim()) && c.v.trim()) return Number(c.v.replace(/[.,\s]/g, ''));
  return null;
};

const FIELD_RULES = [
  ['posted_at', /^(tanggal|date|tgl)/], ['views', /^views?$/], ['likes', /^likes?$/],
  ['comments', /^comments?$|^komentar$/], ['saves', /^saved?$|^saves$/], ['shares', /^shares?$/],
];

export function parseWorkbook(buf, excludeTabs = []) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const skip = new Set(excludeTabs.map((t) => t.trim().toLowerCase()));
  const brands = [];
  for (const name of wb.SheetNames) {
    if (skip.has(name.trim().toLowerCase())) continue;
    const ws = wb.Sheets[name];
    if (!ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const at = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
    const text = (r, c) => { const x = at(r, c); return x && typeof x.v === 'string' ? x.v.trim().toLowerCase() : ''; };
    // Baris judul kolom: baris pertama yang punya kolom "views" dan kolom berisi kata "link"/"upload".
    let hdr = -1;
    for (let r = range.s.r; r <= Math.min(range.e.r, 40) && hdr < 0; r++) {
      let v = false, l = false;
      for (let c = range.s.c; c <= range.e.c; c++) { const t = text(r, c); if (/^views?$/.test(t)) v = true; if (/link|upload/.test(t)) l = true; }
      if (v && l) hdr = r;
    }
    // Blok tabel dimulai di kolom berjudul "No." / "ACN".
    const starts = [];
    if (hdr >= 0) for (let c = range.s.c; c <= range.e.c; c++) if (/^(no\.?|acn)$/.test(text(hdr, c))) starts.push(c);
    const blockOf = (c) => {
      let s = -1, e = range.e.c;
      for (const st of starts) { if (st <= c) s = st; else { e = st - 1; break; } }
      if (s < 0) return null;
      const cols = {};
      for (let k = s; k <= e; k++) { const t = text(hdr, k); for (const [f, re] of FIELD_RULES) if (!(f in cols) && re.test(t)) cols[f] = k; }
      return cols;
    };
    const found = new Map();
    for (let r = Math.max(hdr + 1, range.s.r); r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = at(r, c);
        if (!cell) continue;
        const p = parseUrl(cell.l?.Target || '') || parseUrl(typeof cell.v === 'string' ? cell.v : '');
        if (!p) continue;
        const cols = blockOf(c) || {};
        const sheet = {
          posted_at: 'posted_at' in cols ? parseSheetDate(at(r, cols.posted_at)) : null,
          views: 'views' in cols ? cellNum(at(r, cols.views)) : null,
          likes: 'likes' in cols ? cellNum(at(r, cols.likes)) : null,
          comments: 'comments' in cols ? cellNum(at(r, cols.comments)) : null,
          shares: 'shares' in cols ? cellNum(at(r, cols.shares)) : null,
          saves: 'saves' in cols ? cellNum(at(r, cols.saves)) : null,
        };
        const id = `${p.platform}:${p.key}`;
        const prev = found.get(id);
        if (!prev || (prev.sheet.views === null && sheet.views !== null)) found.set(id, { ...p, sheet });
      }
    }
    if (found.size) brands.push({ tab: name, links: [...found.values()] });
  }
  return brands;
}

export async function loadWorkbook(source) {
  if (!/^https?:/.test(source)) return fs.readFileSync(source);
  const id = (source.match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1];
  if (!id) throw new Error('Link Google Sheets tidak dikenali');
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { signal: AbortSignal.timeout(90000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('spreadsheetml'))
    throw new Error(`Sheet tidak bisa diunduh (HTTP ${res.status}). Pastikan akses "Siapa saja yang memiliki link" = Pelihat.`);
  return Buffer.from(await res.arrayBuffer());
}

const METRICS = ['views', 'likes', 'comments', 'shares', 'saves'];

export async function syncSheet(store, source, excludeTabs = []) {
  const parsed = parseWorkbook(await loadWorkbook(source), excludeTabs);
  const brands = await store.getBrands();
  const stats = { brands: 0, added: 0, updated: 0 };
  for (const tab of parsed) {
    let brand = brands.find((b) => (b.sheet_tab || b.name).trim().toLowerCase() === tab.tab.trim().toLowerCase());
    if (!brand) { brand = await store.createBrand({ name: tab.tab.trim(), sheet_tab: tab.tab }); stats.brands++; }
    const existing = await store.getContents(brand.id);
    const byKey = new Map();
    for (const c of existing) { byKey.set(`${c.platform}:${c.external_id}`, c); for (const a of c.aliases || []) byKey.set(`${c.platform}:${a}`, c); }
    const fresh = [];
    for (const l of tab.links) {
      const cur = byKey.get(`${l.platform}:${l.key}`);
      const hasData = METRICS.some((k) => l.sheet[k] !== null);
      if (!cur) {
        fresh.push({ brand_id: brand.id, platform: l.platform, external_id: l.key, url: l.url,
          ...(hasData ? { ...l.sheet, source: 'sheet' } : { posted_at: l.sheet.posted_at }) });
      } else if (hasData && (cur.source === 'sheet' || cur.source === 'none')) {
        // Belum pernah berhasil diambil otomatis: ikuti angka terbaru di sheet.
        const patch = {};
        for (const k of [...METRICS, 'posted_at']) if (l.sheet[k] !== null && l.sheet[k] !== cur[k]) patch[k] = l.sheet[k];
        if (Object.keys(patch).length || cur.source === 'none') { await store.update(cur.id, { ...patch, source: 'sheet' }); stats.updated++; }
      }
    }
    if (fresh.length) { await store.insertContents(fresh); stats.added += fresh.length; }
  }
  return stats;
}

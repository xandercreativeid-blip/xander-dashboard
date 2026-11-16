// Membaca file Google Sheets (xlsx): setiap tab = satu brand, semua link TikTok/IG/YouTube di tab itu
// ikut terbaca, beserta angka manual di kolom sebelahnya (Views, Likes, ...) sebagai nilai awal/cadangan.
(function (g) {
  const MONTHS = { januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5, juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, agu: 7, agt: 7, agus: 7, aug: 7, sep: 8, sept: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };

  // Tanggal di sheet -> ISO pada pukul 12.00 WIB di hari itu.
  function parseSheetDate(cell) {
    if (!cell) return null;
    let y, m, d, x;
    if (typeof cell.v === 'number' && cell.v > 30000 && cell.v < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(cell.v) * 86400000);
      [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()];
    } else if (typeof cell.v === 'string') {
      const t = cell.v.trim().toLowerCase();
      if ((x = t.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/)) && x[2] in MONTHS) [d, m, y] = [+x[1], MONTHS[x[2]], +x[3]];
      else if ((x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+x[1], x[2] - 1, +x[3]];
      else if ((x = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) [d, m, y] = [+x[1], x[2] - 1, +x[3]];
      else return null;
    } else return null;
    return new Date(Date.UTC(y, m, d, 5, 0, 0)).toISOString();
  }
  function cellNum(c) {
    if (!c) return null;
    if (typeof c.v === 'number') return c.v >= 0 ? Math.round(c.v) : null;
    if (typeof c.v === 'string' && c.v.trim() && /^[\d.,\s]+$/.test(c.v.trim())) return Number(c.v.replace(/[.,\s]/g, ''));
    return null;
  }
  const FIELD_RULES = [
    ['posted_at', /^(tanggal|date|tgl)/], ['views', /^views?$/], ['likes', /^likes?$/],
    ['comments', /^comments?$|^komentar$/], ['saves', /^saved?$|^saves$/], ['shares', /^shares?$/],
  ];

  // Membaca satu tab. ws = lembar gaya SheetJS: ws['A1'] = { v, l: { Target } }, ws['!ref'] = 'A1:Z99'.
  function parseTab(ws, utils) {
    const parseUrl = g.XUrls.parseUrl;
    if (!ws || !ws['!ref']) return [];
    const range = utils.decode_range(ws['!ref']);
    const at = (r, c) => ws[utils.encode_cell({ r, c })];
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
      if (s < 0) return {};
      const cols = {};
      for (let k = s; k <= e; k++) { const t = text(hdr, k); for (const [f, re] of FIELD_RULES) if (!(f in cols) && re.test(t)) cols[f] = k; }
      return cols;
    };
    const found = new Map();
    for (let r = Math.max(hdr + 1, range.s.r); r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = at(r, c);
        if (!cell) continue;
        const p = parseUrl((cell.l && cell.l.Target) || '') || parseUrl(typeof cell.v === 'string' ? cell.v : '');
        if (!p) continue;
        const cols = blockOf(c);
        const sheet = { posted_at: 'posted_at' in cols ? parseSheetDate(at(r, cols.posted_at)) : null };
        for (const k of ['views', 'likes', 'comments', 'shares', 'saves']) sheet[k] = k in cols ? cellNum(at(r, cols[k])) : null;
        const id = p.platform + ':' + p.key;
        const prev = found.get(id);
        if (!prev || (prev.sheet.views === null && sheet.views !== null)) found.set(id, { ...p, sheet });
      }
    }
    return [...found.values()];
  }

  // XLSX = pustaka SheetJS; data = ArrayBuffer / Buffer file xlsx.
  function parseWorkbook(XLSX, data, excludeTabs) {
    const wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? 'array' : 'buffer' });
    const skip = new Set((excludeTabs || []).map((t) => t.trim().toLowerCase()));
    const brands = [];
    for (const name of wb.SheetNames) {
      if (skip.has(name.trim().toLowerCase())) continue;
      const links = parseTab(wb.Sheets[name], XLSX.utils);
      if (links.length) brands.push({ tab: name, links });
    }
    return brands;
  }
  g.XSheet = { parseWorkbook, parseTab, parseSheetDate };
})(typeof globalThis !== 'undefined' ? globalThis : window);

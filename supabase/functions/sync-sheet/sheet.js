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
      const t = cell.v.trim().toLowerCase().replace(/[^a-z0-9]+$/, '');
      const mon = (w) => (w in MONTHS ? MONTHS[w] : MONTHS[w.slice(0, 3)] ?? (w.startsWith('ni') ? 10 : undefined));   // salah ketik: "Feburari", "Nivember"
      if ((x = t.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/)) && mon(x[2]) !== undefined) [d, m, y] = [+x[1], mon(x[2]), +x[3]];
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
        // Tabel laporan upload = blok yang punya kolom tanggal atau views; blok lain (mis. "Link Posting" di tracker produksi) bukan laporan.
        const report = 'posted_at' in cols || 'views' in cols;
        const sheet = { posted_at: 'posted_at' in cols ? parseSheetDate(at(r, cols.posted_at)) : null };
        for (const k of ['views', 'likes', 'comments', 'shares', 'saves']) sheet[k] = k in cols ? cellNum(at(r, cols[k])) : null;
        const id = p.platform + ':' + p.key;
        const prev = found.get(id);
        if (!prev || (!prev.report && report) || (prev.report === report && prev.sheet.views === null && sheet.views !== null)) found.set(id, { ...p, sheet, report });
      }
    }
    // Bila tab punya tabel laporan, hanya link di tabel itu yang dihitung sebagai konten terupload.
    const all = [...found.values()];
    const out = all.some((l) => l.report) ? all.filter((l) => l.report) : all;
    return out.map(({ report, ...l }) => l);
  }

  // ---------------------------------------------------------------- blok KPI di atas tabel
  // Contoh (tab Haircode): Nama Brand / Scriptwriter / PM / Month Start-End / Notes, Contract / Quantity /
  // Total Video / Master Drive, dan tabel kecil Platform | FYP Quantity | KPI FYP.
  const KPI_LABELS = [
    ['brand_name', /^nama brand/], ['scriptwriter', /^script ?writer/], ['pm', /^(pm|project manager)$/],
    ['period', /^month st(a|ra)rt/], ['notes', /^notes?\b/], ['contract', /^contract/], ['quantity', /^quantity/],
    ['total_video', /^(total video|goal)/], ['master_drive', /^master drive/],
  ];
  const ID_MONTHS = { jan: 0, januari: 0, feb: 1, febuari: 1, februari: 1, mar: 2, maret: 2, apr: 3, april: 3, mei: 4, may: 4,
    jun: 5, juni: 5, june: 5, jul: 6, juli: 6, july: 6, agu: 7, ags: 7, agt: 7, aug: 7, agus: 7, agustus: 7, august: 7,
    sep: 8, sept: 8, september: 8, okt: 9, oct: 9, oktober: 9, october: 9, nov: 10, november: 10, des: 11, dec: 11, desember: 11, december: 11 };
  const iso = (y, m, d) => new Date(Date.UTC(y, m, Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
  // "08 Des 2025 - 10 Jul 2026, 10 Juni 2026 - 22 Jan 2027", "14 September - 30 April 2027", "31 AGS'26 - 15 JAN'27",
  // "20 Aug - 20 Mar" -> [[awal, akhir], ...] (yyyy-mm-dd). Teks yang tidak berbentuk tanggal ("Unlimited", "TBC") -> [].
  function parsePeriods(text, today) {
    today = today || new Date().toISOString().slice(0, 10);
    const out = [];
    let guessed = false;
    const date = /(\d{1,2})?\s*([a-z]+)\.?\s*(?:'(\d{2})|(\d{4}))?/;
    let src = String(text || '').toLowerCase();
    const inParens = src.match(/\(([^)]*\d[^)]*)\)/g);   // "4th Contract (15 Sep - 31 Jan)" -> isi kurung
    if (inParens) src = inParens.map((x) => x.slice(1, -1)).join(',');
    for (const part of src.split(/[,;\n]|\s&\s/)) {
      const ends = part.trim().split(/\s*[-–]\s*|\s+s\.?d\.?\s+|\s+to\s+/);
      if (ends.length !== 2) continue;
      const a = ends[0].trim().match(new RegExp('^' + date.source + '$')), b = ends[1].trim().match(new RegExp('^' + date.source + '$'));
      if (!a || !b || !(a[2] in ID_MONTHS) || !(b[2] in ID_MONTHS)) continue;
      const am = ID_MONTHS[a[2]], bm = ID_MONTHS[b[2]];
      const ay = a[3] ? 2000 + +a[3] : a[4] ? +a[4] : null, by = b[3] ? 2000 + +b[3] : b[4] ? +b[4] : null;
      let sy = ay, ey = by;
      if (sy === null && ey !== null) sy = am <= bm ? ey : ey - 1;
      if (ey === null && sy !== null) ey = bm >= am ? sy : sy + 1;
      if (sy === null && ey === null) { // tanpa tahun: anggap periode yang dimulai paling akhir sebelum hari ini
        guessed = true;
        const ty = +today.slice(0, 4);
        sy = iso(ty, am, +(a[1] || 1)) <= today ? ty : ty - 1;
        ey = bm >= am ? sy : sy + 1;
      }
      const start = iso(sy, am, +(a[1] || 1)), end = iso(ey, bm, +(b[1] || new Date(Date.UTC(ey, bm + 1, 0)).getUTCDate()));
      if (start <= end) out.push([start, end]);
    }
    out.guessed = guessed;
    return out;
  }
  const firstNumber = (t) => { const m = String(t || '').replace(/\./g, '').match(/\d+/); return m ? +m[0] : null; };
  // ws = lembar gaya SheetJS. Mengembalikan null bila tab tidak punya blok info sama sekali.
  function parseKpi(ws, utils) {
    if (!ws || !ws['!ref']) return null;
    const range = utils.decode_range(ws['!ref']);
    const maxR = Math.min(range.e.r, 9), maxC = Math.min(range.e.c, 40);
    const at = (r, c) => ws[utils.encode_cell({ r, c })];
    const txt = (r, c) => { const x = at(r, c); return x && x.v !== undefined && x.v !== null ? String(x.v).trim() : ''; };
    const norm = (t) => t.toLowerCase().replace(/[:：]/g, '').replace(/\s+/g, ' ').trim();
    const labelOf = (t) => { const n = norm(t); for (const [k, re] of KPI_LABELS) if (re.test(n)) return k; return null; };
    const kpi = { fields: {}, platforms: {} };
    let platRow = -1, platCol = -1, fypCol = -1, kpiCol = -1;
    for (let r = range.s.r; r <= maxR; r++) for (let c = range.s.c; c <= maxC; c++) {
      const n = norm(txt(r, c));
      if (n === 'platform' && platRow < 0) { platRow = r; platCol = c; }
      if (r === platRow && /^fyp quantity/.test(n)) fypCol = c;
      if (r === platRow && /^kpi fyp/.test(n)) kpiCol = c;
    }
    for (let r = range.s.r; r <= maxR; r++) for (let c = range.s.c; c <= maxC; c++) {
      const key = labelOf(txt(r, c));
      if (!key || key in kpi.fields) continue;
      for (let v = c + 1; v <= maxC; v++) {
        if (platRow >= 0 && v >= platCol) break;
        const t = txt(r, v);
        if (!t) continue;
        if (labelOf(t)) break;
        kpi.fields[key] = t;
        const link = at(r, v) && at(r, v).l && at(r, v).l.Target;
        if (key === 'master_drive' && link) kpi.master_drive_url = link;
        break;
      }
    }
    if (platRow >= 0 && fypCol >= 0) {
      for (let r = platRow + 1; r <= maxR; r++) {
        const name = norm(txt(r, platCol));
        const p = /tik ?tok/.test(name) ? 'tiktok' : /insta|^ig$/.test(name) ? 'instagram' : /you ?tube|^yt$/.test(name) ? 'youtube' : null;
        if (!p) continue;
        const fyp = cellNum(at(r, fypCol)), k = kpiCol >= 0 ? cellNum(at(r, kpiCol)) : null;
        if (fyp !== null || k !== null) kpi.platforms[p] = { fyp, kpi: k };
      }
    }
    if (!Object.keys(kpi.fields).length && !Object.keys(kpi.platforms).length) return null;
    kpi.quantity_per_month = /month|bulan/i.test(kpi.fields.quantity || '') ? firstNumber(kpi.fields.quantity) : null;
    kpi.total_videos = firstNumber(kpi.fields.total_video);
    const per = parsePeriods(kpi.fields.period);
    kpi.periods = [...per];
    if (per.guessed && per.length) kpi.period_year_assumed = true;
    return kpi;
  }

  // XLSX = pustaka SheetJS; data = ArrayBuffer / Buffer file xlsx.
  function parseWorkbook(XLSX, data, excludeTabs) {
    const wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? 'array' : 'buffer' });
    const skip = new Set((excludeTabs || []).map((t) => t.trim().toLowerCase()));
    const brands = [];
    const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
    wb.SheetNames.forEach((name, i) => {
      if (skip.has(name.trim().toLowerCase())) return;
      const links = parseTab(wb.Sheets[name], XLSX.utils);
      if (links.length) brands.push({ tab: name, links, hidden: !!(meta[i] && meta[i].Hidden), kpi: parseKpi(wb.Sheets[name], XLSX.utils) });
    });
    return brands;
  }
  g.XSheet = { parseWorkbook, parseTab, parseKpi, parsePeriods, parseSheetDate };
})(typeof globalThis !== 'undefined' ? globalThis : window);

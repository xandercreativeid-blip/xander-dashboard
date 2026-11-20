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
    ['brand_name', /^(nama brand|brand name|nama klien|client)$/], ['scriptwriter', /^script ?writer/], ['pm', /^(pm|project manager|pic)$/],
    ['period', /^(month )?st(a|ra)rt ?-? ?end|^(periode?|timeline|masa kontrak|durasi kontrak|contract period|jangka waktu)( kontrak| contract)?$/],
    ['start', /^(start|mulai|start date|tanggal mulai)$/], ['end', /^(end|selesai|berakhir|end date|tanggal selesai)$/],
    ['notes', /^notes?$|^catatan$/], ['contract', /^(contract|kontrak)$/],
    ['quantity', /^(quantity|qty)( ?\/ ?(platform|month|bulan))?$|^(jumlah|total) (video|konten) ?(\/|per) ?(bulan|month)$/],
    ['total_video', /^(total video|total konten|goal|target video|target konten|jumlah video|total content)s?$/], ['master_drive', /^master drive/],
    ['kpi_text', /^(kpi|kpi fyp|kpi kontrak|kpi contract|target kpi)$/], ['views_target', /^(target views|kpi views|target total views|total views target)$/],
    ['platform_text', /^platforms?$/],
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
    for (const part of src.split(/[,;\n|]|\/\/|\s&\s/)) {
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
  // Angka dengan satuan: "10,000", "10K", "1jt", "1,5 juta", "2M", "1.000.000".
  const UNIT = { k: 1e3, rb: 1e3, ribu: 1e3, m: 1e6, jt: 1e6, juta: 1e6, mio: 1e6, million: 1e6 };
  function numUnit(numText, unit) {
    unit = (unit || '').toLowerCase();
    let s = numText.replace(/\s/g, '');
    if (unit && UNIT[unit] && /^\d+[.,]\d{1,2}$/.test(s)) return Math.round(parseFloat(s.replace(',', '.')) * UNIT[unit]);
    s = s.replace(/[.,]/g, '');
    return s ? +s * (UNIT[unit] || 1) : null;
  }
  const NUM = String.raw`(\d+(?:[.,]\d+)*)\s*(k|rb|ribu|m|jt|juta|mio|million)?\b`;
  // Platform yang disebut dalam teks: "TikTok & IG", "TT, IG, YT", "3 Months - TT, IG, YT, Clippo".
  function platformsIn(text) {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    return [/tik ?tok|[^a-z]tt[^a-z]/.test(t) && 'tiktok', /insta|[^a-z]ig[^a-z]|reels?/.test(t) && 'instagram', /you ?tube|[^a-z]yt[^a-z]|shorts/.test(t) && 'youtube'].filter(Boolean);
  }
  // Membaca kalimat KPI. Dua jenis KPI:
  //  - KPI FYP: jumlah konten yang mencapai batas views ("8 FYP - /FYP: 10,000 Views", "10 video FYP (10K views)")
  //  - KPI Views: total views semua konten selama timeline kontrak ("KPI: 1.000.000 Views", "Target 5jt views")
  // Batas views per konten saja ("10K views / video") menjadi target views konten, tanpa jumlah.
  function parseKpiText(text) {
    const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
    const out = { fyp_count: null, fyp_views: null, views_total: null };
    if (!/\d/.test(t)) return out;
    const fc = t.match(/(\d+)\s*(?:video|vids?|konten|content)?\s*(?:yang\s*)?(?:masuk\s*)?fyp/);
    if (fc) out.fyp_count = +fc[1];
    const views = [...t.matchAll(new RegExp(NUM + String.raw`\s*(?:total\s*)?views?`, 'g'))].map((m) => ({ n: numUnit(m[1], m[2]), before: t.slice(Math.max(0, m.index - 12), m.index), after: t.slice(m.index, m.index + m[0].length + 12) }));
    const perVideo = (v) => /fyp ?[:=]|tiap|setiap|each/.test(v.before) || /per ?(video|konten|content)|\/ ?(video|konten|content|fyp)/.test(v.after);
    const isTotal = (v) => /total|akumulasi|kumulatif|cumulative|semua|all/.test(v.before) || /views? total/.test(v.after);
    for (const v of views) {
      if (v.n === null) continue;
      if (/fyp/.test(t) && out.fyp_views === null && !isTotal(v)) out.fyp_views = v.n;
      else if (!/fyp/.test(t) && perVideo(v) && !isTotal(v) && out.fyp_views === null) out.fyp_views = v.n;
      else out.views_total = Math.max(out.views_total || 0, v.n);
    }
    return out;
  }
  // Tanggal Excel (angka) -> teks "31 Mar 2026" agar bisa dibaca parsePeriods.
  const serialText = (v) => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return `${d.getUTCDate()} ${'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

  // ws = lembar gaya SheetJS. Mengembalikan null bila tab tidak punya blok info sama sekali.
  // Dibaca menurut arti isinya, bukan posisi: label bisa berbeda antar macrosheets (Goal / Total Video, Month Start-End /
  // Start + End), isi bisa tertukar (Quantity "90", Goal "15/Month"), atau label tidak ada sama sekali.
  function parseKpi(ws, utils) {
    if (!ws || !ws['!ref']) return null;
    const range = utils.decode_range(ws['!ref']);
    const maxC = Math.min(range.e.c, 40);
    const at = (r, c) => ws[utils.encode_cell({ r, c })];
    const raw = (r, c) => { const x = at(r, c); return x && x.v !== undefined && x.v !== null && x.v !== '' ? x.v : null; };
    const txt = (r, c) => { const v = raw(r, c); return v === null ? '' : String(v).trim(); };
    const norm = (t) => t.toLowerCase().replace(/[:：]/g, '').replace(/\s+/g, ' ').trim();
    const labelOf = (t) => { const n = norm(t); if (!n || n.length > 40) return null; for (const [k, re] of KPI_LABELS) if (re.test(n)) return k; return null; };
    // Blok info berhenti di baris judul tabel konten (baris yang punya kolom Views dan No./Link).
    let maxR = Math.min(range.e.r, 9);
    for (let r = range.s.r; r <= maxR; r++) {
      let v = false, l = false;
      for (let c = range.s.c; c <= maxC; c++) { const n = norm(txt(r, c)); if (/^views?$/.test(n)) v = true; if (/^(no\.?|acn)$|link|upload/.test(n)) l = true; }
      if (v && l) { maxR = r - 1; break; }
    }
    const kpi = { fields: {}, platforms: {} };
    // Format tabel: baris judul Platform | FYP Quantity | KPI FYP (| KPI Views).
    let platRow = -1, platCol = -1, fypCol = -1, kpiCol = -1, viewsCol = -1;
    for (let r = range.s.r; r <= maxR && platRow < 0; r++) {
      let pc = -1, fc = -1, kc = -1, vc = -1;
      for (let c = range.s.c; c <= maxC; c++) {
        const n = norm(txt(r, c));
        if (/^platforms?$/.test(n) && pc < 0) pc = c;
        if (/^(fyp quantity|fyp views|batas fyp)/.test(n)) fc = c;
        if (/^kpi fyp/.test(n)) kc = c;
        if (/^(kpi|target) (total )?views/.test(n)) vc = c;
      }
      if (pc >= 0 && (fc >= 0 || vc >= 0)) { platRow = r; platCol = pc; fypCol = fc; kpiCol = kc; viewsCol = vc; }
    }
    const used = new Set();
    for (let r = range.s.r; r <= maxR; r++) for (let c = range.s.c; c <= maxC; c++) {
      if (r === platRow && c >= platCol) continue;
      const key = labelOf(txt(r, c));
      if (!key) continue;
      used.add(r + ':' + c);
      if (key in kpi.fields) continue;
      // Nilai = sel isi pertama di kanan label (sebelum label berikutnya / tabel Platform).
      for (let v = c + 1; v <= maxC; v++) {
        if (platRow >= 0 && r >= platRow && v >= platCol) break;
        const t = txt(r, v);
        if (!t) continue;
        if (labelOf(t)) break;
        const val = raw(r, v);
        kpi.fields[key] = typeof val === 'number' && val > 30000 && val < 80000 && /^(period|start|end)$/.test(key) ? serialText(val) : t;
        used.add(r + ':' + v);
        const link = at(r, v) && at(r, v).l && at(r, v).l.Target;
        if (key === 'master_drive' && link) kpi.master_drive_url = link;
        break;
      }
    }
    // Isi tanpa label (mis. tab Lazada): dikenali dari bentuknya.
    const loose = [];
    for (let r = range.s.r; r <= maxR; r++) for (let c = range.s.c; c <= maxC; c++) {
      if (used.has(r + ':' + c) || (r >= platRow && platRow >= 0 && c >= platCol)) continue;
      const t = txt(r, c);
      if (t && /\d/.test(t) && t.length <= 120 && !labelOf(t) && typeof raw(r, c) === 'string') loose.push(t);
    }
    if (platRow >= 0) {
      for (let r = platRow + 1; r <= maxR + 3 && r <= range.e.r; r++) {
        const p = platformsIn(txt(r, platCol))[0];
        if (!p) continue;
        const fyp = fypCol >= 0 ? cellNum(at(r, fypCol)) : null, k = kpiCol >= 0 ? cellNum(at(r, kpiCol)) : null;
        const vt = viewsCol >= 0 ? (() => { const m = txt(r, viewsCol).toLowerCase().match(new RegExp(NUM)); return m ? numUnit(m[1], m[2]) : null; })() : null;
        if (fyp !== null || k !== null) kpi.platforms[p] = { fyp, kpi: k };
        if (vt) (kpi.views_kpi ||= { target: 0, by_platform: {} }).by_platform[p] = vt;
      }
      if (kpi.views_kpi) kpi.views_kpi.target = Object.values(kpi.views_kpi.by_platform).reduce((a, x) => a + x, 0);
    }
    const f = kpi.fields;
    // KPI dalam kalimat (label KPI / Target / Platform).
    const kt = parseKpiText([f.kpi_text, f.views_target].filter(Boolean).join(' ; '));
    const plats = platformsIn(f.platform_text).length ? platformsIn(f.platform_text) : platformsIn(f.kpi_text);
    if (!Object.keys(kpi.platforms).length && (kt.fyp_count !== null || kt.fyp_views !== null)) {
      for (const p of plats.length ? plats : ['tiktok', 'instagram', 'youtube']) kpi.platforms[p] = { fyp: kt.fyp_views, kpi: kt.fyp_count };
    }
    if (!kpi.views_kpi && kt.views_total) kpi.views_kpi = { target: kt.views_total, platforms: plats.length ? plats : null };
    const contractPlats = platformsIn(f.contract);
    if (plats.length || contractPlats.length) kpi.contract_platforms = plats.length ? plats : contractPlats;

    // Kuantitas: "x/Month" = per bulan; angka lain di Goal / Total Video / Quantity = total video kontrak.
    const perMonth = (t) => { const m = String(t || '').toLowerCase().match(/(\d+)\s*(?:video|vids?|konten|content)?\s*\/\s*(?:1\s*)?(month|bulan|bln|mo)\b|(\d+)\s*(?:video|vids?|konten|content)?\s*(per|tiap|setiap)\s*(month|bulan)/); return m ? +(m[1] || m[3]) : null; };
    const totalOf = (t) => { const s = String(t || '').toLowerCase(); if (!/\d/.test(s) || perMonth(s.split(/\s-\s/)[0]) !== null) return null; return firstNumber(s); };
    kpi.quantity_per_month = [f.quantity, f.total_video, ...loose].map(perMonth).find((x) => x !== null) ?? null;
    kpi.total_videos = [f.total_video, f.quantity].map(totalOf).find((x) => x !== null)
      ?? loose.map((t) => (/^\s*\d+\s*(video|vids?|konten|content)s?\b/i.test(t) ? firstNumber(t) : null)).find((x) => x !== null) ?? null;
    // Goal "30/ Month" padahal Quantity "15/ Month": angka Goal yang berbeda itu adalah total kontrak (salah tulis).
    if (kpi.total_videos === null && perMonth(f.total_video) !== null && perMonth(f.total_video) !== kpi.quantity_per_month) kpi.total_videos = perMonth(f.total_video);

    // Timeline kontrak: Month Start-End, atau Start + End, atau tanggal dalam kurung di Contract, atau isi tanpa label.
    let periodText = f.period || [f.start, f.end].filter(Boolean).join(' - ');
    let per = parsePeriods(periodText);
    if (!per.length) for (const t of [f.contract, ...loose]) { const p = parsePeriods(t); if (p.length) { per = p; periodText = t; break; } }
    if (!f.period && periodText) f.period = periodText;
    if (!Object.keys(f).length && !Object.keys(kpi.platforms).length && !kpi.views_kpi) return null;
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

// Pembaca xlsx ringan: hanya nilai sel dan hyperlink, satu tab sekali baca (hemat CPU dan memori).
// unzip = fungsi unzipSync dari pustaka fflate.
const dec = new TextDecoder();
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`)); return m ? unescapeXml(m[1]) : null; };

export const utils = {
  encode_cell: ({ r, c }) => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s + (r + 1); },
  decode_cell: (a) => { const m = a.match(/^([A-Z]+)(\d+)$/); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { r: +m[2] - 1, c: c - 1 }; },
  decode_range: (ref) => { const [a, b] = ref.split(':'); return { s: utils.decode_cell(a), e: utils.decode_cell(b || a) }; },
};

// Daftar tab + teks bersama. Mengembalikan { tabs: [{ name, path }], strings: [...] }.
export function openWorkbook(unzip, data) {
  const meta = unzip(data, { filter: (f) => f.name === 'xl/workbook.xml' || f.name === 'xl/_rels/workbook.xml.rels' || f.name === 'xl/sharedStrings.xml' });
  const rels = new Map();
  for (const m of dec.decode(meta['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship\b[^>]*>/g)) {
    const target = attr(m[0], 'Target');
    rels.set(attr(m[0], 'Id'), target.startsWith('/') ? target.slice(1) : 'xl/' + target);
  }
  const tabs = [];
  for (const m of dec.decode(meta['xl/workbook.xml']).matchAll(/<sheet\b[^>]*>/g)) tabs.push({ name: attr(m[0], 'name'), path: rels.get(attr(m[0], 'r:id')) });
  const strings = [];
  if (meta['xl/sharedStrings.xml']) {
    for (const m of dec.decode(meta['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
      let s = '';
      for (const t of (m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += t[1];
      strings.push(unescapeXml(s));
    }
  }
  return { tabs, strings };
}

// Membaca satu tab menjadi lembar gaya SheetJS: ws['A1'] = { v, l?: { Target } }.
export function readTab(unzip, data, wb, tab) {
  const relPath = tab.path.replace(/([^/]+)$/, '_rels/$1.rels');
  const files = unzip(data, { filter: (f) => f.name === tab.path || f.name === relPath });
  if (!files[tab.path]) return null;
  const xml = dec.decode(files[tab.path]);
  const ws = {};
  let maxR = 0, maxC = 0;
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    if (!m[2]) continue;
    const ref = attr(m[1], 'r'), type = attr(m[1], 't');
    let v;
    if (type === 'inlineStr') { const t = m[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/); if (t) v = unescapeXml(t[1]); }
    else {
      const raw = m[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      if (!raw) continue;
      if (type === 's') v = wb.strings[+raw[1]];
      else if (type === 'str' || type === 'e') v = unescapeXml(raw[1]);
      else if (type === 'b') v = raw[1] === '1';
      else v = Number(raw[1]);
    }
    if (v === undefined || v === '' || !ref) continue;
    ws[ref] = { v };
    const p = utils.decode_cell(ref);
    if (p.r > maxR) maxR = p.r;
    if (p.c > maxC) maxC = p.c;
  }
  if (files[relPath]) {
    const targets = new Map();
    for (const m of dec.decode(files[relPath]).matchAll(/<Relationship\b[^>]*>/g)) targets.set(attr(m[0], 'Id'), attr(m[0], 'Target'));
    for (const m of xml.matchAll(/<hyperlink\b[^>]*>/g)) {
      const ref = (attr(m[0], 'ref') || '').split(':')[0], target = targets.get(attr(m[0], 'r:id'));
      if (!ref || !target) continue;
      (ws[ref] ||= { v: '' }).l = { Target: target };
      const p = utils.decode_cell(ref);
      if (p.r > maxR) maxR = p.r;
      if (p.c > maxC) maxC = p.c;
    }
  }
  ws['!ref'] = 'A1:' + utils.encode_cell({ r: maxR, c: maxC });
  return ws;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import '../web/urls.js';
import '../web/sheet.js';
const { parseUrl } = globalThis.XUrls;
const { parseSheetDate } = globalThis.XSheet;

test('mengenali link tiap platform', () => {
  assert.deepEqual(parseUrl('https://www.tiktok.com/@high.gentlemen.id/video/7455474365472279813?is_from_webapp=1'),
    { platform: 'tiktok', key: '7455474365472279813', url: 'https://www.tiktok.com/@high.gentlemen.id/video/7455474365472279813' });
  assert.equal(parseUrl('https://www.tiktok.com/@h1tsindonesia/video/7522055498032565511&web_id=75').key, '7522055498032565511');
  assert.equal(parseUrl('https://vt.tiktok.com/ZSxRnEcuU/').key, 'short:ZSxRnEcuU');
  assert.equal(parseUrl('https://www.instagram.com/reel/DZr3IIOzvUA/?igsh=abc').key, 'DZr3IIOzvUA');
  assert.equal(parseUrl('https://youtube.com/shorts/8GeRTmMe-q0?si=9k9').key, '8GeRTmMe-q0');
  assert.equal(parseUrl('https://youtu.be/8GeRTmMe-q0').url, 'https://www.youtube.com/shorts/8GeRTmMe-q0');
  assert.equal(parseUrl('https://l.instagram.com/?u=https%3A%2F%2Fyoutube.com%2Fshorts%2FT47Co-ZgvC0%3Fsi%3D9J').key, 'T47Co-ZgvC0');
  assert.deepEqual(parseUrl('https://www.tt.site/t/ZSgRQLaUC/'), { platform: 'tiktok', key: 'short:ZSgRQLaUC', url: 'https://www.tt.site/t/ZSgRQLaUC/' });
  assert.equal(parseUrl('https://drive.google.com/file/d/abc'), null);
  assert.equal(parseUrl('https://www.tiktok.com/@akun'), null);
});

test('tanggal di sheet', () => {
  assert.equal(parseSheetDate({ v: '17 Juni 2026' }), '2026-06-17T05:00:00.000Z');
  assert.equal(parseSheetDate({ v: 46000 }), '2025-12-09T05:00:00.000Z');
  assert.equal(parseSheetDate({ v: 'Organic' }), null);
});

test('periode kontrak dari teks macrosheets', () => {
  const P = (t) => [...globalThis.XSheet.parsePeriods(t, '2026-11-19')];
  assert.deepEqual(P('08 Des 2025 - 10 Jul 2026, 10 Juni 2026 - 22 Jan 2027'), [['2025-12-08', '2026-07-10'], ['2026-06-10', '2027-01-22']]);
  assert.deepEqual(P('14 September - 30 April 2027'), [['2026-09-14', '2027-04-30']]);
  assert.deepEqual(P("31 AGS'26 - 15 JAN'27"), [['2026-08-31', '2027-01-15']]);
  assert.deepEqual(P('OCT-MAR'), [['2026-10-01', '2027-03-31']]);
  assert.deepEqual(P('4th Contract (15 Sep - 31 Jan)'), [['2026-09-15', '2027-01-31']]);
  assert.deepEqual(P('Unlimited'), []);
  assert.deepEqual(P('TBC FROM BD'), []);
});

test('blok KPI dibaca menurut artinya (format Kenkun, Selvy, Belva)', async () => {
  const { utils } = await import('../supabase/functions/sync-sheet/xlsxlite.js');
  const grid = (rows) => { const ws = {}; let mr = 0, mc = 0; rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '') { ws[utils.encode_cell({ r, c })] = { v }; mr = Math.max(mr, r); mc = Math.max(mc, c); } })); ws['!ref'] = 'A1:' + utils.encode_cell({ r: mr, c: mc }); return ws; };
  const K = (rows) => globalThis.XSheet.parseKpi(grid(rows), utils);
  // Selvy: KPI dalam kalimat
  let k = K([['Contract:', '3 MONTHS', 'KPI:', '8 FYP - /FYP: 10,000 Views'], ['Quantity:', '30/ Month', 'Platform:', 'TikTok'], ['Goal:', '90 / 3 month'], ['MONTH START-END', '4th Contract (15 Sep - 31 Jan 2027)']]);
  assert.deepEqual(k.platforms, { tiktok: { fyp: 10000, kpi: 8 } });
  assert.equal(k.quantity_per_month, 30); assert.equal(k.total_videos, 90);
  // Kenkun: tabel Platform | FYP Quantity | KPI FYP
  k = K([['Nama Brand', 'X', 'Contract', '6 Month', 'Platform', 'FYP Quantity', 'KPI FYP'], ['PM', 'Ken', 'Quantity', '15/ MONTH', 'TikTok', 10000, 10], ['', '', 'Total Video', '90 Vids', 'Instagram', 10000, '-']]);
  assert.deepEqual(k.platforms, { tiktok: { fyp: 10000, kpi: 10 }, instagram: { fyp: 10000, kpi: null } });
  assert.equal(k.total_videos, 90);
  // KPI berdasarkan total views selama kontrak
  k = K([['Contract:', '3 Months'], ['KPI:', '1.000.000 Views'], ['Platform:', 'TikTok, IG']]);
  assert.deepEqual(k.views_kpi, { target: 1000000, platforms: ['tiktok', 'instagram'] });
  assert.deepEqual(k.platforms, {});
  // Isi tertukar (Quantity "90", Goal "15/Month") dan Goal "30/ Month" yang maksudnya total
  k = K([['Quantity:', '90'], ['Goal:', '15/Month']]); assert.equal(k.quantity_per_month, 15); assert.equal(k.total_videos, 90);
  k = K([['Contract:', '2 Months'], ['Quantity:', '15/ Month'], ['Goal:', '30/ Month']]); assert.equal(k.quantity_per_month, 15); assert.equal(k.total_videos, 30);
  // Start + End terpisah (End berupa tanggal Excel), dan tanpa label sama sekali
  k = K([['Start:', '23 Sept'], ['End:', 46112]]); assert.deepEqual([...k.periods], [['2025-09-23', '2026-03-31']]);
  k = K([['Nama Brand:', 'LAZADA', '3 Month (27 Juni 2026 - 6 Nov 2026)'], ['PM:', 'BELVA', '15/ MONTH'], ['', '', '45 Video']]);
  assert.equal(k.quantity_per_month, 15); assert.equal(k.total_videos, 45); assert.deepEqual([...k.periods], [['2026-06-27', '2026-11-06']]);
});

test('tabel KPI dengan judul "Platform (+Clippo)" dan KPI views di sel gabungan', async () => {
  const { utils } = await import('../supabase/functions/sync-sheet/xlsxlite.js');
  const ws = {}; const rows = [['Contract:', '6 Months', 'Platform (+Clippo)', 'FYP Quantity', 'KPI FYP'], ['Quantity:', '20/ Month', 'TikTok', '10.000', '60,000,000 Views'], ['Goal:', '240 Content', 'Instagram', '10.000'], ['MONTH START-END', '10 AGS - 26 MAR', 'Youtube', '10.000']];
  rows.forEach((row, r) => row.forEach((v, c) => { ws[utils.encode_cell({ r, c })] = { v }; })); ws['!ref'] = 'A1:E4';
  const k = globalThis.XSheet.parseKpi(ws, utils);
  assert.deepEqual(k.platforms, { tiktok: { fyp: 10000, kpi: null }, instagram: { fyp: 10000, kpi: null }, youtube: { fyp: 10000, kpi: null } });
  assert.deepEqual(k.views_kpi, { target: 60000000, platforms: ['tiktok', 'instagram', 'youtube'] });
  assert.equal(k.quantity_per_month, 20); assert.equal(k.total_videos, 240); assert.equal(k.periods.length, 1);
});

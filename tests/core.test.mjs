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

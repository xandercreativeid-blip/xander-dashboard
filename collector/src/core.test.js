import test from 'node:test';
import assert from 'node:assert/strict';
import '../../web/urls.js';
import { nextFetch } from './run.js';
import { parseSheetDate } from './sheet.js';
const { parseUrl } = globalThis.XUrls;

test('mengenali link tiap platform', () => {
  assert.deepEqual(parseUrl('https://www.tiktok.com/@high.gentlemen.id/video/7455474365472279813?is_from_webapp=1'),
    { platform: 'tiktok', key: '7455474365472279813', url: 'https://www.tiktok.com/@high.gentlemen.id/video/7455474365472279813' });
  assert.equal(parseUrl('https://www.tiktok.com/@h1tsindonesia/video/7522055498032565511&web_id=75').key, '7522055498032565511');
  assert.equal(parseUrl('https://vt.tiktok.com/ZSxRnEcuU/').key, 'short:ZSxRnEcuU');
  assert.equal(parseUrl('https://www.instagram.com/reel/DZr3IIOzvUA/?igsh=abc').key, 'DZr3IIOzvUA');
  assert.equal(parseUrl('https://youtube.com/shorts/8GeRTmMe-q0?si=9k9').key, '8GeRTmMe-q0');
  assert.equal(parseUrl('https://youtu.be/8GeRTmMe-q0').url, 'https://www.youtube.com/shorts/8GeRTmMe-q0');
  assert.equal(parseUrl('https://l.instagram.com/?u=https%3A%2F%2Fyoutube.com%2Fshorts%2FT47Co-ZgvC0%3Fsi%3D9J').key, 'T47Co-ZgvC0');
  assert.equal(parseUrl('https://drive.google.com/file/d/abc'), null);
  assert.equal(parseUrl('https://www.tiktok.com/@akun'), null);
});

test('jadwal refresh mengikuti umur konten', () => {
  const now = Date.UTC(2026, 10, 15), day = 86400000;
  const gapH = (ageDays) => (new Date(nextFetch(new Date(now - ageDays * day).toISOString(), now)) - now) / 3600000;
  assert.ok(gapH(2) >= 8 && gapH(2) < 9);
  assert.ok(gapH(10) >= 24 && gapH(10) < 27);
  assert.ok(gapH(45) >= 168 && gapH(45) < 185);
  assert.ok(gapH(200) >= 720 && gapH(200) < 793);
});

test('tanggal di sheet', () => {
  assert.equal(parseSheetDate({ v: '17 Juni 2026' }), '2026-06-17T05:00:00.000Z');
  assert.equal(parseSheetDate({ v: 46000 }), '2025-12-09T05:00:00.000Z');
  assert.equal(parseSheetDate({ v: 'Organic' }), null);
});

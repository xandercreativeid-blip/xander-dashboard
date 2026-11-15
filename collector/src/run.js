// Pengambil data. Jalankan: node src/run.js [--local data.json] [--sheet <url|file.xlsx>] [--limit N]
import { fetchTikTok, fetchYouTubeBatch, fetchYouTubePage, fetchInstagram, BlockedError } from './fetchers.js';
import { JsonStore, SupabaseStore } from './store.js';
import { syncSheet } from './sheet.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const env = process.env;
const LIMIT = Number(arg('--limit') || env.MAX_ITEMS || 600);
const DEADLINE = Date.now() + Number(env.MAX_MINUTES || 12) * 60000;
const IG_PER_RUN = Number(env.IG_PER_RUN || 60);
const H = 3600000, D = 24 * H;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeLeft = () => Date.now() < DEADLINE;

// Jadwal refresh bertingkat menurut umur konten.
export function nextFetch(postedAt, now = Date.now()) {
  const age = postedAt ? now - new Date(postedAt).getTime() : 0;
  const gap = age < 7 * D ? 8 * H : age < 30 * D ? D : age < 90 * D ? 7 * D : 30 * D;
  return new Date(now + gap + Math.random() * gap * 0.1).toISOString();
}

async function saveResult(store, row, r) {
  const now = new Date().toISOString();
  if (r.status === 'unavailable')
    return store.update(row.id, { status: 'unavailable', last_error: r.error, last_fetched_at: now, refresh_requested_at: null,
      fail_count: row.fail_count + 1, next_fetch_at: new Date(Date.now() + 30 * D).toISOString() });
  const patch = { status: 'ok', source: 'auto', last_error: null, fail_count: 0, last_fetched_at: now, refresh_requested_at: null };
  for (const k of ['title', 'posted_at', 'views', 'likes', 'comments', 'shares', 'saves']) if (r[k] !== null && r[k] !== undefined) patch[k] = r[k];
  patch.next_fetch_at = nextFetch(patch.posted_at || row.posted_at);
  // Link pendek TikTok: setelah ID asli diketahui, gabungkan jika konten yang sama sudah tercatat.
  if (r.external_id && r.external_id !== row.external_id) {
    const dup = await store.find(row.brand_id, row.platform, r.external_id);
    if (dup && dup.id !== row.id) {
      await store.update(dup.id, { ...patch, aliases: [...new Set([...(dup.aliases || []), row.external_id, ...(row.aliases || [])])] });
      return store.remove(row.id);
    }
    patch.aliases = [...new Set([...(row.aliases || []), row.external_id])];
    patch.external_id = r.external_id;
    patch.url = r.url || row.url;
  }
  return store.update(row.id, patch);
}

async function saveError(store, row, err) {
  const fails = row.fail_count + 1;
  await store.update(row.id, { status: row.status === 'ok' ? 'ok' : 'error', last_error: String(err.message || err).slice(0, 200),
    fail_count: fails, refresh_requested_at: null,
    next_fetch_at: new Date(Date.now() + Math.min(2 ** fails * H, 7 * D)).toISOString() });
}

// Jalankan `worker` paralel; berhenti untuk platform ini jika diblokir berturut-turut.
async function pool(rows, concurrency, delayMs, worker, store, label, count) {
  let i = 0, blockedStreak = 0, stopped = false;
  const loop = async () => {
    while (!stopped && timeLeft() && i < rows.length) {
      const row = rows[i++];
      try {
        const r = await worker(row);
        await saveResult(store, row, r);
        blockedStreak = 0; count[r.status === 'ok' ? 'ok' : 'unavailable']++;
      } catch (e) {
        count.failed++;
        await saveError(store, row, e);
        if (e instanceof BlockedError && ++blockedStreak >= 5) { stopped = true; console.log(`[${label}] diblokir berturut-turut — dihentikan untuk putaran ini (${e.message})`); }
      }
      await sleep(delayMs + Math.random() * delayMs);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, loop));
}

async function main() {
  const local = arg('--local');
  const store = local ? new JsonStore(local)
    : await SupabaseStore.connect(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1) Sinkronisasi Google Sheets
  const cfg = (await store.getSetting('sheet')) || {};
  const source = arg('--sheet') || cfg.url;
  const lastSync = (await store.getSetting('sheet_last_sync')) || {};
  if (source && (arg('--sheet') || cfg.sync_requested || !lastSync.at || Date.now() - new Date(lastSync.at).getTime() > 6 * H)) {
    try {
      const s = await syncSheet(store, source, cfg.exclude_tabs || ['Credential Brand', 'List Reporting']);
      console.log(`[sheet] brand baru ${s.brands}, link baru ${s.added}, diperbarui ${s.updated}`);
      await store.setSetting('sheet_last_sync', { at: new Date().toISOString(), ...s });
    } catch (e) {
      console.log(`[sheet] gagal: ${e.message}`);
      await store.setSetting('sheet_last_sync', { ...lastSync, error: e.message, error_at: new Date().toISOString() });
    }
    if (cfg.sync_requested) await store.setSetting('sheet', { ...cfg, sync_requested: false });
    await store.flush();
  }

  // 2) Ambil metrik untuk konten yang jatuh tempo
  const due = await store.due(LIMIT);
  const by = (p) => due.filter((c) => c.platform === p);
  const count = { tiktok: { ok: 0, unavailable: 0, failed: 0 }, youtube: { ok: 0, unavailable: 0, failed: 0 }, instagram: { ok: 0, unavailable: 0, failed: 0 } };
  console.log(`[antrean] ${due.length} konten (tiktok ${by('tiktok').length}, youtube ${by('youtube').length}, instagram ${by('instagram').length})`);

  const jobs = [];
  jobs.push(pool(by('tiktok'), 3, 500, (row) => fetchTikTok(row.url), store, 'tiktok', count.tiktok));

  const yt = by('youtube');
  if (env.YOUTUBE_API_KEY && yt.length) {
    jobs.push((async () => {
      try {
        const res = await fetchYouTubeBatch(yt.map((r) => r.external_id), env.YOUTUBE_API_KEY);
        for (const row of yt) { const r = res.get(row.external_id); await saveResult(store, row, r); count.youtube[r.status === 'ok' ? 'ok' : 'unavailable']++; }
      } catch (e) { console.log(`[youtube] ${e.message}`); for (const row of yt) { await saveError(store, row, e); count.youtube.failed++; } }
    })());
  } else jobs.push(pool(yt, 2, 400, (row) => fetchYouTubePage(row.external_id), store, 'youtube', count.youtube));

  // Instagram: pelan dan berurutan; konten yang diminta manual didahulukan.
  jobs.push(pool(by('instagram').slice(0, IG_PER_RUN), 1, 2500, (row) => fetchInstagram(row.external_id, env.IG_SESSIONID), store, 'instagram', count.instagram));

  await Promise.all(jobs);
  await store.setSetting('collector_status', { at: new Date().toISOString(), queued: due.length, ...count });
  await store.flush();
  for (const [p, c] of Object.entries(count)) console.log(`[${p}] berhasil ${c.ok}, tidak tersedia ${c.unavailable}, gagal ${c.failed}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

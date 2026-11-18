// Pengambil data (Supabase Edge Function).
//   POST {action:"run"}            -> proses antrean di latar belakang (dipanggil terjadwal tiap 5 menit)
//   POST {action:"run", ids:[...]} -> refresh konten tertentu sekarang juga, tunggu sampai selesai
//   POST {action:"sheet", url}     -> unduh Google Sheets (xlsx) untuk dibaca dashboard; wajib login
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const H = 3600000, D = 24 * H;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: any) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
class BlockedError extends Error {}

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers },
    redirect: "follow", signal: AbortSignal.timeout(20000),
  });
  return { res, text: await res.text() };
}

// ------------------------------------------------------------------ TikTok
async function fetchTikTok(url: string) {
  const { res, text } = await get(url);
  if (res.status === 404) return { status: "unavailable", error: "Video tidak ditemukan" };
  const m = text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new BlockedError(`TikTok tidak memberi data (HTTP ${res.status})`);
  let detail: any;
  try { detail = JSON.parse(m[1]).__DEFAULT_SCOPE__?.["webapp.video-detail"]; } catch { throw new BlockedError("Data TikTok tidak terbaca"); }
  if (!detail) {
    if (!/\/(video|photo)\/\d+/.test(res.url)) return { status: "unavailable", error: "Link bukan halaman video" };
    throw new BlockedError("TikTok tidak mengirim detail video");
  }
  const item = detail.itemInfo?.itemStruct;
  if ((detail.statusCode && detail.statusCode !== 0) || !item?.id) {
    return { status: "unavailable", error: /cross_border/.test(detail.statusMsg || "")
      ? "Dibatasi wilayah: TikTok tidak menampilkan video ini di luar negara asalnya"
      : `Video tidak tersedia (${String(detail.statusMsg || detail.statusCode || "kosong").slice(0, 80)})` };
  }
  const s = { ...(item.stats || {}), ...(item.statsV2 || {}) };
  return {
    status: "ok", external_id: String(item.id),
    url: `https://www.tiktok.com/@${item.author?.uniqueId || ""}/video/${item.id}`,
    title: (item.desc || "").slice(0, 300) || null,
    posted_at: item.createTime ? new Date(Number(item.createTime) * 1000).toISOString() : null,
    views: num(s.playCount), likes: num(s.diggCount), comments: num(s.commentCount),
    shares: num(s.shareCount), saves: num(s.collectCount),
  };
}

// ------------------------------------------------------------------ YouTube
async function fetchYouTubeBatch(ids: string[], apiKey: string) {
  const out = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${chunk.join(",")}&key=${apiKey}`, { signal: AbortSignal.timeout(20000) });
    const json = await res.json();
    if (!res.ok) throw new Error(`YouTube API: ${json.error?.message || res.status}`);
    for (const it of json.items || []) {
      out.set(it.id, {
        status: "ok", title: it.snippet?.title?.slice(0, 300) || null, posted_at: it.snippet?.publishedAt || null,
        views: num(it.statistics?.viewCount), likes: num(it.statistics?.likeCount),
        comments: num(it.statistics?.commentCount), shares: null, saves: null,
      });
    }
    for (const id of chunk) if (!out.has(id)) out.set(id, { status: "unavailable", error: "Video tidak ditemukan / privat" });
  }
  return out;
}
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
async function fetchYouTubePage(id: string) {
  const { res, text } = await get(`https://www.youtube.com/shorts/${id}`);
  if (res.status === 404) return { status: "unavailable", error: "Video tidak ditemukan" };
  const views = text.match(/"viewCount":"(\d+)"/);
  if (!views) {
    if (/"playabilityStatus":\{"status":"(ERROR|UNPLAYABLE)"/.test(text)) return { status: "unavailable", error: "Video tidak tersedia / privat" };
    throw new BlockedError("YouTube membatasi akses tanpa API key (isi YouTube API key di pengaturan)");
  }
  const likes = text.match(/"likeCount":"(\d+)"/);
  const date = text.match(/"uploadDate":"([^"]+)"/) || text.match(/"publishDate":"([^"]+)"/);
  const title = text.match(/<meta property="og:title" content="([^"]*)"/) || text.match(/<meta name="title" content="([^"]*)"/);
  return {
    status: "ok", title: title ? decode(title[1]).slice(0, 300) : null,
    posted_at: date ? new Date(date[1]).toISOString() : null,
    views: num(views[1]), likes: likes ? num(likes[1]) : null, comments: null, shares: null, saves: null,
  };
}

// ------------------------------------------------------------------ Instagram (eksperimental)
async function fetchInstagram(shortcode: string, sessionId: string) {
  const { res, text } = await get(`https://www.instagram.com/reel/${shortcode}/`, { Cookie: `sessionid=${sessionId}` });
  if (res.status === 404) return { status: "unavailable", error: "Reels tidak ditemukan" };
  if (/\/accounts\/login/.test(res.url)) throw new BlockedError("Sesi akun IG ditolak / kedaluwarsa");
  const at = text.indexOf(`"code":"${shortcode}"`);
  const win = at >= 0 ? text.slice(Math.max(0, at - 60000), at + 60000) : "";
  const pick = (...keys: string[]) => { for (const k of keys) { const m = win.match(new RegExp(`"${k}":(\\d+)`)); if (m) return Number(m[1]); } return null; };
  const views = pick("ig_play_count", "play_count", "video_play_count", "video_view_count", "view_count");
  const likes = pick("like_count");
  if (views === null && likes === null) throw new BlockedError("Instagram tidak mengirim angka (akun mungkin dibatasi)");
  const taken = pick("taken_at");
  return {
    status: "ok", title: null, posted_at: taken ? new Date(taken * 1000).toISOString() : null,
    views, likes, comments: pick("comment_count"), shares: null, saves: null,
  };
}

// ------------------------------------------------------------------ simpan hasil
function nextFetch(postedAt: string | null) {
  const age = postedAt ? Date.now() - new Date(postedAt).getTime() : 0;
  const gap = age < 7 * D ? 8 * H : age < 30 * D ? D : age < 90 * D ? 7 * D : 30 * D;
  return new Date(Date.now() + gap + Math.random() * gap * 0.1).toISOString();
}
const upd = async (id: string, patch: any) => { const { error } = await sb.from("contents").update(patch).eq("id", id); if (error) throw new Error(error.message); };

async function saveResult(row: any, r: any) {
  const now = new Date().toISOString();
  if (r.status === "unavailable") {
    return upd(row.id, { status: "unavailable", last_error: r.error, last_fetched_at: now, refresh_requested_at: null,
      fail_count: row.fail_count + 1, next_fetch_at: new Date(Date.now() + 30 * D).toISOString() });
  }
  const patch: any = { status: "ok", source: row.source === "manual" ? "manual" : "auto", last_error: null, fail_count: 0, last_fetched_at: now, refresh_requested_at: null };
  for (const k of ["title", "posted_at"]) if (r[k] !== null && r[k] !== undefined) patch[k] = r[k];
  // Angka langsung dari platform disimpan di "live"; database menggabungkannya dengan angka Sheet
  // (diambil yang tertinggi per metrik, lihat fungsi merge_metrics di schema.sql).
  patch.live = Object.fromEntries(["views", "likes", "comments", "shares", "saves"].map((k) => [k, r[k] ?? null]));
  patch.next_fetch_at = nextFetch(patch.posted_at || row.posted_at);
  if (r.external_id && r.external_id !== row.external_id) {
    // Link pendek TikTok: gabungkan bila video yang sama sudah tercatat di brand ini.
    const { data: dup } = await sb.from("contents").select("id, aliases").eq("brand_id", row.brand_id).eq("platform", row.platform)
      .eq("external_id", r.external_id).maybeSingle();
    if (dup && dup.id !== row.id) {
      await upd(dup.id, { ...patch, aliases: [...new Set([...(dup.aliases || []), row.external_id, ...(row.aliases || [])])] });
      await sb.from("contents").delete().eq("id", row.id);
      return;
    }
    patch.aliases = [...new Set([...(row.aliases || []), row.external_id])];
    patch.external_id = r.external_id;
    patch.url = r.url || row.url;
  }
  return upd(row.id, patch);
}
async function saveError(row: any, err: any) {
  const fails = row.fail_count + 1;
  await upd(row.id, { status: row.status === "ok" ? "ok" : "error", last_error: String(err?.message || err).slice(0, 200), fail_count: fails,
    refresh_requested_at: null, next_fetch_at: new Date(Date.now() + Math.min(2 ** fails * H, 7 * D)).toISOString() });
}

async function pool(rows: any[], concurrency: number, delayMs: number, worker: (row: any) => Promise<any>, count: any, deadline: number) {
  let i = 0, streak = 0, stopped = false;
  const loop = async () => {
    while (!stopped && Date.now() < deadline && i < rows.length) {
      const row = rows[i++];
      try {
        const r = await worker(row);
        await saveResult(row, r);
        streak = 0; count[r.status === "ok" ? "ok" : "unavailable"]++;
      } catch (e) {
        count.failed++; count.error = String((e as Error).message).slice(0, 120);
        await saveError(row, e);
        if (e instanceof BlockedError && ++streak >= 4) stopped = true;
      }
      await sleep(delayMs + Math.random() * delayMs);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, loop));
}

async function due(platform: string, limit: number) {
  if (limit <= 0) return [];
  const { data: req } = await sb.from("contents").select("*").eq("platform", platform).not("refresh_requested_at", "is", null)
    .order("refresh_requested_at").limit(limit);
  const rest = limit - (req?.length || 0);
  if (rest <= 0) return req || [];
  const { data: more } = await sb.from("contents").select("*").eq("platform", platform).is("refresh_requested_at", null)
    .lte("next_fetch_at", new Date().toISOString()).order("next_fetch_at").limit(rest);
  return [...(req || []), ...(more || [])];
}

async function run(ids?: string[]) {
  const deadline = Date.now() + 110000;
  const { data: cfgRows } = await sb.from("private_config").select("key, value");
  const cfg = Object.fromEntries((cfgRows || []).map((r: any) => [r.key, r.value]));
  const ytKey = cfg.youtube_api_key, igSession = cfg.ig_sessionid;

  let tt: any[], yt: any[], ig: any[];
  if (ids?.length) {
    const { data } = await sb.from("contents").select("*").in("id", ids.slice(0, 60));
    const by = (p: string) => (data || []).filter((c: any) => c.platform === p);
    [tt, yt, ig] = [by("tiktok"), by("youtube"), by("instagram")];
  } else {
    // Kunci sederhana agar dua putaran terjadwal tidak tumpang tindih.
    const { data: lock } = await sb.from("settings").select("value").eq("key", "collector_lock").maybeSingle();
    if (lock && Date.now() - new Date(lock.value.at).getTime() < 130000) return { skipped: "sedang berjalan" };
    await sb.from("settings").upsert({ key: "collector_lock", value: { at: new Date().toISOString() } });
    [tt, yt, ig] = await Promise.all([due("tiktok", 36), due("youtube", ytKey ? 100 : 6), due("instagram", igSession ? 6 : 0)]);
  }
  const count: any = { tiktok: { ok: 0, unavailable: 0, failed: 0 }, youtube: { ok: 0, unavailable: 0, failed: 0 }, instagram: { ok: 0, unavailable: 0, failed: 0 } };
  const jobs: Promise<any>[] = [pool(tt, 3, 300, (row) => fetchTikTok(row.url), count.tiktok, deadline)];
  if (ytKey && yt.length) {
    jobs.push((async () => {
      try {
        const res = await fetchYouTubeBatch(yt.map((r) => r.external_id), ytKey);
        for (const row of yt) { const r = res.get(row.external_id); await saveResult(row, r); count.youtube[r.status === "ok" ? "ok" : "unavailable"]++; }
      } catch (e) { count.youtube.error = String((e as Error).message).slice(0, 120); for (const row of yt) { await saveError(row, e); count.youtube.failed++; } }
    })());
  } else jobs.push(pool(yt, 1, 800, (row) => fetchYouTubePage(row.external_id), count.youtube, deadline));
  if (igSession) jobs.push(pool(ig, 1, 2500, (row) => fetchInstagram(row.external_id, igSession), count.instagram, deadline));
  else for (const row of ig) { await saveError(row, new Error("Instagram butuh sesi akun IG (isi di pengaturan)")); count.instagram.failed++; }
  await Promise.all(jobs);

  const queued = tt.length + yt.length + ig.length;
  const status = { at: new Date().toISOString(), queued, ...count };
  if (!ids?.length) await sb.from("settings").delete().eq("key", "collector_lock");
  if (queued) await sb.from("settings").upsert({ key: "collector_status", value: status });
  else await sb.from("settings").upsert({ key: "collector_heartbeat", value: { at: status.at } });
  return status;
}

const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "sheet") {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
      const { data: user } = await sb.auth.getUser(token);
      if (!user?.user) return json({ error: "Perlu login" }, 401);
      const id = (String(body.url || "").match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/) || [])[1];
      if (!id) return json({ error: "Link Google Sheets tidak dikenali" }, 400);
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { signal: AbortSignal.timeout(60000) });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.includes("spreadsheetml")) {
        return json({ error: 'Sheet tidak bisa diunduh. Pastikan aksesnya "Siapa saja yang memiliki link: Pelihat".' }, 400);
      }
      return new Response(res.body, { headers: { ...CORS, "Content-Type": type } });
    }
    if (Array.isArray(body.ids) && body.ids.length) return json(await run(body.ids));
    // Terjadwal: jawab segera, kerjakan di latar belakang.
    (globalThis as any).EdgeRuntime?.waitUntil(run().catch((e) => console.error("run gagal", e)));
    return json({ started: true });
  } catch (e) {
    return json({ error: String((e as Error).message) }, 500);
  }
});

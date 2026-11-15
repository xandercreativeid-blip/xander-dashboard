// Mengambil metrik publik per konten. Setiap fungsi mengembalikan:
//   { status:'ok', external_id?, url?, title, posted_at, views, likes, comments, shares, saves }
//   { status:'unavailable', error }   -> konten dihapus / privat
// atau melempar Error (gagal sementara: diblokir, jaringan, butuh login).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function get(url, headers = {}, ms = 25000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    redirect: 'follow', signal: AbortSignal.timeout(ms),
  });
  return { res, text: await res.text() };
}
const num = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));

export class BlockedError extends Error {}

// ---------------------------------------------------------------- TikTok
export async function fetchTikTok(url) {
  const { res, text } = await get(url);
  if (res.status === 404) return { status: 'unavailable', error: 'Video tidak ditemukan' };
  const m = text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new BlockedError(`TikTok tidak memberi data (HTTP ${res.status})`);
  let detail;
  try { detail = JSON.parse(m[1]).__DEFAULT_SCOPE__?.['webapp.video-detail']; } catch { throw new BlockedError('Data TikTok tidak terbaca'); }
  if (!detail) {
    // Link pendek yang mengarah ke halaman non-video (profil, dsb.)
    if (!/\/(video|photo)\/\d+/.test(res.url)) return { status: 'unavailable', error: 'Link bukan halaman video' };
    throw new BlockedError('TikTok tidak mengirim detail video');
  }
  const item = detail.itemInfo?.itemStruct;
  if (detail.statusCode && detail.statusCode !== 0 || !item?.id)
    return { status: 'unavailable', error: /cross_border/.test(detail.statusMsg || '')
      ? 'Dibatasi wilayah: TikTok tidak menampilkan video ini di luar negara asalnya'
      : `Video tidak tersedia (${String(detail.statusMsg || detail.statusCode || 'kosong').slice(0, 80)})` };
  const s = { ...(item.stats || {}), ...(item.statsV2 || {}) };
  const user = item.author?.uniqueId;
  return {
    status: 'ok', external_id: String(item.id),
    url: `https://www.tiktok.com/@${user || ''}/video/${item.id}`,
    title: (item.desc || '').slice(0, 300) || null,
    posted_at: item.createTime ? new Date(Number(item.createTime) * 1000).toISOString() : null,
    views: num(s.playCount), likes: num(s.diggCount), comments: num(s.commentCount),
    shares: num(s.shareCount), saves: num(s.collectCount),
  };
}

// ---------------------------------------------------------------- YouTube
// Dengan YOUTUBE_API_KEY (gratis): API resmi, 50 video per panggilan, termasuk jumlah komentar.
export async function fetchYouTubeBatch(ids, apiKey) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${chunk.join(',')}&key=${apiKey}`,
      { signal: AbortSignal.timeout(25000) });
    const json = await res.json();
    if (!res.ok) throw new Error(`YouTube API: ${json.error?.message || res.status}`);
    for (const it of json.items || []) {
      out.set(it.id, {
        status: 'ok', title: it.snippet?.title?.slice(0, 300) || null, posted_at: it.snippet?.publishedAt || null,
        views: num(it.statistics?.viewCount), likes: num(it.statistics?.likeCount),
        comments: num(it.statistics?.commentCount), shares: null, saves: null,
      });
    }
    for (const id of chunk) if (!out.has(id)) out.set(id, { status: 'unavailable', error: 'Video tidak ditemukan / privat' });
  }
  return out;
}

// Tanpa API key: baca halaman publik (jumlah komentar tidak tersedia dengan cara ini).
export async function fetchYouTubePage(id) {
  const { res, text } = await get(`https://www.youtube.com/shorts/${id}`);
  if (res.status === 404) return { status: 'unavailable', error: 'Video tidak ditemukan' };
  const views = text.match(/"viewCount":"(\d+)"/);
  if (!views) {
    // "Sign in to confirm you're not a bot" = dibatasi sementara, bukan video hilang.
    if (/"playabilityStatus":\{"status":"(ERROR|UNPLAYABLE)"/.test(text)) return { status: 'unavailable', error: 'Video tidak tersedia / privat' };
    if (/"playabilityStatus":\{"status":"LOGIN_REQUIRED"/.test(text)) throw new BlockedError('YouTube membatasi akses tanpa API key (isi YOUTUBE_API_KEY)');
    throw new BlockedError(`YouTube tidak memberi data (HTTP ${res.status})`);
  }
  const likes = text.match(/"likeCount":"(\d+)"/);
  const date = text.match(/"uploadDate":"([^"]+)"/) || text.match(/"publishDate":"([^"]+)"/);
  const title = text.match(/<meta property="og:title" content="([^"]*)"/) || text.match(/<meta name="title" content="([^"]*)"/);
  return {
    status: 'ok', title: title ? decode(title[1]).slice(0, 300) : null,
    posted_at: date ? new Date(date[1]).toISOString() : null,
    views: num(views[1]), likes: likes ? num(likes[1]) : null, comments: null, shares: null, saves: null,
  };
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// ---------------------------------------------------------------- Instagram (eksperimental)
// Instagram tidak menampilkan angka tanpa login. Jika IG_SESSIONID diisi (cookie "sessionid" dari
// akun IG khusus), halaman Reels dimuat sebagai akun tsb dan angka publiknya dibaca.
// Shares & saves tidak pernah tersedia (hanya pemilik akun yang bisa melihat).
export async function fetchInstagram(shortcode, sessionId) {
  const headers = sessionId ? { Cookie: `sessionid=${sessionId}` } : {};
  const { res, text } = await get(`https://www.instagram.com/reel/${shortcode}/`, headers);
  if (res.status === 404) return { status: 'unavailable', error: 'Reels tidak ditemukan' };
  if (/\/accounts\/login/.test(res.url)) throw new BlockedError(sessionId ? 'Sesi akun IG ditolak / kedaluwarsa' : 'Instagram meminta login');
  const at = text.indexOf(`"code":"${shortcode}"`);
  const win = at >= 0 ? text.slice(Math.max(0, at - 60000), at + 60000) : '';
  const pick = (...keys) => { for (const k of keys) { const m = win.match(new RegExp(`"${k}":(\\d+)`)); if (m) return Number(m[1]); } return null; };
  const views = pick('ig_play_count', 'play_count', 'video_play_count', 'video_view_count', 'view_count');
  const likes = pick('like_count');
  if (views === null && likes === null)
    throw new BlockedError(sessionId ? 'Instagram tidak mengirim angka (akun mungkin dibatasi)' : 'Instagram butuh login (IG_SESSIONID belum diisi)');
  const taken = pick('taken_at');
  const cap = win.match(/"caption":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/);
  let title = null;
  if (cap) { try { title = JSON.parse(`"${cap[1]}"`).slice(0, 300); } catch {} }
  return {
    status: 'ok', title, posted_at: taken ? new Date(taken * 1000).toISOString() : null,
    views, likes, comments: pick('comment_count'), shares: null, saves: null,
  };
}

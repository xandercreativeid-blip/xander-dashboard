// Pengenal link TikTok / Instagram / YouTube. Dipakai dashboard (browser) dan collector (Node).
(function (g) {
  function parseUrl(raw) {
    if (typeof raw !== 'string') return null;
    let s = raw.trim();
    if (!/^https?:\/\//i.test(s)) {
      if (/^(www\.|m\.|vt\.|vm\.)?(tiktok\.com|instagram\.com|youtube\.com|youtu\.be)\//i.test(s)) s = 'https://' + s;
      else return null;
    }
    let u;
    try { u = new URL(s); } catch { return null; }
    let host = u.hostname.toLowerCase();
    if (host === 'l.instagram.com' && u.searchParams.get('u')) return parseUrl(u.searchParams.get('u'));
    const path = u.pathname;
    let m;
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      if ((m = path.match(/\/(?:video|photo)\/(\d{8,})/))) {
        const user = (path.match(/\/(@[^/]+)\//) || [])[1] || '@';
        return { platform: 'tiktok', key: m[1], url: `https://www.tiktok.com/${user}/video/${m[1]}` };
      }
      if ((host === 'vt.tiktok.com' || host === 'vm.tiktok.com') && (m = path.match(/^\/([A-Za-z0-9]+)/)))
        return { platform: 'tiktok', key: 'short:' + m[1], url: `https://${host}/${m[1]}/` };
      if ((m = path.match(/^\/t\/([A-Za-z0-9]+)/)))
        return { platform: 'tiktok', key: 'short:' + m[1], url: `https://www.tiktok.com/t/${m[1]}/` };
      return null;
    }
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
      if ((m = path.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/)))
        return { platform: 'instagram', key: m[1], url: `https://www.instagram.com/reel/${m[1]}/` };
      return null;
    }
    if (host === 'youtu.be') {
      if ((m = path.match(/^\/([A-Za-z0-9_-]{11})/))) return yt(m[1]);
      return null;
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if ((m = path.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/))) return yt(m[1]);
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return yt(v);
      return null;
    }
    return null;
  }
  function yt(id) { return { platform: 'youtube', key: id, url: `https://www.youtube.com/shorts/${id}` }; }
  function extractUrls(text) {
    return (String(text).match(/(?:https?:\/\/)?[\w.-]*(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be)\/[^\s"'<>,]+/gi) || []);
  }
  g.XUrls = { parseUrl, extractUrls };
})(typeof globalThis !== 'undefined' ? globalThis : window);

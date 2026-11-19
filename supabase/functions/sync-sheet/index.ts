// Sinkron Google Sheets terjadwal: link baru di Sheet otomatis masuk ke dashboard.
// Tiap pemanggilan memproses beberapa tab saja (bergiliran) agar muat di batas CPU server.
// urls.js dan sheet.js adalah salinan dari folder web/ (sumber yang sama dengan dashboard).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { unzipSync } from "npm:fflate@0.8.2";
import { openWorkbook, readTab, utils } from "./xlsxlite.js";
import "./urls.js";
import "./sheet.js";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const METRICS = ["views", "likes", "comments", "shares", "saves"];
const norm = (t: any) => String(t || "").trim().toLowerCase();
const TABS_PER_RUN = 5;

async function all(build: () => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const sheetId = (u: string) => (String(u || "").match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/) || [])[1];

// Satu pemanggilan = satu macrosheets, 5 tab. Giliran berpindah ke macrosheets berikutnya setelah semua tabnya selesai.
async function sync() {
  const { data: row } = await sb.from("settings").select("value").eq("key", "sheet").maybeSingle();
  const cfg = row?.value || {};
  const ids = [...new Set((cfg.urls || (cfg.url ? [cfg.url] : [])).map(sheetId).filter(Boolean))] as string[];
  if (!ids.length) return { skipped: "link Google Sheets belum diisi" };
  const { data: cur } = await sb.from("settings").select("value").eq("key", "sheet_cursor").maybeSingle();
  const si = (Number(cur?.value?.sheet) || 0) % ids.length, sid = ids[si];
  // Status tiap macrosheets untuk fitur "Connected Macrosheets" di dashboard.
  const statusRow = (await sb.from("settings").select("value").eq("key", "sheet_status").maybeSingle()).data?.value || {};
  const st: any = { ...(statusRow[sid] || {}) };
  for (const k of Object.keys(statusRow)) if (!ids.includes(k)) delete statusRow[k];
  const saveStatus = (patch: any) => sb.from("settings").upsert({ key: "sheet_status", value: { ...statusRow, [sid]: { ...st, ...patch } } });
  if (!st.title || Date.now() - Date.parse(st.title_at || 0) > 24 * 3600000) {
    try {
      const html = await (await fetch(`https://docs.google.com/spreadsheets/d/${sid}/htmlview`, { signal: AbortSignal.timeout(20000) })).text();
      const t = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
      if (t) { st.title = t.replace(/\s*-\s*Google (Drive|Sheets)\s*$/, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim(); st.title_at = new Date().toISOString(); }
    } catch { /* judul hanya tampilan */ }
  }
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sid}/export?format=xlsx`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("spreadsheetml")) {
    await sb.from("settings").upsert({ key: "sheet_cursor", value: { sheet: (si + 1) % ids.length, next: 0 } });
    const error = `Tidak bisa diunduh (HTTP ${res.status}). Pastikan aksesnya "Siapa saja yang memiliki link: Pelihat".`;
    await saveStatus({ error, error_at: new Date().toISOString() });
    throw new Error(`Macrosheets ${si + 1}: ${error}`);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  const wb = openWorkbook(unzipSync, data);
  const skip = new Set((cfg.exclude_tabs || []).map(norm));
  const wanted = wb.tabs.filter((t: any) => t.path && !skip.has(norm(t.name)));
  if (!wanted.length) { await sb.from("settings").upsert({ key: "sheet_cursor", value: { sheet: (si + 1) % ids.length, next: 0 } }); return { skipped: "tidak ada tab" }; }
  const start = cur?.value?.sheet === si ? (Number(cur?.value?.next) || 0) % wanted.length : 0;
  const slice = wanted.slice(start, start + TABS_PER_RUN);
  const done = start + slice.length >= wanted.length;
  await sb.from("settings").upsert({ key: "sheet_cursor", value: done ? { sheet: (si + 1) % ids.length, next: 0 } : { sheet: si, next: start + slice.length } });

  const brands = await all(() => sb.from("brands").select("*").order("id"));
  // Tab disembunyikan di macrosheets = brand diarsipkan; bila brand ada di beberapa macrosheets,
  // diarsipkan hanya kalau tab-nya tersembunyi di semuanya.
  const hiddenByTab = new Map(wanted.map((t: any) => [norm(t.name), !!t.hidden]));
  for (const b of brands) {
    const h = hiddenByTab.get(norm(b.sheet_tab || b.name));
    if (h === undefined) continue;
    const state = { ...(b.sheet_state || {}), [sid]: h };
    const sheetHidden = Object.values(state).every(Boolean);
    if (JSON.stringify(state) !== JSON.stringify(b.sheet_state) || sheetHidden !== b.sheet_hidden) {
      // Macrosheets yang utama: hide/unhide tab terbaru mengalahkan pengaturan arsip manual.
      const patch: any = { sheet_state: state, sheet_hidden: sheetHidden };
      if (sheetHidden !== b.sheet_hidden) patch.archived_override = null;
      await sb.from("brands").update(patch).eq("id", b.id);
      Object.assign(b, patch);
    }
  }
  const prev = (await sb.from("settings").select("value").eq("key", "sheet_last_sync").maybeSingle()).data?.value;
  const stats: any = { at: new Date().toISOString(), brands: 0, added: 0, updated: 0, auto: true, last_added_at: prev?.last_added_at || null,
    sheet: si + 1, sheets: ids.length, tabs: slice.map((t: any) => t.name) };
  for (const t of slice) {
    const ws = readTab(unzipSync, data, wb, t);
    const tab = { tab: t.name, links: (globalThis as any).XSheet.parseTab(ws, utils) };
    if (!tab.links.length) continue;
    let brand = brands.find((b) => norm(b.sheet_tab || b.name) === norm(tab.tab));
    if (!brand) {
      // Tab diganti nama? Cari brand yang memiliki sebagian besar link tab ini dan nama tab lamanya sudah tidak ada.
      const keys = new Set(tab.links.map((l: any) => l.platform + ":" + l.key));
      const owners = new Map<string, number>();
      const rows = await all(() => sb.from("contents").select("brand_id, platform, external_id, aliases").order("id"));
      for (const c of rows) {
        if (keys.has(c.platform + ":" + c.external_id) || (c.aliases || []).some((a: string) => keys.has(c.platform + ":" + a))) owners.set(c.brand_id, (owners.get(c.brand_id) || 0) + 1);
      }
      const [bestId, hits] = [...owners.entries()].sort((a, z) => z[1] - a[1])[0] || [];
      const old = bestId && brands.find((b) => b.id === bestId);
      const tabNames = new Set(wb.tabs.map((x: any) => norm(x.name)));
      if (old && old.sheet_state?.[sid] !== undefined && hits >= 3 && hits >= keys.size * 0.5 && !tabNames.has(norm(old.sheet_tab || old.name)) && !brands.some((b) => b.id !== old.id && norm(b.name) === norm(tab.tab))) {
        const patch: any = { sheet_tab: tab.tab };
        if (norm(old.name) === norm(old.sheet_tab || old.name)) patch.name = tab.tab.trim();
        await sb.from("brands").update(patch).eq("id", old.id);
        Object.assign(old, patch); brand = old; stats.renamed = [...(stats.renamed || []), tab.tab];
      }
    }
    if (!brand) {
      const { data, error } = await sb.from("brands").insert({ name: tab.tab.trim(), sheet_tab: tab.tab, sheet_hidden: !!t.hidden, sheet_state: { [sid]: !!t.hidden } }).select().single();
      if (error) throw new Error(error.message);
      brand = data; brands.push(brand); stats.brands++;
    }
    // Blok KPI di atas tabel (Contract, Quantity, Total Video, FYP Quantity, KPI FYP, ...); dikosongkan bila tidak ada.
    const kpi = (globalThis as any).XSheet.parseKpi(ws, utils);
    const kpiMap = { ...(brand.kpi || {}) };
    if (kpi) kpiMap[sid] = { ...kpi, tab: t.name, hidden: !!t.hidden }; else delete kpiMap[sid];
    if (JSON.stringify(kpiMap) !== JSON.stringify(brand.kpi || {})) { await sb.from("brands").update({ kpi: kpiMap }).eq("id", brand.id); brand.kpi = kpiMap; }

    const contents = await all(() => sb.from("contents").select("id, brand_id, platform, external_id, aliases, source, posted_at, sheet, live").eq("brand_id", brand.id).order("id"));
    const seen: string[] = [];
    const byKey = new Map<string, any>();
    for (const c of contents) { byKey.set(c.platform + ":" + c.external_id, c); for (const a of c.aliases || []) byKey.set(c.platform + ":" + a, c); }
    const fresh: any[] = [], patches: [string, any][] = [];
    for (const l of tab.links) {
      const cur = byKey.get(l.platform + ":" + l.key);
      if (cur) seen.push(cur.id);
      const hasData = METRICS.some((k) => l.sheet[k] !== null);
      if (!cur) {
        const base = { brand_id: brand.id, platform: l.platform, external_id: l.key, url: l.url, posted_at: l.sheet.posted_at, sheet_refs: { [sid]: t.name } };
        fresh.push(hasData
          ? { ...base, sheet: Object.fromEntries(METRICS.map((k) => [k, l.sheet[k]])), source: "sheet" }
          : { ...base, source: "none" });
      } else if (hasData && cur.source === "manual") {
        // Isian manual di dashboard bertahan sampai angka di macrosheets berubah; setelah itu macrosheets yang dipakai.
        const snap = Object.fromEntries(METRICS.map((k) => [k, l.sheet[k]]));
        if (!cur.sheet) patches.push([cur.id, { sheet: snap }]);
        else if (JSON.stringify(snap) !== JSON.stringify(Object.fromEntries(METRICS.map((k) => [k, cur.sheet?.[k] ?? null])))) patches.push([cur.id, { sheet: snap, source: cur.live ? "auto" : "sheet" }]);
      } else if (hasData) {
        // Angka Sheet disimpan di kolom "sheet"; database memilih angka tertinggi antara Sheet dan data langsung.
        const snap = Object.fromEntries(METRICS.map((k) => [k, l.sheet[k]]));
        const patch: any = {};
        if (JSON.stringify(snap) !== JSON.stringify(Object.fromEntries(METRICS.map((k) => [k, cur.sheet?.[k] ?? null])))) patch.sheet = snap;
        if (cur.source === "none") patch.source = "sheet";
        if ((cur.source === "sheet" || cur.source === "none" || !cur.posted_at) && l.sheet.posted_at && (!cur.posted_at || Date.parse(cur.posted_at) !== Date.parse(l.sheet.posted_at))) patch.posted_at = l.sheet.posted_at;
        if (Object.keys(patch).length) patches.push([cur.id, patch]);
      }
    }
    for (let i = 0; i < fresh.length; i += 500) {
      const { error } = await sb.from("contents").upsert(fresh.slice(i, i + 500), { onConflict: "brand_id,platform,external_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    for (let i = 0; i < patches.length; i += 10) await Promise.all(patches.slice(i, i + 10).map(([cid, p]) => sb.from("contents").update(p).eq("id", cid)));
    stats.added += fresh.length; stats.updated += patches.length;
    // Link yang dihapus dari tab ini ikut hilang dari dashboard (kecuali masih tercantum di macrosheets lain).
    const { data: refs, error: refErr } = await sb.rpc("sync_sheet_refs", { p_sheet: sid, p_tab: t.name, p_brand: brand.id, p_seen: seen });
    if (refErr) throw new Error(refErr.message);
    stats.removed = (stats.removed || 0) + (refs?.removed || 0);
    if (refs?.skipped_removal) stats.removal_skipped = [...(stats.removal_skipped || []), `${t.name} (${refs.skipped_removal})`];
  }
  if (stats.added) stats.last_added_at = stats.at;
  stats.done = done; stats.tabs_total = wanted.length;
  await saveStatus({ at: stats.at, error: null, error_at: null, tabs: wanted.length, hidden_tabs: wanted.filter((x: any) => x.hidden).length,
    ...(done ? { full_at: stats.at } : {}) });
  await sb.from("settings").upsert({ key: "sheet_last_sync", value: stats });
  await sb.from("settings").delete().eq("key", "sheet_sync_error");
  return stats;
}

// Dipanggil terjadwal (pg_cron) dan dari tombol "Save & Sync Now" di dashboard (butuh izin CORS).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    return new Response(JSON.stringify(await sync()), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    const error = String((e as Error).message);
    await sb.from("settings").upsert({ key: "sheet_sync_error", value: { at: new Date().toISOString(), error } });
    return new Response(JSON.stringify({ error }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});

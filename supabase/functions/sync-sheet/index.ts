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

async function sync() {
  const { data: row } = await sb.from("settings").select("value").eq("key", "sheet").maybeSingle();
  const cfg = row?.value;
  const id = (String(cfg?.url || "").match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/) || [])[1];
  if (!id) return { skipped: "link Google Sheets belum diisi" };
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("spreadsheetml")) throw new Error(`Sheet tidak bisa diunduh (HTTP ${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  const wb = openWorkbook(unzipSync, data);
  const skip = new Set((cfg.exclude_tabs || []).map(norm));
  const wanted = wb.tabs.filter((t: any) => t.path && !skip.has(norm(t.name)));
  if (!wanted.length) return { skipped: "tidak ada tab" };
  const { data: cur } = await sb.from("settings").select("value").eq("key", "sheet_cursor").maybeSingle();
  const start = (Number(cur?.value?.next) || 0) % wanted.length;
  const slice = Array.from({ length: Math.min(TABS_PER_RUN, wanted.length) }, (_, i) => wanted[(start + i) % wanted.length]);
  await sb.from("settings").upsert({ key: "sheet_cursor", value: { next: (start + slice.length) % wanted.length } });

  const brands = await all(() => sb.from("brands").select("*").order("id"));
  const prev = (await sb.from("settings").select("value").eq("key", "sheet_last_sync").maybeSingle()).data?.value;
  const stats: any = { at: new Date().toISOString(), brands: 0, added: 0, updated: 0, auto: true, last_added_at: prev?.last_added_at || null, tabs: slice.map((t: any) => t.name) };
  for (const t of slice) {
    const tab = { tab: t.name, links: (globalThis as any).XSheet.parseTab(readTab(unzipSync, data, wb, t), utils) };
    if (!tab.links.length) continue;
    let brand = brands.find((b) => norm(b.sheet_tab || b.name) === norm(tab.tab));
    if (!brand) {
      const { data, error } = await sb.from("brands").insert({ name: tab.tab.trim(), sheet_tab: tab.tab }).select().single();
      if (error) throw new Error(error.message);
      brand = data; brands.push(brand); stats.brands++;
    }
    const contents = await all(() => sb.from("contents").select("id, brand_id, platform, external_id, aliases, source, posted_at, sheet").eq("brand_id", brand.id).order("id"));
    const byKey = new Map<string, any>();
    for (const c of contents) { byKey.set(c.platform + ":" + c.external_id, c); for (const a of c.aliases || []) byKey.set(c.platform + ":" + a, c); }
    const fresh: any[] = [], patches: [string, any][] = [];
    for (const l of tab.links) {
      const cur = byKey.get(l.platform + ":" + l.key);
      const hasData = METRICS.some((k) => l.sheet[k] !== null);
      if (!cur) {
        const base = { brand_id: brand.id, platform: l.platform, external_id: l.key, url: l.url, posted_at: l.sheet.posted_at };
        fresh.push(hasData
          ? { ...base, sheet: Object.fromEntries(METRICS.map((k) => [k, l.sheet[k]])), source: "sheet" }
          : { ...base, source: "none" });
      } else if (hasData && cur.source !== "manual") {
        // Angka Sheet disimpan di kolom "sheet"; database memilih angka tertinggi antara Sheet dan data langsung.
        const snap = Object.fromEntries(METRICS.map((k) => [k, l.sheet[k]]));
        const patch: any = {};
        if (JSON.stringify(snap) !== JSON.stringify(Object.fromEntries(METRICS.map((k) => [k, cur.sheet?.[k] ?? null])))) patch.sheet = snap;
        if (cur.source === "none") patch.source = "sheet";
        if ((cur.source === "sheet" || cur.source === "none") && l.sheet.posted_at && (!cur.posted_at || Date.parse(cur.posted_at) !== Date.parse(l.sheet.posted_at))) patch.posted_at = l.sheet.posted_at;
        if (Object.keys(patch).length) patches.push([cur.id, patch]);
      }
    }
    for (let i = 0; i < fresh.length; i += 500) {
      const { error } = await sb.from("contents").upsert(fresh.slice(i, i + 500), { onConflict: "brand_id,platform,external_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    for (let i = 0; i < patches.length; i += 10) await Promise.all(patches.slice(i, i + 10).map(([cid, p]) => sb.from("contents").update(p).eq("id", cid)));
    stats.added += fresh.length; stats.updated += patches.length;
  }
  if (stats.added) stats.last_added_at = stats.at;
  await sb.from("settings").upsert({ key: "sheet_last_sync", value: stats });
  await sb.from("settings").delete().eq("key", "sheet_sync_error");
  return stats;
}

Deno.serve(async () => {
  try {
    return new Response(JSON.stringify(await sync()), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const error = String((e as Error).message);
    await sb.from("settings").upsert({ key: "sheet_sync_error", value: { at: new Date().toISOString(), error } });
    return new Response(JSON.stringify({ error }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

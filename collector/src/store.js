// Penyimpanan: Supabase (produksi) atau file JSON lokal (uji coba / demo).
import fs from 'node:fs';
import crypto from 'node:crypto';

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { brands: [], contents: [], settings: {} };
    this.db.settings ||= {};
  }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.db)); }
  async getBrands() { return this.db.brands; }
  async createBrand(row) {
    const b = { id: crypto.randomUUID(), views_target: 10000, created_at: new Date().toISOString(), ...row };
    this.db.brands.push(b); return b;
  }
  async getContents(brandId) { return this.db.contents.filter((c) => c.brand_id === brandId); }
  async insertContents(rows) {
    const now = new Date().toISOString();
    for (const r of rows) this.db.contents.push({
      id: crypto.randomUUID(), aliases: [], title: null, posted_at: null, views: null, likes: null, comments: null,
      shares: null, saves: null, source: 'none', status: 'pending', last_error: null, fail_count: 0,
      last_fetched_at: null, next_fetch_at: now, refresh_requested_at: null, created_at: now, ...r });
  }
  async due(limit) {
    const now = new Date().toISOString();
    const req = this.db.contents.filter((c) => c.refresh_requested_at);
    const due = this.db.contents.filter((c) => !c.refresh_requested_at && c.next_fetch_at <= now)
      .sort((a, b) => (a.next_fetch_at < b.next_fetch_at ? -1 : 1));
    return [...req, ...due].slice(0, limit);
  }
  async update(id, patch) { Object.assign(this.db.contents.find((c) => c.id === id), patch); }
  async remove(id) { this.db.contents = this.db.contents.filter((c) => c.id !== id); }
  async find(brandId, platform, externalId) {
    return this.db.contents.find((c) => c.brand_id === brandId && c.platform === platform && c.external_id === externalId) || null;
  }
  async getSetting(key) { return this.db.settings[key] ?? null; }
  async setSetting(key, value) { this.db.settings[key] = value; }
  async flush() { this.save(); }
}

export class SupabaseStore {
  constructor(client) { this.sb = client; }
  static async connect(url, serviceKey) {
    const { createClient } = await import('@supabase/supabase-js');
    return new SupabaseStore(createClient(url, serviceKey, { auth: { persistSession: false } }));
  }
  ok({ data, error }) { if (error) throw new Error(`Supabase: ${error.message}`); return data; }
  async all(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = this.ok(await build().range(from, from + 999));
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }
  async getBrands() { return this.all(() => this.sb.from('brands').select('*').order('name')); }
  async createBrand(row) { return this.ok(await this.sb.from('brands').insert(row).select().single()); }
  async getContents(brandId) { return this.all(() => this.sb.from('contents').select('*').eq('brand_id', brandId).order('id')); }
  async insertContents(rows) {
    for (let i = 0; i < rows.length; i += 500)
      this.ok(await this.sb.from('contents').upsert(rows.slice(i, i + 500), { onConflict: 'brand_id,platform,external_id', ignoreDuplicates: true }));
  }
  async due(limit) {
    const req = this.ok(await this.sb.from('contents').select('*').not('refresh_requested_at', 'is', null)
      .order('refresh_requested_at').limit(limit));
    const rest = limit - req.length;
    if (rest <= 0) return req;
    const due = this.ok(await this.sb.from('contents').select('*').is('refresh_requested_at', null)
      .lte('next_fetch_at', new Date().toISOString()).order('next_fetch_at').limit(rest));
    return [...req, ...due];
  }
  async update(id, patch) { this.ok(await this.sb.from('contents').update(patch).eq('id', id)); }
  async remove(id) { this.ok(await this.sb.from('contents').delete().eq('id', id)); }
  async find(brandId, platform, externalId) {
    return this.ok(await this.sb.from('contents').select('*').eq('brand_id', brandId).eq('platform', platform)
      .eq('external_id', externalId).maybeSingle());
  }
  async getSetting(key) {
    const row = this.ok(await this.sb.from('settings').select('value').eq('key', key).maybeSingle());
    return row ? row.value : null;
  }
  async setSetting(key, value) { this.ok(await this.sb.from('settings').upsert({ key, value })); }
  async flush() {}
}

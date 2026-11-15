-- Xander Creative Agency — Content Performance Dashboard
-- Jalankan seluruh file ini sekali di Supabase: SQL Editor > New query > Run.

create extension if not exists pgcrypto;

create table if not exists brands (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  views_target bigint not null default 10000,
  sheet_tab    text,
  created_at   timestamptz not null default now()
);

create table if not exists contents (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  platform      text not null check (platform in ('tiktok','instagram','youtube')),
  external_id   text not null,            -- ID video / shortcode; 'short:xxx' = link pendek yang belum di-resolve
  aliases       text[] not null default '{}',
  url           text not null,
  title         text,
  posted_at     timestamptz,
  views         bigint,
  likes         bigint,
  comments      bigint,
  shares        bigint,
  saves         bigint,
  source        text not null default 'none' check (source in ('none','auto','sheet','manual')),
  status        text not null default 'pending' check (status in ('pending','ok','error','unavailable')),
  last_error    text,
  fail_count    int not null default 0,
  last_fetched_at      timestamptz,
  next_fetch_at        timestamptz not null default now(),
  refresh_requested_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (brand_id, platform, external_id)
);
create index if not exists contents_due_idx on contents (next_fetch_at);
create index if not exists contents_req_idx on contents (refresh_requested_at) where refresh_requested_at is not null;
create index if not exists contents_brand_idx on contents (brand_id, posted_at);

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

-- Hanya user yang login (tim internal) yang bisa membaca/mengubah data.
alter table brands   enable row level security;
alter table contents enable row level security;
alter table settings enable row level security;

drop policy if exists team_all on brands;
drop policy if exists team_all on contents;
drop policy if exists team_all on settings;
create policy team_all on brands   for all to authenticated using (true) with check (true);
create policy team_all on contents for all to authenticated using (true) with check (true);
create policy team_all on settings for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- OPSIONAL: tombol "Refresh" langsung menyalakan pengambil data di GitHub
-- (tanpa ini, permintaan refresh diproses pada jadwal berikutnya).
-- Isi tabel private_config lewat SQL Editor (lihat README, langkah 6).
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

create table if not exists private_config (
  key   text primary key,
  value text not null
);
alter table private_config enable row level security;  -- tanpa policy: tidak bisa dibaca dari dashboard

create or replace function trigger_collector() returns text
language plpgsql security definer set search_path = public, net as $$
declare repo text; token text;
begin
  select value into repo  from private_config where key = 'github_repo';
  select value into token from private_config where key = 'github_token';
  if repo is null or token is null then return 'not_configured'; end if;
  perform net.http_post(
    url     := 'https://api.github.com/repos/' || repo || '/dispatches',
    body    := '{"event_type":"refresh"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'content-dashboard',
      'Content-Type', 'application/json'));
  return 'triggered';
end $$;
revoke all on function trigger_collector() from public, anon;
grant execute on function trigger_collector() to authenticated;

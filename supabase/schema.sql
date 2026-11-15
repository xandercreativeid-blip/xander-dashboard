-- Xander Creative — Content Performance Dashboard
-- Struktur database Supabase (sudah diterapkan ke project lewat migrasi; file ini sebagai arsip).

create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

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

create table if not exists settings (key text primary key, value jsonb not null);

-- Kunci rahasia (YouTube API key, sesi IG): hanya dibaca oleh pengambil data, tidak oleh dashboard.
create table if not exists private_config (key text primary key, value text not null);

-- Daftar email anggota tim yang boleh membuka dashboard.
create table if not exists team_members (
  email    text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where email = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function is_member() from public, anon;
grant execute on function is_member() to authenticated;

alter table brands         enable row level security;
alter table contents       enable row level security;
alter table settings       enable row level security;
alter table team_members   enable row level security;
alter table private_config enable row level security;   -- tanpa policy: tertutup dari dashboard

create policy team_all on brands       for all to authenticated using (is_member()) with check (is_member());
create policy team_all on contents     for all to authenticated using (is_member()) with check (is_member());
create policy team_all on settings     for all to authenticated using (is_member()) with check (is_member());
create policy team_all on team_members for all to authenticated using (is_member()) with check (is_member());

create or replace function set_private_config(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'bukan anggota tim'; end if;
  if p_key not in ('youtube_api_key', 'ig_sessionid') then raise exception 'kunci tidak dikenal'; end if;
  if coalesce(trim(p_value), '') = '' then
    delete from private_config where key = p_key;
  else
    insert into private_config (key, value) values (p_key, trim(p_value))
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;
revoke all on function set_private_config(text, text) from public, anon;
grant execute on function set_private_config(text, text) to authenticated;

create or replace function private_config_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_member() then jsonb_build_object(
    'youtube_api_key', exists (select 1 from private_config where key = 'youtube_api_key'),
    'ig_sessionid',    exists (select 1 from private_config where key = 'ig_sessionid'))
  else '{}'::jsonb end;
$$;
revoke all on function private_config_status() from public, anon;
grant execute on function private_config_status() to authenticated;

-- Jadwal: panggil pengambil data (Edge Function "collect") tiap 5 menit.
-- Ganti <PROJECT> dan <ANON_JWT> dengan milik project (kunci "anon" lama yang berbentuk JWT).
-- select cron.schedule('collect-every-5-min', '*/5 * * * *', $cron$
--   select net.http_post(
--     url := 'https://<PROJECT>.supabase.co/functions/v1/collect',
--     body := '{"action":"run"}'::jsonb,
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_JWT>"}'::jsonb,
--     timeout_milliseconds := 10000);
-- $cron$);
-- select cron.schedule('cleanup-http-responses', '17 3 * * *',
--   $cron$ delete from net._http_response where created < now() - interval '1 day'; $cron$);

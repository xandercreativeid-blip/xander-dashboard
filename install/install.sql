-- =====================================================================================
-- Xander Creative — Content Performance Dashboard
-- Instalasi database lengkap untuk project Supabase BARU (jalankan sekali, di SQL Editor
-- atau lewat apply_migration). Aman dijalankan ulang.
-- Setelah ini: deploy 2 Edge Function, lalu jalankan install/cron.sql (lihat CLAUDE.md).
-- =====================================================================================
create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------- tabel
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  views_target bigint not null default 10000,
  sheet_tab text,
  created_at timestamptz not null default now(),
  sheet_hidden boolean not null default false,          -- tab disembunyikan di semua macrosheets
  archived_override boolean,                            -- null = ikuti macrosheets
  archived boolean generated always as (coalesce(archived_override, sheet_hidden)) stored,
  kpi jsonb not null default '{}'::jsonb,               -- { "<sheet id>": blok KPI }
  sheet_state jsonb not null default '{}'::jsonb        -- { "<sheet id>": tersembunyi? }
);

create table if not exists contents (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram', 'youtube')),
  external_id text not null,
  aliases text[] not null default '{}',
  url text not null,
  title text,
  posted_at timestamptz,
  views bigint, likes bigint, comments bigint, shares bigint, saves bigint,
  source text not null default 'none' check (source in ('none', 'auto', 'sheet', 'manual')),
  status text not null default 'pending' check (status in ('pending', 'ok', 'error', 'unavailable')),
  last_error text,
  fail_count integer not null default 0,
  last_fetched_at timestamptz,
  next_fetch_at timestamptz not null default now(),
  refresh_requested_at timestamptz,
  created_at timestamptz not null default now(),
  live jsonb,                                           -- angka dari platform
  sheet jsonb,                                          -- angka + tanggal dari macrosheets
  sheet_refs jsonb not null default '{}'::jsonb,        -- { "<sheet id>": "<nama tab>" }
  removed_at timestamptz,                               -- dihapus dari semua macrosheets
  unique (brand_id, platform, external_id)
);
create index if not exists contents_due_idx on contents (next_fetch_at);
create index if not exists contents_req_idx on contents (refresh_requested_at) where refresh_requested_at is not null;
create index if not exists contents_brand_idx on contents (brand_id, posted_at);
create index if not exists contents_brand_live_idx on contents (brand_id) where removed_at is null;

create table if not exists settings (key text primary key, value jsonb not null);
create table if not exists private_config (key text primary key, value text not null);   -- kunci rahasia
create table if not exists team_members (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- fungsi
create or replace function public.is_member() returns boolean
 language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from team_members where email = lower(auth.jwt() ->> 'email'));
$function$;

create or replace function public.merge_metrics() returns trigger
 language plpgsql set search_path to 'public' as $function$
begin
  if new.source <> 'manual' and (new.live is not null or new.sheet is not null) then
    new.views    := greatest((new.live ->> 'views')::bigint,    (new.sheet ->> 'views')::bigint);
    new.likes    := greatest((new.live ->> 'likes')::bigint,    (new.sheet ->> 'likes')::bigint);
    new.comments := greatest((new.live ->> 'comments')::bigint, (new.sheet ->> 'comments')::bigint);
    new.shares   := greatest((new.live ->> 'shares')::bigint,   (new.sheet ->> 'shares')::bigint);
    new.saves    := greatest((new.live ->> 'saves')::bigint,    (new.sheet ->> 'saves')::bigint);
  end if;
  if new.source <> 'manual' and (new.sheet ->> 'posted_at') is not null then
    new.posted_at := (new.sheet ->> 'posted_at')::timestamptz;   -- Tanggal Upload di macrosheets = acuan
  end if;
  return new;
end $function$;

drop trigger if exists contents_merge_metrics on contents;
create trigger contents_merge_metrics before insert or update on contents
  for each row execute function merge_metrics();

create or replace function public.private_config_status() returns jsonb
 language sql stable security definer set search_path to 'public' as $function$
  select case when is_member() then jsonb_build_object(
    'youtube_api_key', exists (select 1 from private_config where key = 'youtube_api_key'),
    'ig_sessionid',    exists (select 1 from private_config where key = 'ig_sessionid'))
  else '{}'::jsonb end;
$function$;

create or replace function public.set_private_config(p_key text, p_value text) returns void
 language plpgsql security definer set search_path to 'public' as $function$
begin
  if not is_member() then raise exception 'bukan anggota tim'; end if;
  if p_key not in ('youtube_api_key', 'ig_sessionid') then raise exception 'kunci tidak dikenal'; end if;
  if coalesce(trim(p_value), '') = '' then
    delete from private_config where key = p_key;
  else
    insert into private_config (key, value) values (p_key, trim(p_value))
    on conflict (key) do update set value = excluded.value;
  end if;
end $function$;

create or replace function public.sync_sheet_refs(p_sheet text, p_tab text, p_brand uuid, p_seen uuid[]) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare v_gone int; v_seen int := coalesce(array_length(p_seen, 1), 0); v_removed int := 0; v_marked int;
begin
  update contents set sheet_refs = sheet_refs || jsonb_build_object(p_sheet, p_tab), removed_at = null
   where id = any(p_seen) and (sheet_refs->>p_sheet is distinct from p_tab or removed_at is not null);
  get diagnostics v_marked = row_count;
  select count(*) into v_gone from contents
   where brand_id = p_brand and sheet_refs ? p_sheet and not (id = any(p_seen));
  if v_gone > 0 and (v_gone <= 5 or v_gone <= v_seen) then
    update contents set sheet_refs = sheet_refs - p_sheet,
           removed_at = case when (sheet_refs - p_sheet) = '{}'::jsonb then now() else removed_at end
     where brand_id = p_brand and sheet_refs ? p_sheet and not (id = any(p_seen));
    get diagnostics v_removed = row_count;
    return jsonb_build_object('marked', v_marked, 'removed', v_removed);
  end if;
  return jsonb_build_object('marked', v_marked, 'removed', 0, 'skipped_removal', v_gone);
end $function$;

-- Fungsi rahasia/internal tidak boleh dipanggil orang yang belum login.
revoke execute on function public.sync_sheet_refs(text, text, uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------- keamanan (RLS)
alter table brands         enable row level security;
alter table contents       enable row level security;
alter table settings       enable row level security;
alter table team_members   enable row level security;
alter table private_config enable row level security;   -- tanpa policy: tertutup dari dashboard

drop policy if exists team_all on brands;       create policy team_all on brands       for all to authenticated using (is_member()) with check (is_member());
drop policy if exists team_all on contents;     create policy team_all on contents     for all to authenticated using (is_member()) with check (is_member());
drop policy if exists team_all on settings;     create policy team_all on settings     for all to authenticated using (is_member()) with check (is_member());
drop policy if exists team_all on team_members; create policy team_all on team_members for all to authenticated using (is_member()) with check (is_member());

-- ---------------------------------------------------------------- pengaturan awal
-- Tab macrosheets yang bukan brand (dilewati saat sinkron). Link macrosheets diisi dari dashboard.
insert into settings (key, value) values ('sheet', '{"urls": [], "exclude_tabs": ["Credential Brand", "Credentials Account Brand", "List Reporting", "Qty Brand Status", "Setting Tracker", "TEMPLATE"]}')
on conflict (key) do nothing;

-- Anggota tim pertama (pemilik). GANTI dengan email pemilik dashboard yang baru:
-- insert into team_members (email) values (lower('email-pemilik@contoh.com')) on conflict do nothing;

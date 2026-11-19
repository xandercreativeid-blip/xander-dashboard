-- Jadwal otomatis. Jalankan SETELAH kedua Edge Function (collect, sync-sheet) ter-deploy.
-- Ganti <PROJECT_REF> dengan ID project Supabase (mis. abcdefghijklmnop) dan <ANON_JWT> dengan kunci
-- "anon" lama (bentuk JWT, diawali "eyJ...") dari Project Settings → API Keys → Legacy API keys.
-- Bila project tidak punya kunci legacy: deploy kedua fungsi dengan verify_jwt = false dan hapus baris
-- "Authorization" di bawah.
select cron.unschedule(jobname) from cron.job where jobname in ('collect-every-5-min', 'sync-sheet-every-2-min', 'cleanup-http-responses');

-- Ambil angka terbaru dari TikTok/YouTube/IG tiap 5 menit.
select cron.schedule('collect-every-5-min', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/collect',
    body := '{"action":"run"}'::jsonb,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_JWT>"}'::jsonb,
    timeout_milliseconds := 10000);
$cron$);

-- Baca macrosheets tiap 2 menit (5 tab per putaran, bergiliran antar macrosheets).
select cron.schedule('sync-sheet-every-2-min', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-sheet',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_JWT>"}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);

-- Bersihkan log panggilan HTTP setiap hari.
select cron.schedule('cleanup-http-responses', '17 3 * * *',
  $cron$ delete from net._http_response where created < now() - interval '1 day'; $cron$);

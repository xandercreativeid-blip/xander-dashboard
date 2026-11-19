# Xander Creative — Content Performance Dashboard

Catatan untuk Claude yang membuka proyek ini. Pengguna dari tim Xander Creative Agency, bukan programmer:
jawab dalam **Bahasa Indonesia** yang sederhana, jalankan langkah teknis sendiri, dan minta pengguna hanya
melakukan hal yang memang harus lewat akun mereka (login, klik izin, menyalin kunci ke form aman).
Tampilan dashboard berbahasa **Inggris**.

## Isi proyek

| Bagian | Lokasi | Jalan di |
|---|---|---|
| Dashboard (satu halaman, JavaScript biasa) | `web/` | GitHub Pages, terbit otomatis lewat `.github/workflows/pages.yml` |
| Database (tabel, fungsi, RLS) | `install/install.sql` | Supabase Postgres |
| Jadwal otomatis | `install/cron.sql` | Supabase pg_cron + pg_net |
| Pengambil angka TikTok/YouTube/IG | `supabase/functions/collect/` | Supabase Edge Function, tiap 5 menit |
| Pembaca macrosheets (Google Sheets) | `supabase/functions/sync-sheet/` | Supabase Edge Function, tiap 2 menit, 5 tab per putaran |
| Uji | `tests/core.test.mjs` | `node tests/core.test.mjs` |

`web/urls.js` dan `web/sheet.js` dipakai dashboard **dan** fungsi sync-sheet. Setiap mengubahnya, salin juga ke
`supabase/functions/sync-sheet/` lalu deploy ulang fungsi itu.

## Aturan yang sudah disepakati dengan pengguna

- Macrosheets adalah sumber utama: setiap tab = satu brand (kecuali tab di `settings.sheet.exclude_tabs`).
  Hanya link di tabel laporan (blok dengan kolom Tanggal/Views) yang dihitung. Tanggal Upload di macrosheets
  menentukan bulan konten; tanggal dari platform hanya cadangan.
- Angka tiap metrik = yang tertinggi antara macrosheets (`sheet`) dan platform (`live`); isian manual (✎) menang
  sampai angka di macrosheets berubah.
- ER = (likes + comments + shares + saves) / views. Target views default 10K; FYP Quantity di blok KPI
  macrosheets menjadi target per platform.
- Tab yang di-hide di macrosheets = brand Archived. Link yang dihapus dari macrosheets hilang dari dashboard.
- Hanya email di tabel `team_members` yang bisa melihat data (RLS `is_member()`).
- Jangan pernah meminta, membaca, atau menampilkan password/kredensial. Tab kredensial di macrosheets dilewati.
  Kunci YouTube API dan sesi IG diisi pengguna sendiri lewat dashboard (tersimpan di `private_config`,
  tidak bisa dibaca kembali).

## Pasang dashboard untuk pemilik baru (dari file ini saja)

Jalankan berurutan. Hubungkan konektor **GitHub** dan **Supabase** di akun Claude pengguna lebih dulu
(claude.ai → Settings → Connectors), atau minta pengguna melakukannya.

1. **Supabase**: buat project baru (region Singapore, `ap-southeast-1`) atau pakai project kosong milik pengguna.
   Catat Project URL dan publishable key (`sb_publishable_...`).
2. **Database**: jalankan `install/install.sql` (apply_migration). Lalu tambahkan email pengguna sebagai
   anggota tim pertama: `insert into team_members (email) values (lower('<email pengguna>'));`
3. **Edge Functions**: deploy `supabase/functions/sync-sheet` (file: index.ts, xlsxlite.js, urls.js, sheet.js)
   dan `supabase/functions/collect` (index.ts), keduanya `verify_jwt: true`.
4. **Jadwal**: isi `<PROJECT_REF>` dan `<ANON_JWT>` di `install/cron.sql` lalu jalankan. Kunci anon JWT ada di
   Project Settings → API Keys → Legacy API keys. Jangan simpan kunci itu ke repo.
5. **Login**: di Supabase → Authentication → URL Configuration, isi Site URL dengan alamat GitHub Pages
   dashboard. Bila "Confirm email" aktif, pengguna perlu klik link konfirmasi di email setelah membuat akun.
6. **Dashboard**: isi `web/config.js` dengan Project URL dan publishable key project baru.
7. **GitHub**: buat repo baru milik pengguna, push seluruh isi folder ini, lalu aktifkan
   Settings → Pages → Source: **GitHub Actions**. Workflow `pages.yml` menerbitkan folder `web/`.
   Untuk repo private, GitHub Pages butuh akun berbayar; bila gratis, jadikan repo public (data tetap aman
   karena dilindungi login + RLS).
8. **Pakai**: buka alamat Pages → Create Account dengan email anggota tim → login → menu
   **Data Sources & Settings**: tempel link macrosheets (satu per baris, akses "Siapa saja yang memiliki link:
   Pelihat"), klik **Save & Sync Now**. Anggota tim lain ditambahkan di menu yang sama.
9. Opsional: YouTube API key dan sesi IG diisi pengguna di menu yang sama.

Periksa hasilnya: `select * from settings where key in ('sheet_last_sync','sheet_status','collector_status');`
dan jumlah `brands`/`contents` bertambah setelah beberapa menit.

# Xander Creative — Content Performance Dashboard

Dashboard internal untuk memantau Views, Likes, Komentar, Shares, Saves, Engagement Rate, dan jumlah
konten yang mencapai target views (default 10.000) dari link TikTok, Instagram Reels, dan YouTube Shorts,
per brand, sepanjang waktu, per bulan posting, atau rentang tanggal bebas.

Biaya: Rp0 (Supabase gratis + GitHub Actions gratis + hosting statis gratis).

## Cara kerja

| Bagian | Folder | Jalan di |
|---|---|---|
| Dashboard (halaman web) | `web/` | Hosting statis gratis (Netlify / Cloudflare Pages) |
| Database + login tim | `supabase/schema.sql` | Supabase (paket gratis) |
| Pengambil data | `collector/` | GitHub Actions, otomatis tiap 2 jam + saat tombol Refresh ditekan |

Data yang bisa diambil dari link publik:

| | Views | Likes | Komentar | Shares | Saves |
|---|---|---|---|---|---|
| TikTok | ya | ya | ya | ya | ya |
| YouTube Shorts | ya | ya | ya (perlu API key) | tidak publik | tidak publik |
| Instagram Reels | perlu akun IG | perlu akun IG | perlu akun IG | tidak publik | tidak publik |

Jadwal refresh otomatis menurut umur konten: < 7 hari tiap 8 jam; 7–30 hari tiap hari;
30–90 hari tiap minggu; > 90 hari tiap bulan. Tombol ↻ meminta refresh di luar jadwal.

Jika sebuah konten belum/tidak bisa diambil otomatis, dashboard memakai angka dari Google Sheets
(berlabel "Dari Sheet") atau isian manual (tombol ✎).

## Pemasangan (sekali saja, ±30 menit)

### 1. Supabase
1. Buat akun di supabase.com, lalu **New project** (region Singapore).
2. **SQL Editor > New query**, tempel seluruh isi `supabase/schema.sql`, klik **Run**.
3. **Authentication > Users > Add user**: buat satu akun (email + kata sandi) untuk tiap anggota tim.
   Matikan pendaftaran publik di **Authentication > Sign In / Providers > Allow new users to sign up**.
4. Catat dari **Project Settings > API**: `Project URL`, kunci `anon public`, dan kunci `service_role`
   (yang terakhir ini rahasia, hanya untuk GitHub).

### 2. GitHub (pengambil data)
1. Buat repository **private** baru, unggah seluruh isi folder ini.
2. **Settings > Secrets and variables > Actions > New repository secret**, isi:
   - `SUPABASE_URL` — Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — kunci service_role
   - `YOUTUBE_API_KEY` — lihat langkah 3 (opsional tapi disarankan)
   - `IG_SESSIONID` — lihat langkah 4 (opsional)
3. Tab **Actions > Ambil data konten > Run workflow** untuk percobaan pertama.

### 3. YouTube API key (gratis)
console.cloud.google.com > buat project > **APIs & Services > Library** > aktifkan *YouTube Data API v3* >
**Credentials > Create credentials > API key**. Tanpa kunci ini YouTube tetap terambil, tetapi jumlah
komentar kosong.

### 4. Instagram (eksperimental)
Instagram tidak menampilkan angka tanpa login. Gunakan **akun IG khusus** (bukan akun klien / akun utama):
login di Chrome > F12 > Application > Cookies > `instagram.com` > salin nilai `sessionid` ke secret
`IG_SESSIONID`. Risiko: akun bisa dibatasi Instagram, dan sesi perlu diperbarui bila kedaluwarsa.
Bagian ini belum teruji dengan akun sungguhan. Tanpa itu, konten Instagram memakai angka dari Sheet / manual.

### 5. Dashboard
1. Isi `web/config.js` dengan Project URL dan kunci `anon public`.
2. Unggah folder `web/` ke hosting statis gratis, mis. app.netlify.com/drop (seret folder `web`)
   atau Cloudflare Pages (Direct Upload). Buka alamatnya, login dengan akun dari langkah 1.3.
3. Di dashboard: **Google Sheets & status** > tempel link Google Sheets > Simpan.
   Setiap tab (selain yang dilewati) menjadi satu brand; semua link di dalamnya ikut masuk otomatis.

### 6. Opsional: tombol Refresh langsung jalan
Tanpa langkah ini, permintaan refresh diproses pada jadwal 2 jam berikutnya.
1. GitHub > Settings > Developer settings > **Fine-grained token**: akses hanya ke repository ini,
   permission **Contents: Read and write**.
2. Supabase SQL Editor:
   ```sql
   insert into private_config (key, value) values
     ('github_repo', 'NAMA-AKUN/NAMA-REPO'),
     ('github_token', 'TOKEN-DARI-LANGKAH-1')
   on conflict (key) do update set value = excluded.value;
   ```

## Menjalankan di komputer sendiri (uji coba)

```bash
cd collector && npm install
node src/run.js --local data.local.json --sheet "LINK-GOOGLE-SHEETS"
```

Untuk melihat hasilnya di dashboard tanpa Supabase, simpan sebagai `web/demo-data.js`
dengan isi `window.DEMO_DATA = <isi data.local.json>;` lalu buka `web/index.html`.

## Catatan
- Rumus ER: (Likes + Komentar + Shares + Saves) ÷ Views.
- Periode selalu berdasarkan **tanggal posting** (zona waktu WIB).
- TikTok membulatkan angka besar di halaman publiknya (mis. 11,5 jt), jadi angka jutaan bersifat pembulatan.
- Konten yang dihapus/diprivat ditandai "Tidak tersedia" (arahkan kursor untuk melihat alasannya) dan angka terakhirnya dipertahankan.

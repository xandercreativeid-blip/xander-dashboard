# Xander Creative — Content Performance Dashboard

Dashboard internal untuk memantau Views, Likes, Komentar, Shares, Saves, Engagement Rate, dan jumlah
konten yang mencapai target views (default 10.000) dari link TikTok, Instagram Reels, dan YouTube Shorts,
per brand, sepanjang waktu, per bulan posting, atau rentang tanggal bebas.

## Susunan

| Bagian | Lokasi | Jalan di |
|---|---|---|
| Dashboard (halaman web) | `web/` | GitHub Pages (terbit otomatis tiap ada perubahan di `web/`) |
| Database, login, daftar anggota tim | `supabase/schema.sql` | Supabase |
| Pengambil data | `supabase/functions/collect/` | Supabase Edge Function, dipanggil tiap 5 menit + saat tombol ↻ ditekan |
| Sinkron Google Sheets | `supabase/functions/sync-sheet/` | Supabase Edge Function, tiap 3 menit memeriksa 5 tab bergiliran; link baru otomatis masuk |

## Data yang bisa diambil dari link publik

| | Views | Likes | Komentar | Shares | Saves |
|---|---|---|---|---|---|
| TikTok | ya | ya | ya | ya | ya |
| YouTube Shorts | ya | ya | perlu API key | manual (Sheet) | manual (Sheet) |
| Instagram Reels | perlu sesi akun IG | perlu sesi akun IG | perlu sesi akun IG | manual (Sheet) | manual (Sheet) |

- Jadwal refresh otomatis menurut umur konten: < 7 hari tiap 8 jam; 7–30 hari tiap hari; 30–90 hari tiap
  minggu; > 90 hari tiap bulan. Tiap putaran 5 menit memproses ±35 konten TikTok.
- Tombol ↻ pada satu konten mengambil angkanya saat itu juga.
- Konten yang belum/tidak bisa diambil otomatis memakai angka dari Google Sheets ("Dari Sheet") atau isian
  manual (tombol ✎).
- Angka di macrosheets ikut tersinkron otomatis untuk semua platform (TikTok, Instagram, YouTube). Untuk tiap
  metrik, dashboard menampilkan angka **tertinggi** antara macrosheets dan data langsung dari platform, karena
  views/likes/dst. hanya bisa bertambah: angka yang lebih tinggi adalah yang lebih baru. Angka yang diisi lewat
  tombol ✎ di dashboard selalu dipakai apa adanya.
- YouTube API key dan sesi akun Instagram diisi dari dashboard: menu **Google Sheets & status**.
  Keduanya hanya bisa ditulis dari dashboard, tidak bisa dibaca kembali.
- Bagian Instagram bersifat eksperimental dan belum teruji dengan akun sungguhan.

## Export dan TV Mode

- **⤓ Export** (kanan atas dan di atas daftar konten): unduh tampilan yang sedang aktif (brand, periode, platform,
  pencarian) sebagai Excel, PDF, Word, PowerPoint, Markdown, atau CSV.
- **▣ TV Mode**: tampilan layar penuh untuk TV/monitor kantor, bisa bergiliran antar brand. Link khusus TV, mis.
  `https://xandercreativeid-blip.github.io/xander-dashboard/?tv=1&rotate=30`
  (`rotate` = detik per layar; `brand=Nama Brand` untuk satu brand; `period=this|last|30|90|year`;
  `platform=tiktok|instagram|youtube`).

## Akses

Siapa pun bisa membuat akun di halaman login, tetapi hanya email yang ada di daftar **Anggota tim**
(menu Google Sheets & status) yang bisa melihat atau mengubah data.

## Catatan

- Rumus ER: (Likes + Komentar + Shares + Saves) ÷ Views.
- Periode selalu berdasarkan tanggal posting (zona waktu WIB).
- TikTok membulatkan angka besar di halaman publiknya (mis. 11,5 jt).
- Sebagian video TikTok dibatasi wilayah dan tidak bisa dibuka dari server di luar negara asalnya.

## Pengujian

```bash
node --test tests/core.test.mjs
```

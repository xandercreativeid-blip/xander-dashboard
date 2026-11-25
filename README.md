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

## Beberapa macrosheets dan blok KPI

- Di **Data Sources & Settings**, isi satu link macrosheets per baris. Semua macrosheets dibaca bergantian
  (5 tab tiap 2 menit). Tab dengan nama sama di beberapa macrosheets digabung menjadi satu brand.
- Blok KPI di atas tabel tiap tab (Contract, Quantity, Total Video/Goal, Month Start-End, PM, Scriptwriter,
  Master Drive, Notes, dan tabel Platform | FYP Quantity | KPI FYP) dibaca otomatis dan tampil di kartu
  **Contract & KPI** pada halaman brand. Bila blok itu belum ada, kartunya dikosongkan.
- **FYP Quantity** per platform menjadi target views konten; target default brand hanya dipakai bila tidak ada.
- **KPI FYP** dihitung per kontrak: jumlah konten yang diposting dalam periode kontrak (Month Start-End) dan
  mencapai FYP Quantity. Periode tanpa tahun (mis. "OCT-MAR") memakai tahun terdekat dan ditandai "year assumed".
- Pilihan periode **Contract Period** muncul untuk brand yang periode kontraknya terbaca.

## Macrosheets sebagai sumber utama

- **Connected Macrosheets** (sidebar) menampilkan macrosheets yang tersambung: nama file, status, kapan terakhir
  dibaca, jumlah tab, brand, dan link, serta daftar brand dari tiap macrosheets.
- Link yang dihapus dari macrosheets ikut hilang dari dashboard (kecuali masih ada di macrosheets lain). Pengaman:
  bila lebih dari separuh link satu tab hilang sekaligus, penghapusan ditunda.
- Tab yang diganti nama tetap brand yang sama (dikenali dari link-linknya).
- Isian manual (tombol ✎) dipakai sampai angka link itu berubah di macrosheets.
- Arsip manual berlaku sampai tab di-hide/unhide lagi di macrosheets.
- Link yang ditambahkan lewat dashboard (+ Add Links) tidak terhapus otomatis.

## Perbandingan periode

Untuk setiap periode (kecuali All Time dan Contract Period), angka dibandingkan dengan periode sebelumnya yang
panjangnya sama (▲ naik / ▼ turun). Periode yang masih berjalan (This Month, This Year) dibandingkan dengan jumlah
hari yang sama di periode sebelumnya. Catatan: views terus bertambah, jadi konten yang lebih lama wajar punya
views lebih besar.

## Brand diarsipkan

- Tab brand yang disembunyikan (hide) di macrosheets otomatis menjadi **Archived** di dashboard; tampilkan lagi tab-nya
  untuk mengaktifkan kembali.
- Brand yang diarsipkan ada di bagian **Archived** di bawah daftar brand, dan tidak dihitung di All Brands kecuali
  tombol **Include archived brands** dinyalakan.
- Tombol **Archive / Unarchive** dan pilihan **Status** di Brand Settings mengatur arsip secara manual
  (Follow Google Sheets / Always Active / Always Archived).

## Export dan TV Mode

- **⤓ Export** (kanan atas dan di atas daftar konten): unduh tampilan yang sedang aktif (brand, periode, platform,
  pencarian) sebagai Excel, PDF, Word, PowerPoint, Markdown, atau CSV.
- **▣ TV Mode**: tampilan layar penuh untuk TV/monitor kantor, bisa bergiliran antar brand. Link khusus TV, mis.
  `https://xandercreativeid-blip.github.io/xander-dashboard/?tv=1&rotate=30`
  (`rotate` = detik per layar; `brand=Nama Brand` untuk satu brand; `period=this|last|7|14|30|90|year`;
  `platform=tiktok|instagram|youtube`).

## Akses

Hanya email yang ada di daftar anggota tim (menu **Data Sources & Settings**, tanpa batas jumlah) yang bisa melihat
atau mengubah data. Akun login dibuat dari menu **Team Accounts**: pilih email → **Create account** → bagikan password
awalnya secara pribadi; anggota bisa menggantinya lewat **Change my password**. Cara ini tidak memakai email, jadi tidak
terkena batas pengiriman email Supabase.

## Catatan

- Rumus ER: (Likes + Komentar + Shares + Saves) ÷ Views.
- Periode selalu berdasarkan tanggal posting (zona waktu WIB).
- TikTok membulatkan angka besar di halaman publiknya (mis. 11,5 jt).
- Sebagian video TikTok dibatasi wilayah dan tidak bisa dibuka dari server di luar negara asalnya.

## Pengujian

```bash
node --test tests/core.test.mjs
```

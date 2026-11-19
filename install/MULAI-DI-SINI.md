# Paket Dashboard Xander Creative — Cara Memasang

Paket ini berisi seluruh dashboard (tampilan, database, pembaca macrosheets, pengambil angka TikTok/IG/YouTube).
Siapa pun yang menerimanya bisa memasang dashboard sendiri dan menjadi pemiliknya penuh.

## Yang perlu disiapkan (gratis)
1. Akun **GitHub** (github.com) — tempat dashboard ditayangkan.
2. Akun **Supabase** (supabase.com) — tempat data dan proses otomatis.
3. Akun **Claude** dengan Claude Code (claude.ai/code).

## Langkah
1. Di claude.ai → **Settings → Connectors**, hubungkan **GitHub** dan **Supabase**.
2. Buka **claude.ai/code**, mulai sesi baru, lalu unggah file zip ini.
3. Kirim pesan ini ke Claude:

   > Ekstrak paket dashboard ini dan ikuti petunjuk di CLAUDE.md untuk memasangnya di akun GitHub dan
   > Supabase saya. Email saya untuk login dashboard: (tulis email Anda).

4. Claude akan membuat project Supabase, database, jadwal otomatis, dan repo GitHub. Bila diminta, klik
   izinkan/approve, atau salin kunci yang diminta ke form yang muncul (jangan menempel password di chat).
5. Setelah selesai, buka alamat dashboard yang diberikan Claude → **Create Account** dengan email tadi →
   login → menu **Data Sources & Settings** → tempel link macrosheets → **Save & Sync Now**.

## Catatan
- Dashboard hasil pasangan ini **terpisah** dari dashboard asal: data dibaca ulang dari macrosheets
  (beberapa menit untuk semua brand). Angka live TikTok/YouTube terkumpul bertahap otomatis.
- Untuk mengedit dashboard yang **sama** (bukan salinan), pemilik asal cukup mengundang Anda sebagai
  collaborator di repo GitHub dan anggota di project Supabase-nya.

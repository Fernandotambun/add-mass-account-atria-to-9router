# Atria → 9Router Pipeline

Pipeline otomatis: ambil akun baru dari `akun.txt`, login ke Atria, buat API key,
lalu langsung push ke 9Router. API key **tidak pernah disimpan ke file**.

## Prasyarat

- Node.js 18+ (disarankan 20+)
- 9Router sudah berjalan di `http://localhost:20128`
- Node provider **Atria AI** (`openai-compatible-chat-...`) sudah dibuat di 9Router

## Instalasi

```bash
npm install
```

## Cara Pakai

1. Isi `akun.txt`, satu akun per baris dengan format `email|password`:

   ```
   email1@contoh.com|password1
   email2@contoh.com|password2
   ```

2. Jalankan:

   ```bash
   node atria2router
   ```

   Untuk tiap akun, script akan membuka browser, login Google, membuat key Atria
   bernama email tersebut, lalu push ke 9Router dengan default model
   `Atria-Dawn-Preview`. Akun yang sukses otomatis dihapus dari `akun.txt`.
   Tambahkan `--keep-akun` kalau tidak ingin akun dihapus:

   ```bash
   node atria2router.js --keep-akun
   ```

3. Kalau key sudah dibuat tapi gagal terkirim ke 9Router, akun dipindah keluar
   dari `akun.txt` (kecuali `--keep-akun`) dan key disimpan sementara di
   `pending_keys.txt` supaya tidak dibuat ulang. Kirim ulang tanpa login Atria
   lagi:

   ```bash
   node atria2router.js --push-pending
   ```

## Opsi

| Perintah | Fungsi |
| --- | --- |
| `node atria2router` | Proses semua akun baru |
| `node atria2router.js --keep-akun` | Proses tanpa menghapus akun dari `akun.txt` |
| `node atria2router.js --push-pending` | Push ulang isi `pending_keys.txt` |
| `node atria2router.js --model=NamaModel` | Ganti default model |
| `node atria2router.js --provider=<nodeId>` | Ganti node 9Router tujuan |

## File

| File | Keterangan |
| --- | --- |
| `akun.txt` | Input akun (`email\|password`) |
| `sukses.txt` | Akun yang berhasil di-push |
| `gagal.txt` | Akun/key yang gagal beserta alasannya |
| `pending_keys.txt` | Key yang gagal di-push, siap di-retry |

## Catatan

- Autentikasi ke 9Router memakai token CLI lokal, jadi tidak perlu password dashboard.
  Pastikan 9Router pernah dijalankan minimal sekali.
- Browser dijalankan secara **visible** (tidak headless) agar login Google lancar.
- Akun dengan 2FA/verifikasi tambahan Google akan gagal dan dicatat di `gagal.txt`.
- Key Atria hanya tampil sekali, karena itu kegagalan push otomatis disimpan ke
  `pending_keys.txt`.
- Saat push gagal, akun dihapus dari `akun.txt` (kecuali `--keep-akun`) dan akun
  yang masih menunggu kirim dilewati, sehingga tidak ada key Atria yang dibuat dua kali.

# ASProSSH

<p align="center">
  <img src="assets/asprossh-icon.png" alt="ASProSSH" width="128">
</p>

<p align="center">
  <strong>Desktop SSH workspace untuk koneksi remote, SFTP, monitoring server, PowerShell, CMD, dan WSL.</strong>
</p>

ASProSSH adalah aplikasi desktop berbasis Electron yang dirancang sebagai satu workspace untuk pekerjaan administrasi server. Satu aplikasi dapat menangani sesi SSH, terminal lokal Windows, distro WSL, browser file SFTP, remote editing, dan monitoring resource server tanpa harus berpindah-pindah tool.

> **Status project:** aktif dikembangkan. Versi source saat ini `0.6.0`. Packaging installer publik belum difinalkan, jadi rilis saat ini masih berorientasi source/development build.

---

## Fitur Utama

- Terminal SSH interaktif berbasis `ssh2` + xterm.js.
- Multi-session dan workspace tab.
- PowerShell 7, Windows PowerShell, Command Prompt, dan WSL.
- Deteksi distro WSL otomatis.
- SFTP file browser.
- Upload dan download file.
- Remote edit file menggunakan editor lokal.
- Import `~/.ssh/config`.
- Verifikasi host key melalui `known_hosts`.
- Password, private key, dan SSH Agent authentication.
- Jump host / bastion.
- Monitoring CPU, RAM, storage, network, dan proses Linux.
- Grouping server dengan drag-and-drop.
- Bahasa Indonesia dan English.
- Dark UI ASProSSH dengan identitas visual ASProBot.
- Session persistence dan kredensial terenkripsi menggunakan Electron `safeStorage`.

---

## Screenshot

Tampilan aplikasi terus berkembang. Screenshot terbaru sebaiknya ditempatkan di `docs/screenshots/` saat project memasuki tahap release candidate.

---

## Teknologi

| Bagian | Teknologi |
| --- | --- |
| Desktop runtime | Electron 37 |
| UI | React 19 + TypeScript |
| Bundler | Vite 7 |
| Styling | Tailwind CSS 4 + custom CSS |
| SSH / SFTP | `ssh2` |
| Terminal SSH | xterm.js |
| Terminal lokal | `node-pty` + Windows ConPTY |
| Grafik monitoring | uPlot |
| Penyimpanan session | JSON + Electron `safeStorage` |

---

## Platform

ASProSSH saat ini dikembangkan dan diuji terutama di **Windows 10/11 x64**.

Fitur terminal lokal bergantung pada tool Windows:

- PowerShell / PowerShell 7
- `cmd.exe`
- `wsl.exe`

Koneksi SSH/SFTP sendiri tidak bergantung pada WSL.

Monitoring server membaca `/proc`, sehingga fitur monitoring saat ini ditujukan untuk **server Linux**.

---

## Prasyarat Development

Sebelum menjalankan project dari source, siapkan:

1. **Windows 10 atau Windows 11 x64**
2. **Node.js 22 atau lebih baru**
3. **npm**
4. **Git** jika menggunakan clone repository
5. **Visual Studio / Visual Studio Build Tools** dengan workload C++
6. **MSVC x64/x86 Spectre-mitigated libraries**
7. WSL opsional jika ingin menggunakan terminal WSL

Cek versi Node dan npm:

```powershell
node --version
npm --version
```

Project saat ini dikembangkan dengan Node modern dan `package.json` menetapkan:

```text
Node >= 22
```

### Kenapa Visual Studio C++ dibutuhkan?

ASProSSH menggunakan `node-pty` untuk terminal lokal Windows. `node-pty` adalah native module dan perlu dibangun sesuai ABI Electron.

Pada Windows, pastikan Visual Studio Installer memiliki komponen berikut:

- Desktop development with C++
- MSVC toolset untuk arsitektur x64/x86
- Windows SDK
- Spectre-mitigated libraries untuk toolset tersebut

Jika komponen Spectre belum terpasang, proses rebuild dapat gagal dengan error `MSB8040`.

---

## Instalasi dari Source

### 1. Clone repository

```powershell
git clone <URL-REPOSITORY-ASProSSH>
cd asprossh
```

Jika source didapat dari ZIP, ekstrak terlebih dahulu lalu buka terminal pada folder project.

### 2. Install dependency

```powershell
npm install
```

Pada instalasi pertama, post-install akan memeriksa dan jika perlu membangun `node-pty` untuk versi Electron yang digunakan.

Contoh:

```text
[ASProSSH] Rebuild node-pty untuk Electron 37.4.0 (win32/x64)
[ASProSSH] node-pty rebuild selesai dan cache build disimpan.
```

Setelah build native pertama berhasil, instalasi berikutnya menggunakan smart cache dan biasanya akan menampilkan:

```text
[ASProSSH] node-pty sudah cocok untuk Electron 37.4.0 (win32/x64) — rebuild dilewati.
```

### 3. Verifikasi TypeScript

```powershell
npm run typecheck
```

### 4. Jalankan development mode

```powershell
npm run dev
```

Vite akan menjalankan renderer development server dan Electron akan terbuka otomatis.

---

## Perintah Project

| Perintah | Fungsi |
| --- | --- |
| `npm install` | Install seluruh dependency dan validasi native `node-pty` |
| `npm run dev` | Menjalankan ASProSSH dalam development mode |
| `npm run typecheck` | Type-check TypeScript tanpa build |
| `npm run build` | Build renderer, Electron main, dan preload ke `out/` |
| `npm run start` | Build lalu menjalankan hasil build dengan Electron |
| `npm run verify` | Alias untuk typecheck |
| `npm run check` | Typecheck lalu build |
| `npm run rebuild:native` | Rebuild `node-pty` jika signature berubah |
| `npm run rebuild:native:force` | Paksa rebuild `node-pty` |

---

## Struktur Project

```text
asprossh/
├── assets/
│   ├── asprossh-icon.png
│   └── asprossh-icon.ico
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   ├── ipc.ts
│   ├── local-terminal.ts
│   ├── ssh/
│   │   ├── connection-manager.ts
│   │   ├── known-hosts.ts
│   │   ├── monitor.ts
│   │   ├── remote-edit.ts
│   │   └── ssh-config.ts
│   └── store/
│       └── sessions.ts
├── scripts/
│   ├── dev.mjs
│   └── rebuild-native.mjs
├── src/
│   ├── assets/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   ├── shared/
│   ├── App.tsx
│   ├── i18n.tsx
│   ├── index.css
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vite.main.config.ts
└── vite.preload.config.ts
```

---

## Konfigurasi Server SSH

Server dapat ditambahkan dari **Server Explorer → Add Server**.

Data utama yang digunakan:

- Nama server
- Host / IP
- Port SSH
- Username
- Metode autentikasi
- Group
- Jump host jika diperlukan

Metode autentikasi:

### Password

Masukkan username dan password server.

Password tidak dikirim kembali ke renderer setelah disimpan. Secret hanya dibaca pada Electron main process saat koneksi dibuat.

### Private Key

Pilih path private key lokal, misalnya:

```text
C:\Users\username\.ssh\id_ed25519
```

Passphrase key dapat disimpan terenkripsi.

### SSH Agent

Gunakan SSH agent yang aktif di sistem.

---

## Import SSH Config

ASProSSH dapat membaca konfigurasi dari:

```text
~/.ssh/config
```

Gunakan tombol **Import SSH** pada aplikasi.

Import mendukung konfigurasi host umum dan `ProxyJump`/jump host yang dapat dipetakan ke session ASProSSH.

Konfigurasi kompleks seperti sebagian pola wildcard atau blok `Match` mungkin tidak seluruhnya dapat diterjemahkan ke session GUI.

---

## Terminal Lokal

Buka menu **Local** pada navigation rail.

ASProSSH mendeteksi:

- PowerShell 7 (`pwsh.exe`)
- Windows PowerShell (`powershell.exe`)
- Command Prompt (`cmd.exe`)
- distro WSL melalui `wsl.exe --list --quiet`

Terminal lokal menggunakan `node-pty` sehingga aplikasi interaktif, ANSI escape sequence, resize terminal, dan shortcut shell dapat bekerja seperti terminal native.

WSL tidak wajib digunakan untuk koneksi SSH.

---

## SFTP dan Remote File

Setelah server SSH terhubung, buka menu **SFTP**.

Fitur yang tersedia meliputi:

- browse directory
- home / up / refresh
- path langsung
- hidden files
- upload
- download
- remote edit
- follow terminal untuk prompt Linux umum

Remote editing mengunduh file ke file temporary lokal, memantau perubahan, lalu mengirim versi terbaru kembali ke server.

---

## Monitoring

Monitoring dapat dibuka setelah server Linux terhubung.

Metrik saat ini:

- CPU usage
- load average
- memory dan swap
- filesystem/storage
- network throughput
- top processes
- uptime

Monitoring menggunakan informasi dari `/proc`, sehingga tidak tersedia untuk remote Windows server pada implementasi saat ini.

---

## Bahasa

ASProSSH saat ini menyediakan:

- Bahasa Indonesia
- English

Bahasa dapat diganti dari:

```text
Settings → General → Application Language
```

Preferensi bahasa disimpan secara lokal dan tidak memerlukan restart aplikasi.

---

## Lokasi Data dan Keamanan

Session disimpan di Electron `userData` directory sebagai:

```text
sessions.json
```

Lokasi aktual mengikuti sistem operasi dan konfigurasi Electron.

Password dan passphrase **tidak disimpan sebagai plain text**. ASProSSH memakai Electron `safeStorage`, yang pada Windows memanfaatkan mekanisme proteksi kredensial sistem.

File session menyimpan konfigurasi koneksi dan secret dalam bentuk terenkripsi.

### Known Hosts

Verifikasi host key menggunakan file SSH:

```text
~/.ssh/known_hosts
```

Jika host belum dikenal atau key berubah, koneksi memerlukan keputusan pengguna terlebih dahulu.

Jangan menonaktifkan verifikasi host key hanya untuk menghilangkan warning koneksi.

---

## Native Module dan Rebuild

`node-pty` harus cocok dengan ABI Electron.

Project memiliki smart rebuild cache di:

```text
node_modules/.asprossh-native-build.json
```

Signature cache mencakup:

- Electron version
- node-pty version
- platform
- architecture

Rebuild paksa hanya diperlukan ketika ada masalah native module:

```powershell
npm run rebuild:native:force
```

Jangan menjalankan rebuild paksa pada setiap install jika tidak diperlukan.

---

## Build

Build source:

```powershell
npm run build
```

Hasil build ditempatkan di:

```text
out/
```

Untuk menjalankan hasil build:

```powershell
npm run start
```

### Installer / Release Binary

Pipeline installer `.exe`, code signing, auto-update, dan release channel **belum difinalkan pada versi 0.6.0**.

Sebelum ASProSSH dinyatakan siap untuk pengguna umum, release pipeline direncanakan mencakup:

1. packaging Windows x64
2. icon executable ASProSSH
3. installer
4. version metadata
5. release notes
6. code signing bila tersedia
7. update strategy
8. checksum artifact

Dengan pemisahan ini, `npm run build` tidak disalahartikan sebagai pembuatan installer final.

---

## Troubleshooting

### `MSB8040: Spectre-mitigated libraries are required`

Buka **Visual Studio Installer → Modify → Individual components**, lalu install Spectre-mitigated libraries yang sesuai dengan MSVC toolset dan arsitektur x64/x86.

Setelah itu:

```powershell
npm run rebuild:native:force
```

### `node-pty` tidak cocok dengan Electron

```powershell
npm run rebuild:native:force
```

### `tsc is not recognized`

Pastikan dependency development sudah terpasang:

```powershell
npm install
```

Lalu:

```powershell
npm run typecheck
```

### `Cannot find package 'vite'`

Dependency project belum terpasang lengkap. Jalankan:

```powershell
npm install
```

### WSL tidak muncul

Cek distro yang terpasang:

```powershell
wsl --list --quiet
```

Jika tidak ada distro, install/aktifkan WSL terlebih dahulu.

### Monitoring tidak tampil

Pastikan target adalah server Linux dan user SSH memiliki akses membaca informasi sistem standar di `/proc`.

---

## Kontribusi

Project masih dalam fase pengembangan aktif. Sebelum mengirim perubahan:

```powershell
npm install
npm run typecheck
npm run build
```

Beberapa aturan arsitektur yang perlu dipertahankan:

- Jangan membuka ulang SSH shell hanya karena React melakukan re-render.
- Satu terminal tab harus mempertahankan satu shell/PTY selama tab masih hidup.
- Berpindah workspace tidak boleh mematikan terminal lain.
- Secret tidak boleh diekspos ke renderer.
- Host key verification tidak boleh dilewati secara diam-diam.
- Hindari rebuild native pada setiap `npm install` jika signature tidak berubah.

Saat repository publik sudah ditetapkan, bagian ini dapat diperluas dengan workflow branch, pull request, linting, dan issue template.

---

## Roadmap Ringkas

Beberapa area yang direncanakan untuk pengembangan berikutnya:

- pengaturan terminal yang lebih lengkap
- appearance/theme settings
- SSH keepalive dan reconnect preferences
- monitoring threshold dan notification
- SFTP preferences
- security settings
- diagnostics/logging
- packaging installer Windows
- update mechanism
- release workflow

Roadmap dapat berubah mengikuti stabilitas fitur inti.

---

## Lisensi

Lisensi distribusi project **belum ditetapkan** pada versi ini.

Sebelum repository atau binary dirilis ke publik, tambahkan file `LICENSE` dan tentukan lisensi yang sesuai. Sampai lisensi tersebut ditetapkan, jangan mengasumsikan source ini otomatis berlisensi open-source.

---

## Catatan

ASProSSH bukan produk resmi OpenSSH, Microsoft, Electron, atau proyek `ssh2`.

Nama dan logo ASProSSH digunakan sebagai identitas aplikasi ini.

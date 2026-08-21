# ASProOps

[🇮🇩 Bahasa Indonesia](README.md) · [🇬🇧 English](README.en.md)

<p align="center">
  <img src="assets/asproops-icon.png" alt="ASProOps" width="128">
</p>

<p align="center">
  <strong>Developer & Server Operations Workspace — SSH, SFTP, deployment, dan monitoring server dalam satu aplikasi desktop.</strong>
</p>

ASProOps adalah aplikasi desktop berbasis Electron yang dirancang sebagai satu workspace untuk pekerjaan administrasi server dan operasi developer. Satu aplikasi menangani sesi SSH, terminal lokal Windows, distro WSL, browser file SFTP, remote editing, monitoring resource server, sampai alur DevOps lengkap — project profile, live log viewer, service manager, Docker, cron job, status Git, deploy template dengan riwayat/rollback, provisioning server, port forwarding, dan editor `.env` — tanpa harus berpindah-pindah tool.

> **Status project:** aktif dikembangkan. Versi source saat ini `1.2.0`. Installer Windows (`.exe`) sudah bisa dibuat lewat `npm run dist:win`, tapi belum ditandatangani (code signing) dan belum punya auto-update (unduh+pasang otomatis) — pengecekan versi terbaru sudah tersedia lewat **Settings → Tentang**, lihat [Installer / Release Binary](#installer--release-binary).

---

## Fitur Utama

**Koneksi & terminal**

- Terminal SSH interaktif berbasis `ssh2` + xterm.js, dengan copy/paste (Ctrl+Shift+C/V, klik kanan) dan multi-tab per server.
- Terminal lokal: PowerShell 7, Windows PowerShell, Command Prompt, dan WSL (deteksi distro otomatis).
- Password, private key, dan SSH Agent authentication; jump host / bastion.
- Import `~/.ssh/config`, verifikasi host key melalui `known_hosts`.
- Quick Connect (Ctrl+K) — cari dan connect ke server tersimpan tanpa menyentuh mouse.
- Grouping server dengan drag-and-drop, label warna per server (produksi/staging/dev/infrastruktur).

**SFTP & file**

- Browser file SFTP dengan kolom yang bisa di-resize, diurutkan ulang, dan disembunyikan.
- Upload, download, remote edit pakai editor lokal, follow-terminal untuk prompt Linux umum.
- Action bar (edit/download/rename/info/delete) di posisi tetap — tidak mendorong daftar file saat dipakai.

**Monitoring**

- CPU, RAM, storage, network throughput, top process, dan uptime server Linux (baca `/proc`).
- Ringkasan CPU/RAM/DISK/NET langsung di status bar bawah untuk server yang sedang aktif.

**DevOps workspace**

- **Project Profile** — tandai satu working directory di server (path, environment variables) sebagai basis fitur di bawah ini, dengan deteksi log Laravel/CodeIgniter 4 otomatis (`storage/logs/`, `writable/logs/`).
- **Live Log Viewer** — `tail -F` streaming dengan pewarnaan otomatis (level log, timestamp, IP), pengelompokan blok multi-baris (stack trace), filter baris, dan pencarian.
- **Editor `.env`** — sunting variabel `.env` sungguhan di root project langsung dari UI (terpisah dari environment variables ASProOps sendiri), dengan value ter-mask secara default.
- **Service Manager** — daftar unit systemd, start/stop/restart dengan konfirmasi untuk aksi yang mengganggu.
- **Docker Manager** — daftar container (`docker ps -a`), start/stop/restart, dan live log viewer per container.
- **Cron Job Manager** — baca/tulis crontab milik user SSH yang login: tambah/ubah/hapus/nonaktifkan job, dengan parser yang tahan terhadap komentar dokumentasi bawaan `/etc/crontab`.
- **Server Provisioning** — jalankan template setup server (install Docker, Node.js/NVM, PHP+Composer, MySQL, Nginx, update sistem) satu klik di server manapun, dengan output live.
- **Port Forwarding** — local (`-L`) dan remote (`-R`) SSH tunnel, kelola beberapa aturan tersimpan per server dengan status tunnel real-time.
- **Git Panel** — status branch, ahead/behind, file berubah, commit terakhir, fetch/pull langsung dari path project.
- **Deploy Template, riwayat, & rollback** — rangkaian langkah deploy yang bisa dipasangkan ke banyak server; enam template bawaan (CodeIgniter 4, Laravel, Vue, NestJS, plus template Provisioning PHP/MySQL/Nginx/Docker/Node.js) tersedia langsung. Eksekusi berhenti otomatis begitu satu langkah gagal, dengan output live dan tombol batal. Setiap run tercatat di riwayat per project (commit git, sukses/gagal), dan bisa di-**rollback** ke commit sebelumnya satu klik.

**Keamanan & preferensi**

- **Log Login SSH server** — lihat riwayat login sungguhan yang dicatat sshd (`journalctl`/`auth.log`), mencakup semua klien (bukan cuma dari ASProOps). Mode live atau lihat tanggal lain (hari ini/kemarin/7 hari/tanggal manual), dengan eskalasi akses otomatis (langsung → `sudo -n` → prompt password sudo kalau perlu).
- Kunci aplikasi (PIN) opsional, dengan kunci otomatis setelah sekian menit tanpa aktivitas (bisa dimatikan), plus tombol kunci manual di header.
- Session persistence dan kredensial terenkripsi menggunakan Electron `safeStorage`.
- Preferensi SSH (timeout, keepalive, auto-reconnect), Terminal (font, scrollback, cursor), dan SFTP (folder unduhan, kebijakan konflik) bisa diatur di Settings.
- **Cek Update** — Settings → Tentang menampilkan versi aplikasi yang sedang berjalan dan bisa mengecek rilis terbaru di GitHub Releases, dengan link langsung ke halaman unduhan kalau ada versi baru.
- Sidebar kiri bisa disembunyikan/ditampilkan untuk memperluas area kerja.
- Bahasa Indonesia dan English (default: English).

<!-- ---

## Screenshot

Tampilan aplikasi terus berkembang. Screenshot terbaru sebaiknya ditempatkan di `docs/screenshots/` saat project memasuki tahap release candidate. -->

---

## Teknologi

| Bagian | Teknologi |
| --- | --- |
| Desktop runtime | Electron 37 |
| UI | React 19 + TypeScript |
| Bundler | Vite 7 |
| Styling | Tailwind CSS 4 + custom CSS |
| SSH / SFTP | `ssh2` |
| Terminal SSH & log viewer | xterm.js |
| Terminal lokal | `node-pty` + Windows ConPTY |
| Grafik monitoring | uPlot |
| Penyimpanan session & data | JSON + Electron `safeStorage` |

---

## Platform

ASProOps saat ini dikembangkan dan diuji terutama di **Windows 10/11 x64**.

Fitur terminal lokal bergantung pada tool Windows:

- PowerShell / PowerShell 7
- `cmd.exe`
- `wsl.exe`

Koneksi SSH/SFTP sendiri tidak bergantung pada WSL.

Monitoring, Log Viewer, Service Manager, Docker Manager, Cron Job Manager, Provisioning, Git Panel, dan Deploy membaca/menjalankan perintah lewat SSH di server target, sehingga ditujukan untuk **server Linux**. Docker Manager butuh Docker terpasang di server target, dan template Provisioning bawaan mengasumsikan distro berbasis Debian/Ubuntu (`apt-get`) — bisa diedit bebas untuk distro lain.

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

ASProOps menggunakan `node-pty` untuk terminal lokal Windows. `node-pty` adalah native module dan perlu dibangun sesuai ABI Electron.

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
git clone <URL-REPOSITORY-ASProOps>
cd asproops
```

Jika source didapat dari ZIP, ekstrak terlebih dahulu lalu buka terminal pada folder project.

### 2. Install dependency

```powershell
npm install
```

Pada instalasi pertama, post-install akan memeriksa dan jika perlu membangun `node-pty` untuk versi Electron yang digunakan.

Contoh:

```text
[ASProOps] Rebuild node-pty untuk Electron 37.4.0 (win32/x64)
[ASProOps] node-pty rebuild selesai dan cache build disimpan.
```

Setelah build native pertama berhasil, instalasi berikutnya menggunakan smart cache dan biasanya akan menampilkan:

```text
[ASProOps] node-pty sudah cocok untuk Electron 37.4.0 (win32/x64) — rebuild dilewati.
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
| `npm run dev` | Menjalankan ASProOps dalam development mode |
| `npm run typecheck` | Type-check TypeScript tanpa build |
| `npm run build` | Build renderer, Electron main, dan preload ke `out/` |
| `npm run start` | Build lalu menjalankan hasil build dengan Electron |
| `npm run verify` | Alias untuk typecheck |
| `npm run check` | Typecheck lalu build |
| `npm run rebuild:native` | Rebuild `node-pty` jika signature berubah |
| `npm run rebuild:native:force` | Paksa rebuild `node-pty` |
| `npm run dist:win` | Build lalu package installer Windows (`.exe`) ke `release/` |

---

## Struktur Project

```text
asproops/
├── assets/
│   ├── asproops-icon.png
│   └── asproops.ico
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   ├── ipc.ts
│   ├── app-lock.ts
│   ├── local-terminal.ts
│   ├── update-check.ts
│   ├── ssh/
│   │   ├── connection-manager.ts
│   │   ├── known-hosts.ts
│   │   ├── monitor.ts
│   │   ├── remote-edit.ts
│   │   ├── ssh-config.ts
│   │   ├── services.ts
│   │   ├── docker.ts
│   │   ├── cron.ts
│   │   ├── port-forward.ts
│   │   ├── git.ts
│   │   ├── deploy.ts
│   │   ├── env-file.ts
│   │   ├── auth-log.ts
│   │   └── framework-detect.ts
│   └── store/
│       ├── sessions.ts
│       ├── preferences.ts
│       ├── projects.ts
│       ├── deploy-history.ts
│       ├── provision-templates.ts
│       └── port-forwards.ts
├── scripts/
│   ├── dev.mjs
│   └── rebuild-native.mjs
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── SessionSidebar.tsx, SessionForm.tsx
│   │   ├── TerminalView.tsx, LocalTerminalView.tsx, TerminalTabs.tsx
│   │   ├── FileBrowser.tsx
│   │   ├── MonitorPanel.tsx
│   │   ├── ProjectsPanel.tsx, EnvFileEditor.tsx, LogView.tsx, ServicesPanel.tsx
│   │   ├── DockerPanel.tsx, CronPanel.tsx, ProvisionPanel.tsx, ProvisionView.tsx
│   │   ├── PortForwardPanel.tsx, GitPanel.tsx, DeployView.tsx, DeployHistoryModal.tsx
│   │   ├── QuickConnectPalette.tsx, ContextMenu.tsx
│   │   ├── AppLockGate.tsx, SettingsDialog.tsx
│   │   └── ...
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
- Warna label (opsional — mis. merah untuk produksi, kuning staging, hijau development, biru infrastruktur)
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

ASProOps dapat membaca konfigurasi dari:

```text
~/.ssh/config
```

Gunakan tombol **Import SSH** pada aplikasi.

Import mendukung konfigurasi host umum dan `ProxyJump`/jump host yang dapat dipetakan ke session ASProOps.

Konfigurasi kompleks seperti sebagian pola wildcard atau blok `Match` mungkin tidak seluruhnya dapat diterjemahkan ke session GUI.

---

## Quick Connect

Tekan **Ctrl+K** dari mana saja di aplikasi, atau klik kotak "Quick Connect" di header, untuk membuka command palette pencarian server. Ketik nama/host/username/group, navigasi dengan panah atas-bawah, Enter untuk langsung connect.

---

## Terminal Lokal

Buka menu **Local** pada navigation rail.

ASProOps mendeteksi:

- PowerShell 7 (`pwsh.exe`)
- Windows PowerShell (`powershell.exe`)
- Command Prompt (`cmd.exe`)
- distro WSL melalui `wsl.exe --list --quiet`

Terminal lokal menggunakan `node-pty` sehingga aplikasi interaktif, ANSI escape sequence, resize terminal, dan shortcut shell dapat bekerja seperti terminal native.

WSL tidak wajib digunakan untuk koneksi SSH.

**Shortcut terminal:**

- `Ctrl+Shift+T` — tab terminal baru (bekerja baik saat terminal sedang fokus maupun saat panel lain sedang aktif, selama tab SSH masih menjadi workspace aktif).
- `Ctrl+Shift+C` / `Ctrl+Shift+V` — salin/tempel seleksi.
- Klik kanan — menu Copy/Paste.

---

## SFTP dan Remote File

Setelah server SSH terhubung, buka menu **SFTP**.

Fitur yang tersedia meliputi:

- browse directory, home / up / refresh, path langsung, hidden files
- upload, download, remote edit
- follow terminal untuk prompt Linux umum
- kolom yang bisa di-resize, diurutkan ulang, dan disembunyikan
- klik kanan untuk menu aksi cepat (edit/download/rename/info/delete)

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

Monitoring menggunakan informasi dari `/proc`, sehingga tidak tersedia untuk remote Windows server pada implementasi saat ini. Setelah panel Monitoring pernah dibuka untuk sebuah server, ringkasan CPU/RAM/DISK/NET-nya juga tampil di status bar bawah selama server itu aktif.

---

## Log Login SSH Server

Tab **Log Login** (ikon ⚿) menampilkan log otentikasi sshd milik server itu sendiri — beda dari riwayat koneksi ASProOps, ini catatan login dari **klien mana pun** (PuTTY, WinSCP, ASProOps di PC lain, dst), sumbernya `journalctl -u ssh -u sshd` (distro systemd) atau `/var/log/auth.log` / `/var/log/secure` sebagai fallback.

Akses dicoba berurutan: langsung, lalu `sudo -n` (kalau NOPASSWD sudah dikonfigurasi), baru minta password sudo lewat form kalau memang perlu — password itu hanya mengalir lewat stdin channel SSH terenkripsi, tidak pernah lewat argumen command maupun disimpan ke disk, cuma dicache di memori selama koneksi SSH itu hidup.

Dua tampilan:

- **Ringkas** — kartu per event, login berhasil digabung dari beberapa baris raw (dikorelasikan lewat PID), percobaan gagal dikelompokkan per IP sumber (supaya scan bot tidak membanjiri daftar).
- **Mentah** — log viewer biasa (search/filter/copy) untuk lihat baris asli.

Bisa juga lihat histori tanggal lain (Hari ini/Kemarin/7 hari/pilih tanggal), lewat query sekali-jalan yang terpisah dari stream live.

---

## DevOps: Project, Log Viewer, Docker, Cron, Provisioning, Git, dan Deploy

Panel-panel ini dibangun sebagai satu alur kerja DevOps di dalam aplikasi, semuanya berjalan lewat koneksi SSH yang sama tanpa channel/kredensial tambahan:

### Project Profile

Panel **Projects** menandai satu working directory di server (path absolut + environment variables) sebagai basis fitur-fitur berikutnya. Satu project bisa dipasangkan ke satu Deploy Template, dan menyimpan daftar log path serta nama service systemd yang relevan.

Tombol **Deteksi otomatis** di form project mencari log Laravel (`storage/logs/`) dan CodeIgniter 4 (`writable/logs/`) — file apa pun yang dimodifikasi dalam 30 hari terakhir, tanpa terpaku pada pola nama tertentu (mendukung nama log custom), lalu menambahkannya ke daftar log project.

### Editor `.env`

Tombol **.env** pada tiap project membuka editor key-value untuk berkas `.env` sungguhan di root project (dibaca langsung oleh Laravel/CodeIgniter 4 saat runtime) — beda dari environment variables di form project yang cuma dipakai ASProOps sendiri saat menjalankan deploy. Semua value ter-mask secara default (toggle untuk menampilkan), dan baris komentar/kosong di `.env` asli tetap dipertahankan persis saat disimpan ulang.

### Live Log Viewer

Buka lewat chip log di panel Projects. Menjalankan `tail -F` dan menampilkannya secara live di tab workspace terpisah, dengan:

- pewarnaan otomatis (ERROR/WARN/INFO/DEBUG, timestamp, alamat IP)
- pengelompokan blok multi-baris — stack trace dan `Caused by:` tetap terlihat sebagai satu blok sampai entri baru benar-benar muncul
- filter baris dan pencarian (search-as-you-type)
- salin seluruh isi atau hasil filter

### Service Manager

Panel **Services** menampilkan unit systemd di server yang sedang aktif, dengan pencarian, toggle tampilkan-semua, dan aksi start/stop/restart. Menghentikan service meminta konfirmasi terlebih dahulu.

### Docker Manager

Panel **Docker** menampilkan container (`docker ps -a`) di server yang sedang aktif — nama, image, status — dengan start/stop/restart dan tombol **Lihat log** yang membuka tab live log streaming per container (search/filter/pewarnaan sama seperti Live Log Viewer). Aksi container mencoba akses langsung lebih dulu, lalu fallback `sudo -n` kalau user belum di grup `docker`.

### Cron Job Manager

Panel **Cron** membaca/menulis crontab milik user SSH yang sedang login (`crontab -l`/`crontab -`, bukan `-u` user lain). Tambah, ubah, hapus, atau nonaktifkan (comment-out) job langsung dari UI. Parser jadwalnya divalidasi per-karakter supaya paragraf komentar dokumentasi bawaan `/etc/crontab` (mis. template default Debian/Ubuntu) tidak salah terbaca sebagai job.

### Server Provisioning

Panel **Provisioning** menjalankan template setup server (rangkaian langkah shell, sama strukturnya dengan Deploy Template) langsung di session aktif — tidak terikat ke Project/path manapun. Template bawaan: **Update & Tools Dasar**, **Install Docker**, **Install Node.js (NVM)**, **Install PHP (+ Composer)**, **Install MySQL**, **Install Nginx**. Sengaja tidak ada template bawaan yang mengubah SSH/firewall/akun (disable password auth, `ufw enable`, dst.) karena itu jenis perubahan yang bisa mengunci akses ke server sendiri kalau salah — bisa ditambahkan sendiri lewat editor step kalau diperlukan.

### Port Forwarding

Panel **Port Forward** mengelola SSH tunnel **local** (`-L`, port di komputer Anda diteruskan ke host/port yang dilihat dari server — mis. akses database yang cuma listen di `127.0.0.1` server) dan **remote** (`-R`, server membuka port yang meneruskan balik ke komputer Anda). Aturan tersimpan per server, status tunnel (aktif/error/berhenti) ditampilkan real-time, dan tunnel otomatis berhenti saat server disconnect atau aplikasi ditutup.

### Git Panel

Panel **Git** membaca status repo (branch, upstream, ahead/behind, commit terakhir, file yang berubah) dari path sebuah project, dan menyediakan fetch/pull. Push sengaja tidak disediakan dari UI — butuh kredensial tulis yang risikonya lebih besar untuk dipicu satu klik.

### Deploy Template, Riwayat, & Rollback

Deploy Template adalah rangkaian langkah shell yang bisa dipasangkan ke banyak project/server (dikelola di **Settings → Deploy Template**). Empat template bawaan tersedia langsung: **CodeIgniter 4**, **Laravel**, **Vue**, dan **NestJS** — masing-masing bisa diedit bebas.

Menjalankan deploy (chip "Deploy" di panel Projects, perlu konfirmasi) mengeksekusi tiap langkah berurutan di path project, dengan environment variables project di-export lebih dulu. Output di-stream live ke tab workspace, dan proses **berhenti otomatis begitu satu langkah gagal** (exit code bukan 0) — sama seperti pipeline CI biasa.

Setiap run (deploy maupun rollback) tercatat di **riwayat** per project — chip "Riwayat" di panel Projects — lengkap dengan commit git yang aktif setelah run (kalau path-nya git repo), status sukses/gagal, dan pesan error. Dari satu entri riwayat yang sukses, tombol **Rollback** melakukan `git checkout` ke commit itu lalu menjalankan ulang langkah template yang sama (kecuali langkah `git pull`/`fetch`, supaya tidak langsung tertarik lagi ke commit terbaru).

---

## Kunci Aplikasi (PIN)

Fitur opsional di **Settings → Kunci Aplikasi**. Setelah diaktifkan, aplikasi meminta PIN setiap kali dibuka sebelum daftar server dan kredensial tersimpan bisa diakses.

**Kunci otomatis**: aplikasi juga bisa dikonfigurasi untuk meminta PIN lagi setelah sekian menit tanpa aktivitas mouse/keyboard (default 10 menit, bisa diubah atau dimatikan dengan mengisi 0). Ada juga tombol kunci manual (🔒) di header, untuk mengunci langsung tanpa menunggu idle timeout.

Mengunci aplikasi (otomatis maupun manual) **tidak menutup sesi yang sedang berjalan** — semua terminal SSH, terminal lokal, dan koneksi tetap hidup di belakang layar kunci; hanya interaksinya yang diblokir sampai PIN dimasukkan lagi.

PIN di-hash dengan `scrypt` dan disimpan lokal — ini bukan pengganti enkripsi `safeStorage` yang melindungi isi berkas session di disk, melainkan penghalang tambahan di lapisan UI.

---

## Bahasa

ASProOps saat ini menyediakan:

- English (default)
- Bahasa Indonesia

Bahasa dapat diganti dari:

```text
Settings → General → Application Language
```

Preferensi bahasa disimpan secara lokal dan tidak memerlukan restart aplikasi.

---

## Lokasi Data dan Keamanan

Session, project, preferensi, dan kunci aplikasi disimpan di Electron `userData` directory sebagai berkas JSON terpisah (`sessions.json`, `projects.json`, `preferences.json`, `applock.json`, dst).

Lokasi aktual mengikuti sistem operasi dan konfigurasi Electron.

Password dan passphrase **tidak disimpan sebagai plain text**. ASProOps memakai Electron `safeStorage`, yang pada Windows memanfaatkan mekanisme proteksi kredensial sistem.

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
node_modules/.asproops-native-build.json
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

ASProOps di-package menjadi installer Windows (`.exe`, NSIS) memakai [electron-builder](https://www.electron.build/):

```powershell
npm run dist:win
```

Perintah ini menjalankan `npm run build` lalu membungkusnya jadi installer. Hasilnya ditempatkan di:

```text
release/
  ASProOps Setup <versi>.exe   ← installer yang dibagikan ke pengguna
  win-unpacked/                ← build tanpa installer, untuk uji cepat (jalankan ASProOps.exe langsung)
```

Installer bersifat non-oneClick (pengguna bisa memilih lokasi instalasi) dan otomatis membuat shortcut Desktop serta Start Menu. Konfigurasi packaging ada di field `"build"` pada `package.json` — icon executable memakai `assets/asproops.ico`, dan native module (`node-pty`, `ssh2`, `cpu-features`) di-unpack dari asar karena binding native tidak bisa dimuat langsung dari dalam arsip `.asar`.

`npmRebuild` sengaja dimatikan (`false`): electron-builder secara default mencoba rebuild ulang native module dari source sebelum packaging, padahal binary prebuilt yang sudah ada di `node_modules` (lihat [Native Module dan Rebuild](#native-module-dan-rebuild)) sudah cocok dengan versi Electron yang dipakai — rebuild ulang di sini hanya menambah waktu build dan risiko gagal di lingkungan yang belum siap toolchain native (Visual Studio Build Tools, dsb).

Yang **belum difinalkan**:

- code signing (installer saat ini tidak ditandatangani — Windows SmartScreen kemungkinan akan memperingatkan saat instalasi)
- auto-update sungguhan (unduh + pasang otomatis) — yang sudah ada baru **pengecekan versi terbaru** lewat GitHub Releases (Settings → Tentang), pengguna tetap unduh & pasang installer baru secara manual
- release channel / checksum artifact publik
- build untuk arch selain x64 (arm64 Windows, serta macOS/Linux — belum diuji meski `node-pty` menyediakan prebuild untuk platform tersebut)

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

### Service Manager / Git Panel / Deploy tidak menampilkan apa pun

Ketiganya menjalankan perintah lewat SSH (`systemctl`, `git`, shell biasa) — pastikan binary yang relevan (`systemctl`, `git`) terpasang di server target, dan user SSH punya izin yang cukup. Aksi start/stop/restart service dan `git pull` butuh privilese yang sesuai di server (root atau sudo tanpa password untuk `systemctl`).

### Docker Manager kosong / gagal dimuat

Pastikan Docker terpasang di server target dan user SSH punya akses ke `docker.sock` (anggota grup `docker`, atau sudo tanpa password untuk `docker`) — pesan errornya menjelaskan penyebab spesifiknya.

### Cron menampilkan job yang tidak dikenal

Kemungkinan crontab server itu masih memakai template komentar default (`/etc/crontab` Debian/Ubuntu) yang berisi contoh jadwal cron di dalam blok dokumentasi — satu baris contoh (`0 5 * * 1 tar -zcf ...`) kebetulan berformat sama seperti jadwal cron asli sehingga ambigu untuk dibedakan otomatis. Entri semacam ini muncul berstatus nonaktif (titik abu-abu) dan aman dihapus manual kalau mengganggu.

### Deteksi log otomatis tidak menemukan apa pun

Pastikan path project menunjuk ke root aplikasi (yang berisi `storage/`atau `writable/`, bukan `public/`), dan server memang sudah pernah menulis log dalam 30 hari terakhir — aplikasi yang sehat tanpa error tercatat memang belum punya berkas log untuk dideteksi.

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
- Berpindah workspace tidak boleh mematikan terminal, log viewer, atau proses deploy lain yang sedang berjalan.
- Secret tidak boleh diekspos ke renderer.
- Host key verification tidak boleh dilewati secara diam-diam.
- Aksi yang mengganggu (stop service, jalankan deploy) harus lewat konfirmasi eksplisit, bukan satu klik langsung.
- Hindari rebuild native pada setiap `npm install` jika signature tidak berubah.

Saat repository publik sudah ditetapkan, bagian ini dapat diperluas dengan workflow branch, pull request, linting, dan issue template.

---

## Roadmap Ringkas

Beberapa area yang direncanakan untuk pengembangan berikutnya:

- code signing dan auto-update (unduh+pasang otomatis) untuk installer Windows — pengecekan versi manual sudah ada (Settings → Tentang), packaging dasarnya juga sudah ada, lihat [Installer / Release Binary](#installer--release-binary)
- module icon (Terminal/Monitoring) dari asset pack untuk ikon rail/tab, saat ini baru dipakai di identitas aplikasi utama
- push dari Git Panel (saat ini sengaja dibatasi ke fetch/pull)
- multi-server broadcast command (jalankan command yang sama ke beberapa server sekaligus)
- notification/threshold untuk monitoring
- diagnostics/logging aplikasi
- release workflow

Roadmap dapat berubah mengikuti stabilitas fitur inti.

---

## Lisensi

ASProOps dirilis di bawah lisensi [Apache License 2.0](LICENSE).

---

## Catatan

ASProOps bukan produk resmi OpenSSH, Microsoft, Electron, atau proyek `ssh2`.

Nama dan logo ASProOps digunakan sebagai identitas aplikasi ini.

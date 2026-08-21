# ASProOps

[🇮🇩 Bahasa Indonesia](README.md) · [🇬🇧 English](README.en.md)

<p align="center">
  <img src="assets/asproops-icon.png" alt="ASProOps" width="128">
</p>

<p align="center">
  <strong>Developer & Server Operations Workspace — SSH, SFTP, deployment, and server monitoring in one desktop app.</strong>
</p>

ASProOps is an Electron-based desktop application designed as a single workspace for server administration and developer operations. One app handles SSH sessions, local Windows terminals, WSL distros, an SFTP file browser, remote editing, server resource monitoring, and a full DevOps flow — project profiles, live log viewer, service manager, Docker, cron jobs, Git status, deploy templates with history/rollback, server provisioning, port forwarding, and a `.env` editor — without switching between tools.

> **Project status:** actively developed. Current source version `1.2.0`. A Windows installer (`.exe`) can already be built via `npm run dist:win`, but it isn't code-signed yet and has no auto-update (automatic download+install) — checking for the latest version is available under **Settings → About**, see [Installer / Release Binary](#installer--release-binary).

---

## Key Features

**Connections & terminal**

- Interactive SSH terminal built on `ssh2` + xterm.js, with copy/paste (Ctrl+Shift+C/V, right-click) and multiple tabs per server.
- Local terminals: PowerShell 7, Windows PowerShell, Command Prompt, and WSL (automatic distro detection).
- Password, private key, and SSH Agent authentication; jump host / bastion support.
- Import `~/.ssh/config`, host key verification via `known_hosts`.
- Quick Connect (Ctrl+K) — search and connect to a saved server without touching the mouse.
- Drag-and-drop server grouping, per-server color labels (production/staging/dev/infrastructure).

**SFTP & files**

- SFTP file browser with resizable, reorderable, and hideable columns.
- Upload, download, remote edit with your local editor, follow-terminal for common Linux prompts.
- A fixed-position action bar (edit/download/rename/info/delete) that never shifts the file list while you use it.

**Monitoring**

- CPU, RAM, storage, network throughput, top processes, and uptime for Linux servers (reads `/proc`).
- A live CPU/RAM/DISK/NET summary right in the bottom status bar for the currently active server.

**DevOps workspace**

- **Project Profile** — mark one working directory on a server (path, environment variables) as the foundation for the features below, with automatic Laravel/CodeIgniter 4 log detection (`storage/logs/`, `writable/logs/`).
- **Live Log Viewer** — `tail -F` streaming with automatic coloring (log level, timestamp, IP address), multi-line block grouping (stack traces), line filtering, and search.
- **`.env` editor** — edit a project's real `.env` file directly from the UI (separate from ASProOps's own environment variables), with values masked by default.
- **Service Manager** — list systemd units, start/stop/restart with confirmation for disruptive actions.
- **Docker Manager** — list containers (`docker ps -a`), start/stop/restart, and a live per-container log viewer.
- **Cron Job Manager** — read/write the crontab belonging to the logged-in SSH user: add/edit/delete/disable jobs, with a parser resilient to the default documentation comments shipped in `/etc/crontab`.
- **Server Provisioning** — run one-click server setup templates (install Docker, Node.js/NVM, PHP+Composer, MySQL, Nginx, system updates) on any server, with live output.
- **Port Forwarding** — local (`-L`) and remote (`-R`) SSH tunnels, manage several saved rules per server with real-time tunnel status.
- **Git Panel** — branch status, ahead/behind, changed files, last commit, fetch/pull directly from a project's path.
- **Deploy Template, history, & rollback** — a sequence of deploy steps that can be attached to many servers; six built-in templates (CodeIgniter 4, Laravel, Vue, NestJS, plus PHP/MySQL/Nginx/Docker/Node.js provisioning templates) are available out of the box. Execution stops automatically the moment a step fails, with live output and a cancel button. Every run is recorded per project (git commit, success/failure), and can be **rolled back** to a previous commit in one click.

**Security & preferences**

- **Server SSH login log** — see the real login history recorded by sshd itself (`journalctl`/`auth.log`), covering every client (not just ASProOps). Live mode or browse other dates (today/yesterday/7 days/pick a date), with automatic access escalation (direct → `sudo -n` → sudo password prompt if needed).
- Optional application lock (PIN), with automatic re-lock after a configurable period of inactivity (can be turned off), plus a manual lock button in the header.
- Session persistence and encrypted credentials via Electron `safeStorage`.
- SSH preferences (timeout, keepalive, auto-reconnect), Terminal (font, scrollback, cursor), and SFTP (download folder, conflict policy) are all configurable in Settings.
- **Update check** — Settings → About shows the running app version and can check GitHub Releases for a newer one, with a direct link to the download page if there is one.
- The left sidebar can be collapsed/shown to reclaim workspace width.
- Indonesian and English (default: English).

<!-- ---

## Screenshots

The UI is still evolving. Latest screenshots should live under `docs/screenshots/` once the project reaches release-candidate stage. -->

---

## Technology

| Part | Technology |
| --- | --- |
| Desktop runtime | Electron 37 |
| UI | React 19 + TypeScript |
| Bundler | Vite 7 |
| Styling | Tailwind CSS 4 + custom CSS |
| SSH / SFTP | `ssh2` |
| SSH terminal & log viewer | xterm.js |
| Local terminal | `node-pty` + Windows ConPTY |
| Monitoring charts | uPlot |
| Session & data storage | JSON + Electron `safeStorage` |

---

## Platform

ASProOps is currently developed and tested primarily on **Windows 10/11 x64**.

Local terminal features depend on Windows tools:

- PowerShell / PowerShell 7
- `cmd.exe`
- `wsl.exe`

The SSH/SFTP connection itself doesn't depend on WSL.

Monitoring, Log Viewer, Service Manager, Docker Manager, Cron Job Manager, Provisioning, Git Panel, and Deploy read/run commands over SSH on the target server, so they're aimed at **Linux servers**. Docker Manager needs Docker installed on the target server, and the built-in Provisioning templates assume a Debian/Ubuntu-based distro (`apt-get`) — they're freely editable for other distros.

---

## Development Prerequisites

Before running the project from source, prepare:

1. **Windows 10 or Windows 11 x64**
2. **Node.js 22 or newer**
3. **npm**
4. **Git**, if cloning the repository
5. **Visual Studio / Visual Studio Build Tools** with the C++ workload
6. **MSVC x64/x86 Spectre-mitigated libraries**
7. WSL is optional, only needed for the WSL terminal

Check Node and npm versions:

```powershell
node --version
npm --version
```

The project is developed against a modern Node version, and `package.json` requires:

```text
Node >= 22
```

### Why is Visual Studio C++ needed?

ASProOps uses `node-pty` for local Windows terminals. `node-pty` is a native module and needs to be built against Electron's ABI.

On Windows, make sure the Visual Studio Installer has these components:

- Desktop development with C++
- MSVC toolset for x64/x86 architectures
- Windows SDK
- Spectre-mitigated libraries for that toolset

If the Spectre components aren't installed, the rebuild step can fail with an `MSB8040` error.

---

## Installing from Source

### 1. Clone the repository

```powershell
git clone <ASProOps-REPOSITORY-URL>
cd asproops
```

If you got the source as a ZIP, extract it first, then open a terminal in the project folder.

### 2. Install dependencies

```powershell
npm install
```

On the first install, a post-install step checks and, if needed, builds `node-pty` for the Electron version in use.

Example:

```text
[ASProOps] Rebuild node-pty untuk Electron 37.4.0 (win32/x64)
[ASProOps] node-pty rebuild selesai dan cache build disimpan.
```

After the first native build succeeds, subsequent installs use a smart cache and typically show:

```text
[ASProOps] node-pty sudah cocok untuk Electron 37.4.0 (win32/x64) — rebuild dilewati.
```

### 3. Verify TypeScript

```powershell
npm run typecheck
```

### 4. Run development mode

```powershell
npm run dev
```

Vite starts the renderer dev server and Electron opens automatically.

---

## Project Commands

| Command | What it does |
| --- | --- |
| `npm install` | Installs all dependencies and validates the native `node-pty` build |
| `npm run dev` | Runs ASProOps in development mode |
| `npm run typecheck` | Type-checks TypeScript without building |
| `npm run build` | Builds the renderer, Electron main, and preload into `out/` |
| `npm run start` | Builds, then runs the build output with Electron |
| `npm run verify` | Alias for typecheck |
| `npm run check` | Typecheck, then build |
| `npm run rebuild:native` | Rebuilds `node-pty` if the signature changed |
| `npm run rebuild:native:force` | Forces a `node-pty` rebuild |
| `npm run dist:win` | Builds, then packages a Windows installer (`.exe`) into `release/` |

---

## Project Structure

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

## SSH Server Configuration

Servers can be added from **Server Explorer → Add Server**.

Main fields used:

- Server name
- Host / IP
- SSH port
- Username
- Authentication method
- Group
- Label color (optional — e.g. red for production, yellow for staging, green for development, blue for infrastructure)
- Jump host, if needed

Authentication methods:

### Password

Enter the server's username and password.

The password is never sent back to the renderer after being saved. The secret is only read in the Electron main process when a connection is made.

### Private Key

Choose a local private key path, e.g.:

```text
C:\Users\username\.ssh\id_ed25519
```

The key's passphrase can be saved encrypted.

### SSH Agent

Uses the SSH agent already running on your system.

---

## Import SSH Config

ASProOps can read configuration from:

```text
~/.ssh/config
```

Use the **Import SSH** button in the app.

Import supports common host configuration and `ProxyJump`/jump-host entries, which can be mapped to ASProOps sessions.

Complex configuration such as some wildcard patterns or `Match` blocks may not fully translate into GUI sessions.

---

## Quick Connect

Press **Ctrl+K** from anywhere in the app, or click the "Quick Connect" box in the header, to open a search palette for saved servers. Type a name/host/username/group, navigate with the arrow keys, and hit Enter to connect immediately.

---

## Local Terminal

Open the **Local** menu on the navigation rail.

ASProOps detects:

- PowerShell 7 (`pwsh.exe`)
- Windows PowerShell (`powershell.exe`)
- Command Prompt (`cmd.exe`)
- WSL distros via `wsl.exe --list --quiet`

Local terminals use `node-pty`, so interactive apps, ANSI escape sequences, terminal resizing, and shell shortcuts work like a native terminal.

WSL isn't required for SSH connections.

**Terminal shortcuts:**

- `Ctrl+Shift+T` — new terminal tab (works whether the terminal has focus or another panel is active, as long as an SSH tab is still the active workspace).
- `Ctrl+Shift+C` / `Ctrl+Shift+V` — copy/paste the current selection.
- Right-click — Copy/Paste menu.

---

## SFTP and Remote Files

Once an SSH server is connected, open the **SFTP** menu.

Available features include:

- directory browsing, home / up / refresh, direct path entry, hidden files
- upload, download, remote edit
- follow-terminal for common Linux prompts
- resizable, reorderable, and hideable columns
- right-click for a quick action menu (edit/download/rename/info/delete)

Remote editing downloads the file to a local temp file, watches it for changes, and uploads the latest version back to the server.

---

## Monitoring

Monitoring can be opened once a Linux server is connected.

Current metrics:

- CPU usage
- load average
- memory and swap
- filesystem/storage
- network throughput
- top processes
- uptime

Monitoring reads information from `/proc`, so it isn't available for remote Windows servers in the current implementation. Once the Monitoring panel has been opened for a server, its CPU/RAM/DISK/NET summary also shows up in the bottom status bar for as long as that server stays active.

---

## Server SSH Login Log

The **Login Log** tab (⚿ icon) shows the server's own sshd authentication log — unlike ASProOps's own connection history, this is a record of logins from **any client** (PuTTY, WinSCP, ASProOps on another PC, etc.), sourced from `journalctl -u ssh -u sshd` (systemd distros) or `/var/log/auth.log` / `/var/log/secure` as a fallback.

Access is attempted in order: direct, then `sudo -n` (if NOPASSWD is configured), then a sudo password prompt as a last resort — the password only ever flows over the encrypted SSH stdin channel, never in a command argument and never written to disk, and is cached in memory only for as long as that SSH connection stays alive.

Two views:

- **Summary** — one card per login event, successful logins merged from several raw lines (correlated by PID), failed attempts grouped by source IP (so bot scans don't flood the list).
- **Raw** — the regular log viewer (search/filter/copy) for the original lines.

You can also browse other dates (Today/Yesterday/7 days/pick a date) via a one-shot query, independent of the live stream.

---

## DevOps: Project, Log Viewer, Docker, Cron, Provisioning, Git, and Deploy

These panels were built as one in-app DevOps workflow, all running over the same SSH connection with no extra channels or credentials:

### Project Profile

The **Projects** panel marks one working directory on a server (absolute path + environment variables) as the foundation for the features below. A project can be linked to one Deploy Template, and stores a list of log paths and relevant systemd service names.

The **Auto-detect** button in the project form looks for Laravel (`storage/logs/`) and CodeIgniter 4 (`writable/logs/`) logs — any file modified in the last 30 days, without relying on a specific naming pattern (works with custom log filenames too) — then adds them to the project's log list.

### `.env` Editor

The **.env** button on each project opens a key-value editor for the project's real `.env` file at its root (read directly by Laravel/CodeIgniter 4 at runtime) — different from the environment variables in the project form, which are only used by ASProOps itself when running a deploy. All values are masked by default (with a toggle to reveal them), and comments/blank lines in the original `.env` are preserved exactly when saving.

### Live Log Viewer

Opened via a log chip in the Projects panel. Runs `tail -F` and streams it live into its own workspace tab, with:

- automatic coloring (ERROR/WARN/INFO/DEBUG, timestamps, IP addresses)
- multi-line block grouping — stack traces and `Caused by:` stay visually attached to their triggering line until an actual new entry appears
- line filtering and search-as-you-type
- copy all, or just the filtered results

### Service Manager

The **Services** panel lists systemd units on the currently active server, with search, a show-all toggle, and start/stop/restart actions. Stopping a service asks for confirmation first.

### Docker Manager

The **Docker** panel lists containers (`docker ps -a`) on the currently active server — name, image, status — with start/stop/restart and a **View logs** button that opens a live per-container log streaming tab (same search/filter/coloring as the Live Log Viewer). Container actions try direct access first, then fall back to `sudo -n` if the user isn't in the `docker` group.

### Cron Job Manager

The **Cron** panel reads/writes the crontab belonging to the currently logged-in SSH user (`crontab -l`/`crontab -`, never another user's via `-u`). Add, edit, delete, or disable (comment out) jobs directly from the UI. The schedule parser is validated character-by-character so the documentation comments shipped in the default `/etc/crontab` (e.g. the standard Debian/Ubuntu template) aren't misread as jobs.

### Server Provisioning

The **Provisioning** panel runs server setup templates (a sequence of shell steps, structured the same as Deploy Templates) directly on the active session — not tied to any Project/path. Built-in templates: **Update & Base Tools**, **Install Docker**, **Install Node.js (NVM)**, **Install PHP (+ Composer)**, **Install MySQL**, **Install Nginx**. None of the built-in templates touch SSH/firewall/accounts (disabling password auth, `ufw enable`, etc.) on purpose — that kind of change can lock you out of the server if done wrong, so it's left for you to add yourself, deliberately, via the step editor.

### Port Forwarding

The **Port Forward** panel manages **local** (`-L`, a port on your machine forwarded to a host/port as seen from the server — e.g. reaching a database that only listens on the server's `127.0.0.1`) and **remote** (`-R`, the server opens a port that forwards back to your machine) SSH tunnels. Rules are saved per server, tunnel status (active/error/stopped) shows in real time, and tunnels stop automatically when the server disconnects or the app closes.

### Git Panel

The **Git** panel reads repo status (branch, upstream, ahead/behind, last commit, changed files) from a project's path, and provides fetch/pull. Push is deliberately not exposed from the UI — it needs write credentials, which is a meaningfully bigger risk to trigger from a single button.

### Deploy Template, History, & Rollback

A Deploy Template is a sequence of shell steps that can be attached to many projects/servers (managed under **Settings → Deploy Template**). Four built-in templates are available immediately: **CodeIgniter 4**, **Laravel**, **Vue**, and **NestJS** — each freely editable.

Running a deploy (the "Deploy" chip in the Projects panel, which asks for confirmation) executes each step sequentially in the project's path, with the project's environment variables exported first. Output streams live into a workspace tab, and the run **stops automatically the moment a step fails** (non-zero exit code) — the same semantics as any CI pipeline.

Every run (deploy or rollback) is recorded in a per-project **history** — the "History" chip in the Projects panel — including the git commit active right after the run (if the path is a git repo), success/failure status, and any error message. From a successful history entry, the **Rollback** button runs `git checkout` to that commit and re-runs the same template steps (skipping any `git pull`/`fetch` step, so it doesn't immediately get pulled back to the latest commit).

---

## Application Lock (PIN)

An optional feature under **Settings → Application Lock**. Once enabled, the app asks for a PIN every time it opens, before the server list and saved credentials become accessible.

**Auto-lock**: the app can also be configured to ask for the PIN again after a configurable number of minutes without mouse/keyboard activity (default 10 minutes; change it or set it to 0 to disable). There's also a manual lock button (🔒) in the header, to lock immediately without waiting for the idle timeout.

Locking the app (automatic or manual) **does not close any running session** — every SSH terminal, local terminal, and connection stays alive behind the lock screen; only interaction is blocked until the PIN is entered again.

The PIN is hashed with `scrypt` and stored locally — this isn't a replacement for the `safeStorage` encryption protecting session files on disk, but an additional barrier at the UI layer.

---

## Language

ASProOps currently offers:

- English (default)
- Indonesian

Change it from:

```text
Settings → General → Application Language
```

The language preference is stored locally and doesn't require an app restart.

---

## Data Location and Security

Sessions, projects, preferences, and the app lock are stored in Electron's `userData` directory as separate JSON files (`sessions.json`, `projects.json`, `preferences.json`, `applock.json`, etc.).

The actual location follows the OS and Electron's configuration.

Passwords and passphrases are **never stored as plain text**. ASProOps uses Electron `safeStorage`, which on Windows relies on the OS's credential-protection mechanism.

The session file stores connection configuration and secrets in encrypted form.

### Known Hosts

Host key verification uses the SSH file:

```text
~/.ssh/known_hosts
```

If a host is unknown or its key has changed, the connection requires a user decision first.

Don't disable host key verification just to silence a connection warning.

---

## Native Modules and Rebuilding

`node-pty` must match Electron's ABI.

The project has a smart rebuild cache at:

```text
node_modules/.asproops-native-build.json
```

The signature cache covers:

- Electron version
- node-pty version
- platform
- architecture

A forced rebuild is only needed when there's a native module problem:

```powershell
npm run rebuild:native:force
```

Don't run a forced rebuild on every install unless it's actually needed.

---

## Build

Build from source:

```powershell
npm run build
```

Build output goes to:

```text
out/
```

To run the build output:

```powershell
npm run start
```

### Installer / Release Binary

ASProOps is packaged into a Windows installer (`.exe`, NSIS) using [electron-builder](https://www.electron.build/):

```powershell
npm run dist:win
```

This runs `npm run build` and then wraps the output into an installer. Results land in:

```text
release/
  ASProOps Setup <version>.exe   ← the installer shared with users
  win-unpacked/                  ← installer-free build, for quick testing (run ASProOps.exe directly)
```

The installer is non-oneClick (users can pick an install location) and automatically creates Desktop and Start Menu shortcuts. Packaging config lives in the `"build"` field in `package.json` — the executable icon uses `assets/asproops.ico`, and native modules (`node-pty`, `ssh2`, `cpu-features`) are unpacked from the asar archive because native bindings can't be loaded directly from inside a `.asar`.

`npmRebuild` is deliberately disabled (`false`): electron-builder by default tries to rebuild native modules from source before packaging, but the prebuilt binaries already present in `node_modules` (see [Native Modules and Rebuilding](#native-modules-and-rebuilding)) already match the Electron version in use — rebuilding here only adds build time and risks failure on environments without the native toolchain set up (Visual Studio Build Tools, etc.).

Still **not finalized**:

- code signing (the installer is currently unsigned — Windows SmartScreen will likely warn during install)
- real auto-update (automatic download + install) — what exists today is just **checking for the latest version** via GitHub Releases (Settings → About); users still download and install the new installer manually
- a public release channel / checksum artifacts
- builds for architectures other than x64 (Windows arm64, plus macOS/Linux — untested even though `node-pty` ships prebuilds for those platforms)

---

## Troubleshooting

### `MSB8040: Spectre-mitigated libraries are required`

Open **Visual Studio Installer → Modify → Individual components**, then install the Spectre-mitigated libraries matching your MSVC toolset and x64/x86 architecture.

Then:

```powershell
npm run rebuild:native:force
```

### `node-pty` doesn't match Electron

```powershell
npm run rebuild:native:force
```

### `tsc is not recognized`

Make sure dev dependencies are installed:

```powershell
npm install
```

Then:

```powershell
npm run typecheck
```

### `Cannot find package 'vite'`

Project dependencies aren't fully installed. Run:

```powershell
npm install
```

### WSL doesn't show up

Check installed distros:

```powershell
wsl --list --quiet
```

If none are listed, install/enable WSL first.

### Monitoring shows nothing

Make sure the target is a Linux server and the SSH user can read standard system information under `/proc`.

### Service Manager / Git Panel / Deploy show nothing

All three run commands over SSH (`systemctl`, `git`, plain shell) — make sure the relevant binaries (`systemctl`, `git`) are installed on the target server, and the SSH user has sufficient permissions. Starting/stopping/restarting services and `git pull` need appropriate server privileges (root, or passwordless sudo for `systemctl`).

### Docker Manager is empty / fails to load

Make sure Docker is installed on the target server and the SSH user has access to `docker.sock` (a member of the `docker` group, or passwordless sudo for `docker`) — the error message explains the specific cause.

### Cron shows an unfamiliar job

The server's crontab is probably still using the default documentation template (Debian/Ubuntu `/etc/crontab`), which contains an example cron schedule inside its comment block — one example line (`0 5 * * 1 tar -zcf ...`) happens to be formatted exactly like a real cron schedule, so it's inherently ambiguous to tell apart automatically. Entries like this show up as disabled (grey dot) and are safe to delete manually if they bother you.

### Auto-detect logs doesn't find anything

Make sure the project path points at the application root (containing `storage/` or `writable/`, not `public/`), and that the server has actually written a log within the last 30 days — a healthy app with no recorded errors simply has no log file yet to detect.

---

## Contributing

The project is still in active development. Before submitting changes:

```powershell
npm install
npm run typecheck
npm run build
```

A few architectural rules worth preserving:

- Don't reopen an SSH shell just because React re-rendered.
- One terminal tab must keep exactly one shell/PTY alive for as long as the tab exists.
- Switching workspaces must not kill other running terminals, log viewers, or deploy runs.
- Secrets must never be exposed to the renderer.
- Host key verification must never be silently bypassed.
- Disruptive actions (stopping a service, running a deploy) must go through explicit confirmation, not a single click.
- Avoid rebuilding the native module on every `npm install` when the signature hasn't changed.

Once the repository goes public, this section can be expanded with a branching workflow, pull requests, linting, and issue templates.

---

## Short Roadmap

A few areas planned for future work:

- code signing and real auto-update (automatic download+install) for the Windows installer — manual version checking already exists (Settings → About), and basic packaging already exists too, see [Installer / Release Binary](#installer--release-binary)
- Terminal/Monitoring module icons from the asset pack for rail/tab icons — currently only used for the main app identity
- push support in the Git Panel (currently deliberately limited to fetch/pull)
- multi-server broadcast commands (run the same command across several servers at once)
- monitoring thresholds/notifications
- application diagnostics/logging
- release workflow

The roadmap may change as core features stabilize.

---

## License

ASProOps is released under the [Apache License 2.0](LICENSE).

---

## Note

ASProOps is not an official product of OpenSSH, Microsoft, Electron, or the `ssh2` project.

The ASProOps name and logo are used as this application's identity.

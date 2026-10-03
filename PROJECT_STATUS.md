# PROJECT_STATUS.md

## Baseline

Status: COMPLETE

- Source version: `1.3.0`
- Electron: `44.5.1`
- React: `19`
- TypeScript + Vite `7`
- Local terminal: xterm.js `5.5` + `node-pty 1.1.0` + Windows ConPTY
- Remote transport: `ssh2`
- Primary platform: Windows 10/11 x64

Remote capabilities remain isolated from the Local Workspace domain.

## LOCAL WORKSPACE

### L1: Saved Local Projects + project-aware terminal + CLI launchers

Status: IN PROGRESS / MANUAL VERIFICATION PENDING

Implemented:

- saved Local Projects in `local-projects.json`
- project-aware local terminal cwd
- project-aware tabs/workspaces
- folder picker / Open Folder
- missing-folder handling
- default terminal profile per project
- persistence and `lastOpenedAt`
- renderer -> preload -> IPC -> main security boundary

### L2A: Extensible CLI Registry

Status: IMPLEMENTED / MANUAL VERIFICATION PENDING

Implemented:

- independent global CLI registry in `local-cli-profiles.json`
- built-in seed profiles: OMP, Codex, Claude
- custom CLI Add / Edit / Enable / Disable / Delete
- Windows PATH detection via `where.exe`
- status: Available / Not found / Disabled
- project preferred CLI now references `cliProfileId`, not a hardcoded union
- project cards launch any enabled + available registry CLI
- renderer sends only `cliProfileId` at launch; main resolves authoritative command/args
- L1 `local-projects.json` v1 is migrated in memory to v2 (`preferredCli` -> `preferredCliProfileId`)
- deleting a custom CLI clears dangling preferred-CLI references from local projects
- CLI command/arguments reject shell operators and arbitrary shell expressions

Manual verification is intentionally left to the developer workstation. No automated test/build run is part of this change.

### L2A.1: OMP Windows/ConPTY compatibility

Status: IMPLEMENTED / MANUAL VERIFICATION PENDING

Implemented:

- OMP registry launches on Windows PowerShell / Windows PowerShell 5 use a
  command-scoped compatibility environment
- OMP registry launches on CMD use `setlocal` / `endlocal`
- compatibility marker is a structurally valid `SSH_CONNECTION`
- the previous `SSH_CONNECTION` value is restored after OMP exits
- Codex, Claude, custom CLI, plain terminals, SSH sessions, and WSL are not modified
- no global ASProOps environment spoofing
- no OMP binary patching and no xterm.js / node-pty engine rewrite

Purpose: prevent OMP's Windows ConPTY win32-input fallback from interpreting
normal xterm.js VT arrow sequences as separate Escape/text input.

### L2B: Project Quick Commands

Status: DEFERRED / NOT PLANNED FOR NOW

Decision:

- current CLI-first workflow already covers the user's normal project commands
- do not add command-button clutter unless a concrete need appears later

### L2C: Workspace Restore

Status: IMPLEMENTED / MANUAL VERIFICATION PENDING

Implemented:

- versioned renderer snapshot: `asproops.workspace.v1`
- restore open SSH tabs without auto-connect
- restore Local Terminal / Local Project tabs as fresh shell instances
- CLI-started local tabs restore as plain project shells; OMP/Codex/Claude are never auto-run
- restore active Dashboard / SSH / Local workspace when the target still exists
- restore sidebar mode, width, hidden state, and active Ops tab
- Local Workspace Projects/CLI/Shells collapse + pane heights remain restored by their existing dedicated layout storage
- stale SSH session IDs are dropped
- stale/missing local projects are dropped
- terminal profiles are re-resolved from currently detected profiles, not trusted from localStorage
- Deploy / Rollback / Provision / Log / Docker Log runtime workspaces are intentionally not restored

No SSH auto-connect, no CLI auto-run, and no one-shot operation replay.

### L2D: Recent & Favorite Projects + CLI Health

Status: IMPLEMENTED / MANUAL VERIFICATION PENDING

Implemented:

- Local Project favorites persisted in `local-projects.json`
- project store schema v3 with v1/v2 migration
- favorites sort before non-favorites
- within each group, most recently opened projects sort first
- compact project search by name/path
- relative "last opened" metadata
- favorite toggle on each project card
- CLI health includes resolved executable path from Windows PATH
- built-in OMP/Codex/Claude version probing with short timeout
- CLI health cache avoids repeatedly spawning version checks
- manual refresh forces a fresh health probe
- custom CLI version probing is intentionally skipped to avoid executing unknown
  `--version` behavior automatically
- CLI create/edit/enable-disable/delete invalidates health cache

No CLI is installed, updated, or modified automatically.

### L3A: Local Git Awareness

Status: SKIPPED

Decision:

- skipped by user; no standalone Local Git panel is planned
- L3C may read a bounded Git snapshot only for handoff context

### L3B: CLI Registry Health

Status: COMPLETE / ABSORBED INTO L2D

- executable resolution, availability, built-in version probing, and health cache
  are already implemented by L2D

### L3C: Project Context / Handoff Helper

Status: IMPLEMENTED / MANUAL VERIFICATION PENDING

Implemented:

- per-project Context/Handoff action in Local Workspace
- renderer sends only `projectId`; main process resolves authoritative project path
- bounded Git snapshot: branch, HEAD, upstream, ahead/behind, last commit,
  clean/dirty state, and changed-file summary
- bounded allowlist-only project document capture
- supported context documents include AGENTS/CLAUDE/GEMINI instructions,
  PROJECT_STATUS/STATUS, architecture/design/PRD/spec/task docs, README, and
  ASProOps Local Workspace documentation when present
- `.env`, private-key, credential, and arbitrary renderer-supplied paths are not read
- large context files are bounded with head/tail excerpts
- total copied document context is capped
- preview dialog before copy
- Copy Context uses Electron clipboard bridge
- no file mutation, Git fetch/pull, agent launch, or automatic external sharing

### L3D: Local Process Status

Status: SKIPPED

Decision:

- skipped by user; no local process/status manager is planned at this time

### L4

Status: PLANNED

- environment profiles
- command chaining/automation
- richer project health

## Current known limitations

- CLI availability is detected from Windows PATH. A CLI available only inside WSL is not detected.
- No speculative Windows path to WSL path translation is performed.
- CLI Registry commands are intentionally executable names, not arbitrary shell expressions.
- Arguments are intentionally simple safe tokens in L2A. Complex quoted shell expressions belong to Quick Commands, not CLI Registry.
- Workspace Restore restores layout/tabs, not live process state or terminal scrollback.
- OMP compatibility applies only when OMP is launched through the Local CLI Registry.
  Manually typing `omp` inside a plain Local Terminal bypasses the wrapper.
- OMP compatibility is intentionally not applied to WSL.

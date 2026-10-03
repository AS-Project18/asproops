# PROJECT_STATUS.md

## Baseline

Status: COMPLETE

- Source version: `1.2.0`
- Electron: `39.8.10`
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

### L2D

Status: PLANNED

- recent projects
- richer CLI version information

### L3

Status: PLANNED

- local Git status
- local process/service status
- task/project notes
- context/handoff helper

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

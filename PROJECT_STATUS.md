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

### L2B

Status: NEXT

- project Quick Commands

### L2C

Status: PLANNED

- workspace/layout restore

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
- workspace restore is not implemented yet.
- OMP Win32 input regressions are not worked around by ASProOps.

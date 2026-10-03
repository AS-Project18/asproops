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

Remote capabilities already present include saved SSH sessions, interactive SSH terminal, SFTP, remote editing, monitoring, remote Project Profiles, live logs, `.env` editing, systemd services, Docker, cron, provisioning, port forwarding, Git status/actions, deploy history/rollback, and SSH login-log viewing.

## LOCAL WORKSPACE

### L1: Saved Local Projects + project-aware terminal + CLI launchers

Status: IN PROGRESS

Implementation scope:

- Saved Local Projects in a dedicated `local-projects.json` store
- project-aware local terminal `cwd`
- built-in OMP / Codex / Claude launchers detected through Windows PATH
- project-aware local workspace/tab identity
- local project folder picker and Open Folder action
- missing-folder handling
- default terminal profile per project
- local-project persistence and `lastOpenedAt`
- renderer -> preload -> IPC -> main security boundary preserved

Verification still required on a Windows checkout before marking COMPLETE:

- `npm run typecheck`
- `npm run build`
- manual smoke checklist in `docs/LOCAL_WORKSPACE.md`

### L2

Status: PLANNED

- project Quick Commands
- workspace/layout restore
- CLI tool registry and version information
- recent projects

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

- CLI availability in L1 is detected from Windows PATH. A CLI available only inside WSL is not detected.
- No speculative Windows path to WSL path translation is performed.
- Local terminal/workspace restore after an app restart remains L2.
- Quick Commands and arbitrary configurable command execution remain L2.
- OMP 18.4.9/18.4.10 Win32 input regressions are upstream and are not worked around in this phase.

## Next recommended task

Finish L1 verification on Windows. After the gate is green, move to L2 with Quick Commands and workspace/layout restore as separate tasks rather than bundling process management or Git UI into the same change.

# Local Workspace

This document is the source of truth for the ASProOps Local Workspace domain.

## Goal

Evolve ASProOps from a predominantly SSH/server operations tool into a Local + Remote Project & CLI Operations Workspace without regressing the mature remote feature set.

## Domain boundary

Remote `ProjectProfile` and local `LocalProjectProfile` are deliberately separate.

Remote projects are session-bound and include remote absolute paths, deploy environment, log paths, service names, deploy templates, and SSH-based actions. Local projects represent a saved directory on the operator workstation plus local terminal/CLI preferences.

They may be presented together in future UX, but their storage and domain semantics must not be merged merely for UI convenience.

## L1 data model

```ts
type LocalCliLauncher = 'omp' | 'codex' | 'claude';

interface LocalProjectProfile {
  id: string;
  name: string;
  path: string;
  defaultTerminalProfileId?: string;
  preferredCli?: LocalCliLauncher;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
}
```

Transient renderer summaries may additionally include `pathExists`. That value is not persisted.

## Storage

File: `local-projects.json`

Location: Electron `userData`

Rules:

- versioned JSON
- atomic temp-write + rename
- corrupt-file quarantine
- no secrets
- duplicate paths rejected
- paths validated in Electron main
- missing/moved folders remain listable and editable without crashing the app

Remote projects stay in `projects.json`.

## IPC flow

```text
Renderer
  -> typed preload API
  -> IPC
  -> Electron main
      -> LocalProjectStore / LocalTerminalManager / Electron shell/dialog
```

Renderer code never receives unrestricted filesystem or process APIs.

Local terminal opening uses a structured request:

```ts
interface LocalTerminalOpenOptions {
  profileId: string;
  cols: number;
  rows: number;
  cwd?: string;
  projectId?: string;
  launcher?: 'omp' | 'codex' | 'claude';
}
```

When `projectId` is present, main resolves the stored project and uses its stored path as the authoritative `cwd`.

## Project-aware terminal

A normal shell opened from the Shells list continues to use the user home directory.

A shell opened from a saved local project uses the saved project path.

PTY lifecycle rules are unchanged:

- PTY is created only after xterm is mounted and fitted.
- hiding a workspace or switching tabs does not kill its PTY.
- explicit tab close kills the PTY.
- resize, clipboard, right-click, file-path drag, PowerShell, CMD, and WSL behavior remain on the existing engine.

## CLI launchers

Built-in L1 launchers:

- OMP -> `omp`
- Codex -> `codex`
- Claude -> `claude`

Availability is detected through Windows PATH with `where.exe`.

The launcher is not spawned as a separate detached process. ASProOps opens the selected project shell first, then writes the built-in command exactly once after the shell starts producing output, with a short fallback timer. When the CLI exits, the shell remains usable.

There is no arbitrary configurable command API in L1.

## Default shell resolution

For a project:

1. saved `defaultTerminalProfileId`, if still available
2. PowerShell 7
3. Windows PowerShell
4. Command Prompt
5. first available local terminal profile

The application does not assume `pwsh.exe` exists.

## WSL boundary

L1 does not implement speculative Windows-to-WSL path translation.

A WSL profile may be used as a project default shell, but Windows PATH launcher detection does not prove the same CLI exists inside that distro. Per-environment launcher detection is a future enhancement.

## UI

Local workspace sidebar contains:

- Saved Projects
- Add/Edit/Remove
- Terminal / OMP / Codex / Claude
- Open Folder
- missing-folder state
- Shells list

Project-aware tabs use project identity, for example:

- `Resort · Terminal`
- `Resort · OMP`
- `Resort · Codex`
- `Resort · Claude`

The full `cwd` is available as tab tooltip/context.

## Out of scope for L1

- configurable Quick Commands
- command chains
- workspace restore after app restart
- process/service manager
- Docker local
- local Git UI
- environment profiles
- notes
- AI context generator
- file manager or source editor
- VS Code integration
- recursive project auto-detection
- OMP compatibility hacks
- remote/local ProjectProfile merge

## Verification gate

Run:

```powershell
npm run typecheck
npm run build
```

Manual smoke:

1. existing PowerShell terminal works
2. existing CMD works
3. WSL list has no regression
4. create Local Project
5. select folder
6. close/reopen app and confirm persistence
7. edit project
8. remove project
9. missing folder is safe and clearly marked
10. project Terminal opens in correct cwd
11. OMP opens in correct cwd when installed
12. Codex opens in correct cwd when installed
13. Claude opens in correct cwd when installed
14. unavailable CLI is disabled or clearly unavailable
15. multiple projects can run concurrently
16. tab shows project + launcher identity
17. tab switching does not terminate PTY/CLI
18. non-project terminal still starts in home
19. SSH/server build and core behavior do not regress
20. Open Folder works

Only after both automated gates and the relevant manual smoke checks pass should L1 be marked COMPLETE.

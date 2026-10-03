# Local Workspace

This document is the source of truth for the ASProOps Local Workspace domain.

## Goal

Evolve ASProOps into a Local + Remote Project & CLI Operations Workspace while keeping mature SSH/remote behavior isolated and stable.

## Domain boundary

Remote `ProjectProfile` and local `LocalProjectProfile` remain separate domains.

Remote projects are session-bound and contain remote paths and remote operational metadata. Local projects represent a saved workstation directory plus local shell/CLI preferences.

## Current local data model

```ts
interface LocalProjectProfile {
  id: string;
  name: string;
  path: string;
  defaultTerminalProfileId?: string;
  preferredCliProfileId?: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
}

interface LocalCliProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  source: 'builtin' | 'custom';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
```

`pathExists` and CLI `availability/status` are transient summaries and are not persisted as authority.

## Storage

### Local projects

File: `local-projects.json`

Schema version: 2

L1 schema version 1 is migrated in memory. Legacy `preferredCli` values (`omp`, `codex`, `claude`) map directly to registry IDs through `preferredCliProfileId`.

### CLI registry

File: `local-cli-profiles.json`

Schema version: 1

Default built-in profiles:

- OMP -> `omp`
- Codex -> `codex`
- Claude -> `claude`

Users may create additional custom CLI profiles without rebuilding ASProOps.

Both stores use Electron `userData`, versioned JSON, atomic temp-write + rename, and corrupt-file quarantine.

## Security boundary

Renderer never sends a launch-time executable or arbitrary startup command.

Launch flow:

```text
Renderer
  -> { projectId, profileId, cliProfileId }
  -> preload
  -> IPC
  -> Electron main
      -> resolve Local Project
      -> resolve CLI Registry profile
      -> validate project folder + enabled CLI
      -> detect CLI on Windows PATH
      -> open PTY
      -> send authoritative registry command once
```

The CLI Registry deliberately accepts an executable/command name plus simple argument tokens. It rejects shell expressions. Arbitrary project commands belong to L2B Quick Commands.

## CLI Registry UX

Local Workspace provides:

- global CLI list
- Add CLI
- Edit
- Enable / Disable
- Delete custom CLI
- Available / Not found / Disabled status
- project preferred CLI selection
- per-project CLI selector + Run

Built-in profiles cannot be deleted, but may be edited or disabled.

## Project-aware terminal

Normal shell entries still start in the user home directory.

Project launches use the authoritative saved project path as cwd.

CLI launch opens the selected project shell first and writes the registry command exactly once after shell startup. Exiting the CLI returns to the shell.

## Default shell resolution

1. saved project default terminal profile, if available
2. PowerShell 7
3. Windows PowerShell
4. Command Prompt
5. first available profile

## OMP Windows / ConPTY compatibility

OMP is a special case in the Local CLI Registry because its Windows TUI can
enable the console `win32-input-mode` fallback while ASProOps presents an
xterm.js frontend over ConPTY. In that combination normal VT cursor sequences
can be interpreted as Escape plus literal text.

When a registry profile whose command is `omp` or `omp.exe` is launched on
Windows PowerShell or CMD, ASProOps temporarily supplies a structurally valid:

```text
SSH_CONNECTION=127.0.0.1 0 127.0.0.1 0
```

This makes OMP use its remote-terminal-safe input path instead of the
host-local Win32 input mode. The variable is scoped to the OMP invocation and
the prior shell value is restored after OMP exits.

This compatibility path is deliberately narrow:

- it applies only to OMP launched through the Local CLI Registry
- it does not modify plain local terminals
- it does not affect Codex, Claude, or custom CLI commands
- it is not applied to WSL
- manually typing `omp` in a plain terminal bypasses it
- ASProOps does not patch the OMP binary or rewrite xterm.js/node-pty input

Because OMP treats the wrapped process as an SSH-like session, host-local OMP
features that intentionally disable themselves over SSH can also be disabled
for that OMP invocation. This trade-off is preferable to spoofing SSH for the
entire ASProOps terminal environment.

## WSL boundary

Windows PATH availability does not imply the same executable exists inside a WSL distribution. L2A intentionally does not perform Windows-to-WSL path translation or WSL-specific CLI discovery.

## Next

L2B: project Quick Commands.

Quick Commands are intentionally separate from CLI Registry:

- CLI Registry = trusted executable/tool identity
- Quick Commands = user-defined project command/workflow

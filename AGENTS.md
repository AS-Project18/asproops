# AGENTS.md

## Mission

ASProOps is a Windows-first Local + Remote Project & CLI Operations Workspace. Preserve existing SSH/server operations while evolving local project workflows incrementally.

## Architecture rules

- Treat remote `ProjectProfile` and local `LocalProjectProfile` as separate domains.
- Renderer code must use the typed preload API. Do not expose unrestricted Node.js, filesystem, `ipcRenderer`, or `child_process` access to the renderer.
- Secrets stay in the Electron main process or the existing encrypted session store. `LocalProjectProfile` must never contain secrets or API keys.
- Validate paths and launcher inputs in the main process.
- Keep `node-pty`, Windows ConPTY, xterm.js, SSH, SFTP, and existing terminal behavior unless a task explicitly targets them.
- A React rerender, hidden workspace, or tab switch must not terminate a live PTY. Close the PTY only when its workspace is explicitly closed or the application shuts down.
- Do not add speculative Windows-to-WSL path conversion.
- Do not add OMP compatibility workarounds unless a dedicated task explicitly requires them.
- Do not merge remote and local project storage.

## Storage

- Remote server projects remain in `projects.json`.
- Local saved projects use `local-projects.json` under Electron `userData`.
- Persistent JSON stores must use versioned data, atomic temp-write + rename, and corrupt-file quarantine.
- Never persist secrets in project metadata.

## Verification

Run from repository root:

```powershell
npm run typecheck
npm run build
```

For Local Workspace work, also smoke-test PowerShell, CMD, WSL listing, saved-project CRUD/persistence, missing folders, project cwd, CLI launchers, project-aware tabs, Open Folder, multiple concurrent local projects, and SSH/server regression.

## Change discipline

- Read the existing implementation before changing behavior.
- Prefer the smallest compatible change over rewrites.
- Do not upgrade dependencies without a concrete need.
- Do not commit or push automatically.

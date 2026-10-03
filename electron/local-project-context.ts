import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import type {
  LocalProjectContextFile,
  LocalProjectContextGit,
  LocalProjectContextResult,
  LocalProjectProfile,
} from '../src/shared/types';

const MAX_CONTEXT_TOTAL_BYTES = 30_000;
const MAX_CONTEXT_FILE_BYTES = 6_000;
const MAX_GIT_CHANGES = 60;

const CONTEXT_FILE_CANDIDATES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'PROJECT_STATUS.md',
  'STATUS.md',
  'TECH_STACK.md',
  'DESIGN.md',
  'DESIGN_SYSTEM.md',
  'WEB_DESIGN_GUIDE.md',
  'MOBILE_DESIGN_GUIDE.md',
  'PRD.md',
  'FEATURE_SPECS.md',
  'TASKS.md',
  'README.md',
  'README.MD',
  'docs/LOCAL_WORKSPACE.md',
] as const;

interface CommandResult {
  ok: boolean;
  output: string;
  missingExecutable?: boolean;
}

function normalizeOutput(value: string): string {
  return value.replace(/\r/g, '').trim();
}

function runGit(cwd: string, args: string[], timeout = 2_000): CommandResult {
  const result = spawnSync('git', args, {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    timeout,
    maxBuffer: 512 * 1024,
  });

  const missingExecutable =
    Boolean(result.error) &&
    ((result.error as NodeJS.ErrnoException).code === 'ENOENT' ||
      /not found/i.test((result.error as Error).message));

  const output = normalizeOutput(`${result.stdout ?? ''}${result.stderr ? `\n${result.stderr}` : ''}`);

  return {
    ok: result.status === 0 && !result.error,
    output,
    ...(missingExecutable ? { missingExecutable: true } : {}),
  };
}

function readBoundedUtf8(
  path: string,
  maxBytes: number,
): { content: string; truncated: boolean } {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error('Bukan file.');

  if (stat.size <= maxBytes) {
    return {
      content: readFileSync(path, 'utf8').replace(/\u0000/g, ''),
      truncated: false,
    };
  }

  const headBytes = Math.max(1, Math.floor(maxBytes * 0.6));
  const tailBytes = Math.max(1, maxBytes - headBytes);
  const head = Buffer.alloc(headBytes);
  const tail = Buffer.alloc(tailBytes);
  const fd = openSync(path, 'r');

  try {
    readSync(fd, head, 0, headBytes, 0);
    readSync(fd, tail, 0, tailBytes, Math.max(0, stat.size - tailBytes));
  } finally {
    closeSync(fd);
  }

  const omitted = Math.max(0, stat.size - maxBytes);
  return {
    content:
      head.toString('utf8').replace(/\u0000/g, '') +
      `\n\n... [${omitted} bytes omitted by ASProOps] ...\n\n` +
      tail.toString('utf8').replace(/\u0000/g, ''),
    truncated: true,
  };
}

function collectContextFiles(projectPath: string): LocalProjectContextFile[] {
  const result: LocalProjectContextFile[] = [];
  const seen = new Set<string>();
  let remaining = MAX_CONTEXT_TOTAL_BYTES;

  for (const relativePath of CONTEXT_FILE_CANDIDATES) {
    if (remaining <= 0) break;

    const dedupeKey = relativePath.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    const absolutePath = join(projectPath, ...relativePath.split('/'));
    if (!existsSync(absolutePath)) continue;

    try {
      const stat = statSync(absolutePath);
      if (!stat.isFile()) continue;

      const perFileBudget = Math.min(MAX_CONTEXT_FILE_BYTES, remaining);
      const value = readBoundedUtf8(absolutePath, perFileBudget);
      if (!value.content.trim()) continue;

      seen.add(dedupeKey);
      result.push({
        path: relativePath,
        content: value.content,
        truncated: value.truncated,
      });

      remaining -= Math.min(perFileBudget, Buffer.byteLength(value.content, 'utf8'));
    } catch {
      // Context helper bersifat best-effort. Satu file yang gagal dibaca
      // tidak boleh menggagalkan seluruh handoff.
    }
  }

  return result;
}

function collectGit(projectPath: string): LocalProjectContextGit {
  const version = runGit(projectPath, ['--version'], 1_500);
  if (!version.ok) {
    return {
      available: false,
      isRepository: false,
      changes: [],
    };
  }

  const inside = runGit(projectPath, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.output.split('\n').at(-1) !== 'true') {
    return {
      available: true,
      isRepository: false,
      changes: [],
    };
  }

  const branchResult = runGit(projectPath, ['branch', '--show-current']);
  const headResult = runGit(projectPath, ['rev-parse', '--short', 'HEAD']);
  const upstreamResult = runGit(projectPath, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  const statusResult = runGit(projectPath, ['status', '--short', '--untracked-files=normal'], 3_000);
  const lastCommitResult = runGit(projectPath, [
    'log',
    '-1',
    '--pretty=format:%h | %s | %an | %aI',
  ]);

  const rawChanges = statusResult.ok && statusResult.output
    ? statusResult.output.split('\n').filter(Boolean)
    : [];
  const changes = rawChanges.slice(0, MAX_GIT_CHANGES);
  if (rawChanges.length > MAX_GIT_CHANGES) {
    changes.push(`… ${rawChanges.length - MAX_GIT_CHANGES} more changed file(s)`);
  }

  let ahead: number | undefined;
  let behind: number | undefined;

  if (upstreamResult.ok && upstreamResult.output) {
    const delta = runGit(projectPath, [
      'rev-list',
      '--left-right',
      '--count',
      'HEAD...@{upstream}',
    ]);
    if (delta.ok) {
      const [aheadRaw, behindRaw] = delta.output.split(/\s+/);
      const aheadValue = Number(aheadRaw);
      const behindValue = Number(behindRaw);
      if (Number.isFinite(aheadValue)) ahead = aheadValue;
      if (Number.isFinite(behindValue)) behind = behindValue;
    }
  }

  const head = headResult.ok ? headResult.output : undefined;
  const branch =
    branchResult.ok && branchResult.output
      ? branchResult.output
      : head
        ? `detached@${head}`
        : undefined;

  return {
    available: true,
    isRepository: true,
    ...(branch ? { branch } : {}),
    ...(head ? { head } : {}),
    ...(upstreamResult.ok && upstreamResult.output ? { upstream: upstreamResult.output } : {}),
    ...(ahead !== undefined ? { ahead } : {}),
    ...(behind !== undefined ? { behind } : {}),
    clean: rawChanges.length === 0,
    changes,
    ...(lastCommitResult.ok && lastCommitResult.output
      ? { lastCommit: lastCommitResult.output }
      : {}),
  };
}

function buildHandoffText(
  project: LocalProjectProfile,
  git: LocalProjectContextGit,
  files: LocalProjectContextFile[],
  generatedAt: number,
): string {
  const lines: string[] = [
    '# ASProOps Project Handoff Context',
    '',
    'Use this snapshot as transfer context for continuing work on the project.',
    'Verify live project files before making changes because this snapshot can become stale.',
    '',
    '## Project',
    `- Name: ${project.name}`,
    `- Path: ${project.path}`,
    `- Generated: ${new Date(generatedAt).toISOString()}`,
    '',
    '## Git Snapshot',
  ];

  if (!git.available) {
    lines.push('- Git: executable not available');
  } else if (!git.isRepository) {
    lines.push('- Git: project path is not a Git repository');
  } else {
    lines.push(`- Branch: ${git.branch ?? 'unknown'}`);
    lines.push(`- HEAD: ${git.head ?? 'unknown'}`);
    lines.push(`- Upstream: ${git.upstream ?? 'none'}`);
    if (git.ahead !== undefined || git.behind !== undefined) {
      lines.push(`- Ahead/Behind: ${git.ahead ?? 0}/${git.behind ?? 0}`);
    }
    lines.push(`- Working tree: ${git.clean ? 'clean' : 'has changes'}`);
    if (git.lastCommit) lines.push(`- Last commit: ${git.lastCommit}`);

    if (git.changes.length > 0) {
      lines.push('', '### Working Tree Changes');
      lines.push(...git.changes.map((entry) => `- ${entry}`));
    }
  }

  lines.push('', '## Project Context Documents');

  if (files.length === 0) {
    lines.push(
      'No allowlisted project context document was found.',
      'Read the live repository before inferring requirements or project state.',
    );
  } else {
    for (const file of files) {
      lines.push('');
      lines.push(`### ${file.path}${file.truncated ? ' [bounded excerpt]' : ''}`);
      lines.push(`--- BEGIN ${file.path} ---`);
      lines.push(file.content.trim());
      lines.push(`--- END ${file.path} ---`);
    }
  }

  lines.push(
    '',
    '## Continuation Rule',
    'Continue from the project state above. Preserve explicit project decisions and constraints.',
    'Do not invent requirements that are not supported by the repository context.',
  );

  return lines.join('\n');
}

export function buildLocalProjectContext(
  project: LocalProjectProfile,
): LocalProjectContextResult {
  const generatedAt = Date.now();
  const git = collectGit(project.path);
  const files = collectContextFiles(project.path);

  return {
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    generatedAt,
    git,
    files,
    handoffText: buildHandoffText(project, git, files, generatedAt),
  };
}

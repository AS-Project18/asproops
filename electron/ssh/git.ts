import type { SessionChannels } from './connection-manager';
import type { GitAction, GitFileStatus, GitStatus } from '../../src/shared/types';

/**
 * Status git satu working directory di server — dibaca dengan satu perintah
 * gabungan (pola sama seperti monitor.ts) supaya cuma satu round-trip SSH,
 * bukan lima perintah terpisah yang masing-masing kena latensi jaringan.
 */

const SECTION = '@@';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function splitSections(stdout: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = stdout.split(new RegExp(`\\n?${SECTION}(\\w+)${SECTION}\\n`));
  for (let i = 1; i < parts.length; i += 2) {
    sections.set(parts[i], parts[i + 1] ?? '');
  }
  return sections;
}

/** exit 9 = path tidak ada; exit 8 = ada tapi bukan git repo (atau git tidak terpasang). */
function buildStatusCommand(path: string): string {
  const quoted = shellQuote(path);
  return [
    `cd -- ${quoted} || exit 9`,
    'git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 8',
    `__s(){ printf '\\n${SECTION}%s${SECTION}\\n' "$1"; }`,
    '__s BRANCH; git rev-parse --abbrev-ref HEAD 2>/dev/null',
    '__s UPSTREAM; git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null',
    '__s AHEADBEHIND; git rev-list --left-right --count @{u}...HEAD 2>/dev/null',
    "__s COMMIT; git log -1 --format='%H%x1f%an%x1f%ar%x1f%s' 2>/dev/null",
    '__s STATUS; git status --porcelain=v1 2>/dev/null',
    '__s REMOTEURL; git remote get-url origin 2>/dev/null',
  ].join('; ');
}

export async function getGitStatus(connection: SessionChannels, path: string): Promise<GitStatus> {
  const { stdout, code } = await connection.exec(buildStatusCommand(path));

  if (code === 9) throw new Error(`Path tidak ditemukan di server: ${path}`);
  if (code === 8) return { isRepo: false, files: [] };

  const sections = splitSections(stdout);

  const branch = (sections.get('BRANCH') ?? '').trim() || undefined;
  const upstream = (sections.get('UPSTREAM') ?? '').trim() || undefined;

  const aheadBehindRaw = (sections.get('AHEADBEHIND') ?? '').trim();
  let ahead: number | undefined;
  let behind: number | undefined;
  if (aheadBehindRaw) {
    // `rev-list --left-right --count @{u}...HEAD` -> "<hanya-di-upstream> <hanya-di-HEAD>".
    const [behindStr, aheadStr] = aheadBehindRaw.split(/\s+/);
    behind = Number(behindStr) || 0;
    ahead = Number(aheadStr) || 0;
  }

  const commitRaw = (sections.get('COMMIT') ?? '').trim();
  let lastCommit: GitStatus['lastCommit'];
  if (commitRaw) {
    const [hash, author, relativeDate, ...subjectParts] = commitRaw.split('\x1f');
    lastCommit = { hash, author, relativeDate, subject: subjectParts.join('\x1f') };
  }

  const files: GitFileStatus[] = (sections.get('STATUS') ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }));

  const remoteUrl = (sections.get('REMOTEURL') ?? '').trim() || undefined;

  return { isRepo: true, branch, upstream, ahead, behind, lastCommit, files, remoteUrl };
}

const ALLOWED_ACTIONS: readonly GitAction[] = ['fetch', 'pull'];

/** Sengaja hanya fetch/pull — push butuh kredensial/akses tulis yang jauh lebih riskan untuk dipicu dari UI. */
export async function runGitAction(
  connection: SessionChannels,
  path: string,
  action: GitAction,
): Promise<string> {
  if (!ALLOWED_ACTIONS.includes(action)) {
    throw new Error(`Aksi tidak dikenal: ${action}`);
  }

  const quoted = shellQuote(path);
  const { stdout, stderr, code } = await connection.exec(`cd -- ${quoted} && git ${action} 2>&1`);
  if (code !== 0) throw new Error((stdout || stderr || `git ${action} gagal.`).trim());
  return stdout.trim();
}

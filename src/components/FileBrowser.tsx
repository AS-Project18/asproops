import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RemoteFile, TransferProgress } from '../shared/types';
import type { EditStatus } from '../../electron/ssh/remote-edit';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { formatBytes, formatDate } from '../lib/format';

/**
 * Browser berkas SFTP.
 *
 * Daftar berkasnya divirtualisasi — hanya baris yang terlihat yang dirender.
 * Direktori seperti /var/spool atau folder unggahan bisa berisi puluhan ribu
 * entri, dan merendernya sekaligus membekukan aplikasi.
 */

type SortKey = 'name' | 'size' | 'modified';

const ROW_HEIGHT = 26;
/** Di atas jumlah ini, tampilkan peringatan agar pengguna memakai penyaring. */
const CROWDED_THRESHOLD = 2000;

function parentOf(path: string): string {
  if (path === '/') return '/';
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(0, trimmed.lastIndexOf('/')) || '/';
}

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

function breadcrumbs(path: string): Array<{ label: string; path: string }> {
  const crumbs = [{ label: '/', path: '/' }];
  let current = '';
  for (const segment of path.split('/').filter(Boolean)) {
    current += `/${segment}`;
    crumbs.push({ label: segment, path: current });
  }
  return crumbs;
}

interface FileBrowserProps {
  sessionId: string;
}

export function FileBrowser({ sessionId }: FileBrowserProps) {
  const [path, setPath] = useState('/');
  const [pathInput, setPathInput] = useState('/');
  const [homePath, setHomePath] = useState('/');
  const [followTerminal, setFollowTerminal] = useState(true);
  const [entries, setEntries] = useState<RemoteFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [ascending, setAscending] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState('');
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});
  const [edits, setEdits] = useState<Record<string, EditStatus>>({});
  const [pendingDelete, setPendingDelete] = useState<RemoteFile | null>(null);
  const [renaming, setRenaming] = useState<{ file: RemoteFile; value: string } | null>(null);

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      try {
        let resolvedTarget = target.trim() || '/';

        if (resolvedTarget === '~') {
          resolvedTarget = homePath;
        } else if (resolvedTarget.startsWith('~/')) {
          resolvedTarget = `${homePath.replace(/\/$/, '')}/${resolvedTarget.slice(2)}`;
        }

        if (!resolvedTarget.startsWith('/')) {
          resolvedTarget = await window.ssh.sftp.realpath(sessionId, resolvedTarget);
        }

        setEntries(await window.ssh.sftp.list(sessionId, resolvedTarget));
        setPath(resolvedTarget);
        setPathInput(resolvedTarget);
        setFilter('');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, homePath],
  );

  useEffect(() => {
    let cancelled = false;

    void window.ssh.sftp
      .realpath(sessionId, '.')
      .then((resolvedHome) => {
        if (cancelled) return;
        setHomePath(resolvedHome);
        setPath(resolvedHome);
        setPathInput(resolvedHome);
        return load(resolvedHome);
      })
      .catch(() => {
        if (!cancelled) void load('/');
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const handleTerminalCwd = (event: Event) => {
      if (!followTerminal) return;
      const detail = (event as CustomEvent<{ sessionId: string; cwd: string }>).detail;
      if (!detail || detail.sessionId !== sessionId) return;

      let target = detail.cwd;
      if (target === '~') target = homePath;
      else if (target.startsWith('~/')) {
        target = `${homePath.replace(/\/$/, '')}/${target.slice(2)}`;
      }

      if (target.startsWith('/') && target !== path) {
        void load(target);
      }
    };

    window.addEventListener('asprossh:terminal-cwd', handleTerminalCwd);
    return () => window.removeEventListener('asprossh:terminal-cwd', handleTerminalCwd);
  }, [followTerminal, homePath, load, path, sessionId]);

  useEffect(
    () =>
      window.ssh.sftp.onProgress((progress) => {
        setTransfers((prev) => ({ ...prev, [progress.transferId]: progress }));
        if (progress.transferredBytes >= progress.totalBytes) {
          // Sisakan sebentar supaya bilah 100% sempat terlihat.
          setTimeout(
            () =>
              setTransfers((prev) => {
                const { [progress.transferId]: _done, ...rest } = prev;
                return rest;
              }),
            1500,
          );
        }
      }),
    [],
  );

  useEffect(() => {
    void window.ssh.edit.list(sessionId).then((active) =>
      setEdits(Object.fromEntries(active.map((status) => [status.editId, status]))),
    );

    return window.ssh.edit.onStatus((status) => {
      if (status.sessionId !== sessionId) return;
      setEdits((prev) => ({ ...prev, [status.editId]: status }));
      if (status.state === 'error') setError(status.message ?? 'Edit gagal.');
    });
  }, [sessionId]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let result = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'));
    if (needle) result = result.filter((e) => e.name.toLowerCase().includes(needle));

    const direction = ascending ? 1 : -1;
    return result.sort((a, b) => {
      // Direktori selalu di atas, apa pun kunci pengurutannya.
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      switch (sortKey) {
        case 'size':
          return (a.sizeBytes - b.sizeBytes) * direction;
        case 'modified':
          return (a.modifiedAt - b.modifiedAt) * direction;
        default:
          return a.name.localeCompare(b.name) * direction;
      }
    });
  }, [entries, sortKey, ascending, showHidden, filter]);

  const rows = useVirtualRows({ count: visible.length, rowHeight: ROW_HEIGHT });
  const { scrollToTop } = rows;

  // Mengubah penyaring atau urutan harus mengembalikan gulir ke atas, kalau
  // tidak pengguna mendarat di tengah daftar yang isinya sudah berbeda.
  useEffect(() => scrollToTop(), [filter, sortKey, ascending, path, scrollToTop]);

  const goToPath = () => {
    void load(pathInput);
  };

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setAscending((prev) => !prev);
    else {
      setSortKey(key);
      setAscending(true);
    }
  };

  const handleDownload = async (file: RemoteFile) => {
    const localPath = await window.ssh.dialog.pickDownload(file.name);
    if (!localPath) return;
    try {
      await window.ssh.sftp.download(sessionId, file.path, localPath, file.sizeBytes);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleUpload = async () => {
    const localPaths = await window.ssh.dialog.pickUpload();
    try {
      for (const localPath of localPaths) {
        const name = localPath.split(/[\\/]/).pop() ?? 'berkas';
        await window.ssh.sftp.upload(sessionId, localPath, joinPath(path, name));
      }
      if (localPaths.length > 0) await load(path);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleEdit = async (file: RemoteFile) => {
    try {
      await window.ssh.edit.open(sessionId, file.path, file.sizeBytes);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleStopEdit = async (editId: string) => {
    await window.ssh.edit.close(editId);
    setEdits((prev) => {
      const { [editId]: _closed, ...rest } = prev;
      return rest;
    });
  };

  const handleDelete = async (file: RemoteFile) => {
    try {
      await window.ssh.sftp.remove(sessionId, file.path, file.isDirectory);
      setPendingDelete(null);
      await load(path);
    } catch (err) {
      setError((err as Error).message);
      setPendingDelete(null);
    }
  };

  const handleRename = async () => {
    if (!renaming) return;
    try {
      await window.ssh.sftp.rename(sessionId, renaming.file.path, joinPath(path, renaming.value));
      setRenaming(null);
      await load(path);
    } catch (err) {
      setError((err as Error).message);
      setRenaming(null);
    }
  };

  const activeTransfers = Object.values(transfers);
  const activeEdits = Object.values(edits);
  const crowded = entries.length > CROWDED_THRESHOLD;

  return (
    <div className="aspro-file-browser flex h-full flex-col bg-abyss">
      <div className="aspro-file-toolbar border-b border-line">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            onClick={() => void load(parentOf(path))}
            disabled={path === '/'}
            title="Naik satu tingkat"
            className="aspro-file-icon"
          >
            ↑
          </button>

          <button
            onClick={() => void load(homePath)}
            title="Home"
            className="aspro-file-icon"
          >
            ⌂
          </button>

          <form
            className="aspro-path-box min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              goToPath();
            }}
          >
            <span className="text-orange">▱</span>
            <input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              onFocus={() => setFollowTerminal(false)}
              aria-label="Path remote"
              spellCheck={false}
            />
            <button type="submit" title="Buka path">↵</button>
          </form>

          <button
            onClick={() => void load(path)}
            title="Muat ulang"
            className="aspro-file-icon"
          >
            ⟳
          </button>
        </div>

        <div className="aspro-file-toolbar-actions">
          <button
            onClick={() => setFollowTerminal((value) => !value)}
            className={`aspro-follow-button ${followTerminal ? 'active' : ''}`}
            title="Ikuti direktori terminal jika prompt menampilkan path"
          >
            {followTerminal ? '⌁ Follow Terminal' : '⌁ Follow Off'}
          </button>

          <label className="aspro-hidden-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            <span>Hidden</span>
          </label>

          <button onClick={() => void handleUpload()} className="aspro-file-upload">
            ⇧ Unggah
          </button>
        </div>
      </div>

      <div className="aspro-file-subbar">
        <nav className="flex min-w-0 flex-1 items-center overflow-x-auto font-mono text-[9px]">
          {breadcrumbs(path).map((crumb, index, all) => (
            <span key={crumb.path} className="flex shrink-0 items-center">
              <button
                onClick={() => void load(crumb.path)}
                className={index === all.length - 1 ? 'text-orange' : 'text-muted hover:text-fg'}
              >
                {crumb.label}
              </button>
              {index < all.length - 1 && index > 0 && <span className="mx-0.5 text-ghost">/</span>}
            </span>
          ))}
        </nav>

        <div className="aspro-file-filter">
          <span>⌕</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter..."
            aria-label="Saring nama berkas"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 border-b border-line bg-danger-surface px-4 py-2 text-xs text-coral">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-muted hover:text-fg">
            ✕
          </button>
        </div>
      )}

      {crowded && !filter && (
        <p className="border-b border-line bg-panel px-4 py-1.5 text-xs text-amber">
          Direktori ini berisi {entries.length.toLocaleString('id-ID')} entri. Gunakan kolom
          saring untuk mempersempit.
        </p>
      )}

      <div className="aspro-file-head flex shrink-0 border-b border-line bg-panel px-3 py-1.5 text-[9px] text-faint">
        <SortHeader
          className="flex-1"
          active={sortKey === 'name'}
          ascending={ascending}
          onClick={() => handleSort('name')}
        >
          Nama
        </SortHeader>
        <SortHeader
          className="w-16 text-right"
          active={sortKey === 'size'}
          ascending={ascending}
          onClick={() => handleSort('size')}
        >
          Ukuran
        </SortHeader>
        <SortHeader
          className="w-28 pl-3"
          active={sortKey === 'modified'}
          ascending={ascending}
          onClick={() => handleSort('modified')}
        >
          Diubah
        </SortHeader>
        <span className="w-12 pl-3">Izin</span>
        <span className="w-14" />
      </div>

      <div
        ref={rows.scrollRef}
        onScroll={rows.onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        role="grid"
        aria-rowcount={visible.length}
      >
        {loading ? (
          <p className="p-8 text-center text-sm text-faint">Memuat…</p>
        ) : visible.length === 0 ? (
          <p className="p-8 text-center text-sm text-faint">
            {filter
              ? `Tidak ada yang cocok dengan "${filter}".`
              : entries.length > 0
                ? 'Semua isi direktori ini tersembunyi. Centang "Tersembunyi" untuk melihatnya.'
                : 'Direktori ini kosong.'}
          </p>
        ) : (
          <div style={{ height: rows.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${rows.offsetY}px)` }}>
              {visible.slice(rows.startIndex, rows.endIndex).map((file) => (
                <div
                  key={file.path}
                  role="row"
                  style={{ height: ROW_HEIGHT }}
                  className="aspro-file-row group flex items-center border-b border-line-soft px-3 text-[10px] hover:bg-hover"
                >
                  <div className="min-w-0 flex-1">
                    {renaming?.file.path === file.path ? (
                      <input
                        value={renaming.value}
                        autoFocus
                        onChange={(e) => setRenaming({ file, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={() => setRenaming(null)}
                        className="w-full rounded border border-azure bg-abyss px-2 py-0.5 font-mono text-xs text-fg focus:outline-none"
                      />
                    ) : (
                      <button
                        onDoubleClick={() => file.isDirectory && void load(file.path)}
                        className="flex w-full items-center gap-2 truncate text-left font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                      >
                        <FileTypeIcon file={file} />
                        <span className={`truncate ${file.isDirectory ? 'text-azure' : 'text-dim'}`}>
                          {file.name}
                        </span>
                      </button>
                    )}
                  </div>

                  <span className="w-16 shrink-0 text-right font-mono text-faint">
                    {file.isDirectory ? '—' : formatBytes(file.sizeBytes)}
                  </span>
                  <span className="w-28 shrink-0 pl-3 font-mono text-faint">
                    {formatDate(file.modifiedAt)}
                  </span>
                  <span className="w-12 shrink-0 pl-3 font-mono text-faint">{file.mode}</span>

                  <div className="flex w-14 shrink-0 justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {!file.isDirectory && (
                      <>
                        <RowButton label="Buka di editor" onClick={() => void handleEdit(file)}>
                          ✐
                        </RowButton>
                        <RowButton label="Unduh" onClick={() => void handleDownload(file)}>
                          ↓
                        </RowButton>
                      </>
                    )}
                    <RowButton
                      label="Ganti nama"
                      onClick={() => setRenaming({ file, value: file.name })}
                    >
                      ✎
                    </RowButton>
                    <RowButton label="Hapus" onClick={() => setPendingDelete(file)}>
                      ✕
                    </RowButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {activeEdits.length > 0 && (
        <div className="border-t border-line bg-panel px-4 py-2.5">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-faint">Sedang diedit</h3>
          <div className="space-y-1.5">
            {activeEdits.map((edit) => (
              <div key={edit.editId} className="flex items-center gap-3 text-xs">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    edit.state === 'uploading'
                      ? 'animate-pulse bg-amber'
                      : edit.state === 'error'
                        ? 'bg-coral'
                        : 'bg-mint'
                  }`}
                />
                <span className="truncate font-mono text-dim">{edit.remotePath}</span>
                <span className="ml-auto shrink-0 text-faint">{editLabel(edit)}</span>
                <button
                  onClick={() => void handleStopEdit(edit.editId)}
                  className="shrink-0 rounded px-2 py-0.5 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                >
                  Selesai
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTransfers.length > 0 && (
        <div className="space-y-2 border-t border-line bg-panel px-4 py-3">
          {activeTransfers.map((transfer) => {
            const percent =
              transfer.totalBytes > 0
                ? (transfer.transferredBytes / transfer.totalBytes) * 100
                : 0;
            return (
              <div key={transfer.transferId}>
                <div className="mb-1 flex justify-between font-mono text-xs">
                  <span className="truncate text-dim">
                    {transfer.direction === 'download' ? '↓' : '↑'} {transfer.filename}
                  </span>
                  <span className="ml-3 shrink-0 text-faint">
                    {formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.totalBytes)}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-active">
                  <div
                    className="h-full bg-mint transition-[width] duration-200"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-line px-4 py-1.5 text-xs text-faint">
        {visible.length.toLocaleString('id-ID')} item
        {visible.length !== entries.length && ` dari ${entries.length.toLocaleString('id-ID')}`}
        {' · klik ganda direktori untuk masuk'}
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="text-sm font-semibold text-fg">
              Hapus {pendingDelete.isDirectory ? 'direktori' : 'berkas'} ini?
            </h2>
            <p className="mt-2 break-all font-mono text-xs text-muted">{pendingDelete.path}</p>
            <p className="mt-3 text-xs text-coral">
              Berkas dihapus permanen di server — tidak masuk keranjang sampah dan tidak bisa
              dikembalikan.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                Batal
              </button>
              <button
                onClick={() => void handleDelete(pendingDelete)}
                className="rounded bg-coral px-4 py-2 text-sm font-medium text-abyss hover:bg-coral-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


type FileIconKind =
  | 'folder'
  | 'link'
  | 'code'
  | 'config'
  | 'image'
  | 'archive'
  | 'database'
  | 'document'
  | 'log'
  | 'script'
  | 'file';

function fileIconKind(file: RemoteFile): FileIconKind {
  if (file.isDirectory) return 'folder';
  if (file.isSymlink) return 'link';

  const lower = file.name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';

  if (['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'].includes(ext)) return 'script';
  if (
    ['js', 'jsx', 'ts', 'tsx', 'vue', 'php', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs'].includes(ext)
  ) {
    return 'code';
  }
  if (
    ['conf', 'config', 'ini', 'env', 'yaml', 'yml', 'toml', 'json', 'xml', 'properties'].includes(ext) ||
    ['dockerfile', 'makefile', '.env'].includes(lower)
  ) {
    return 'config';
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return 'image';
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) return 'archive';
  if (['db', 'sqlite', 'sqlite3', 'sql'].includes(ext)) return 'database';
  if (['md', 'txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv'].includes(ext)) return 'document';
  if (['log', 'out', 'err'].includes(ext)) return 'log';
  return 'file';
}

function FileTypeIcon({ file }: { file: RemoteFile }) {
  const kind = fileIconKind(file);

  if (kind === 'folder') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden className="aspro-file-type-icon folder">
        <path d="M2.2 4.2c0-.7.6-1.2 1.2-1.2h4l1.4 1.6h5.8c.7 0 1.2.5 1.2 1.2v7.4c0 .9-.7 1.6-1.6 1.6H3.8c-.9 0-1.6-.7-1.6-1.6z" />
        <path d="M2.5 6.1h13" />
      </svg>
    );
  }

  if (kind === 'link') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden className="aspro-file-type-icon link">
        <path d="M7.1 10.9 5.7 12.3a2.5 2.5 0 0 1-3.5-3.5l2.1-2.1a2.5 2.5 0 0 1 3.5 0" />
        <path d="m10.9 7.1 1.4-1.4a2.5 2.5 0 1 1 3.5 3.5l-2.1 2.1a2.5 2.5 0 0 1-3.5 0" />
        <path d="m6.7 11.3 4.6-4.6" />
      </svg>
    );
  }

  const glyph: Record<Exclude<FileIconKind, 'folder' | 'link'>, string> = {
    code: '</>',
    config: '⚙',
    image: '▧',
    archive: 'ZIP',
    database: 'DB',
    document: 'TXT',
    log: 'LOG',
    script: '>_',
    file: '•',
  };

  return (
    <span aria-hidden className={`aspro-file-type-badge ${kind}`}>
      {glyph[kind]}
    </span>
  );
}


function editLabel(edit: EditStatus): string {
  switch (edit.state) {
    case 'uploading':
      return 'mengunggah…';
    case 'error':
      return 'gagal';
    case 'saved':
      return edit.savedAt
        ? `tersimpan ${new Date(edit.savedAt).toLocaleTimeString('id-ID')}`
        : 'tersimpan';
    default:
      return 'memantau perubahan';
  }
}

function SortHeader({
  active,
  ascending,
  onClick,
  className,
  children,
}: {
  active: boolean;
  ascending: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={className}>
      <button
        onClick={onClick}
        className="hover:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
      >
        {children}
        {active && <span className="ml-1">{ascending ? '↑' : '↓'}</span>}
      </button>
    </span>
  );
}

function RowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded px-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
    >
      {children}
    </button>
  );
}

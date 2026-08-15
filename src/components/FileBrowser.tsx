import type {
  CSSProperties,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RemoteFile, TransferProgress } from '../shared/types';
import type { EditStatus } from '../../electron/ssh/remote-edit';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { useI18n } from '../i18n';
import { formatBytes, formatDate } from '../lib/format';

/**
 * Browser berkas SFTP.
 *
 * Daftar berkasnya divirtualisasi — hanya baris yang terlihat yang dirender.
 * Direktori seperti /var/spool atau folder unggahan bisa berisi puluhan ribu
 * entri, dan merendernya sekaligus membekukan aplikasi.
 */

type SortKey = 'name' | 'size' | 'modified';
type ColumnId = 'size' | 'modified' | 'permissions' | 'owner' | 'group';
type TFunc = ReturnType<typeof useI18n>['t'];

interface ColumnState {
  id: ColumnId;
  width: number;
  visible: boolean;
}

const ROW_HEIGHT = 26;
/** Di atas jumlah ini, tampilkan peringatan agar pengguna memakai penyaring. */
const CROWDED_THRESHOLD = 2000;

// Cuma batas bawah secukupnya (biar handle-nya tidak collapse total dan hilang
// tak bisa dipegang lagi) — tidak ada batas atas, dan resize satu kolom tidak
// pernah mengubah ukuran kolom lain.
const MIN_COL_WIDTH = 32;
const NAME_MIN_WIDTH = 32;
const NAME_DEFAULT_WIDTH = 220;
const CHECKBOX_COL_WIDTH = 24;

const NAME_WIDTH_STORAGE_KEY = 'asprossh.sftpNameWidth';

function loadNameWidth(): number {
  const raw = Number(localStorage.getItem(NAME_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return NAME_DEFAULT_WIDTH;
  return Math.max(NAME_MIN_WIDTH, raw);
}

const COLUMN_STORAGE_KEY = 'asprossh.sftpColumns';
const DEFAULT_COLUMNS: ColumnState[] = [
  { id: 'size', width: 76, visible: true },
  { id: 'modified', width: 132, visible: true },
  { id: 'permissions', width: 60, visible: true },
  { id: 'owner', width: 64, visible: false },
  { id: 'group', width: 64, visible: false },
];

function loadColumns(): ColumnState[] {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const saved = JSON.parse(raw) as ColumnState[];
    const validIds = new Set(DEFAULT_COLUMNS.map((c) => c.id));
    const savedValid = saved.filter((c) => validIds.has(c.id));
    // Kolom baru dari update aplikasi (belum ada di config tersimpan)
    // ditambahkan di akhir supaya tetap muncul.
    const missing = DEFAULT_COLUMNS.filter((def) => !savedValid.some((c) => c.id === def.id));
    return [...savedValid, ...missing].map((c) => ({
      ...c,
      width: Math.max(MIN_COL_WIDTH, c.width),
    }));
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function columnLabelKey(id: ColumnId) {
  switch (id) {
    case 'size':
      return 'sftp.columnSize' as const;
    case 'modified':
      return 'sftp.columnModified' as const;
    case 'permissions':
      return 'sftp.columnPermissions' as const;
    case 'owner':
      return 'sftp.columnOwner' as const;
    case 'group':
      return 'sftp.columnGroup' as const;
  }
}

function columnValue(id: ColumnId, file: RemoteFile): string {
  switch (id) {
    case 'size':
      return file.isDirectory ? '—' : formatBytes(file.sizeBytes);
    case 'modified':
      return formatDate(file.modifiedAt);
    case 'permissions':
      return file.mode;
    case 'owner':
      return String(file.owner);
    case 'group':
      return String(file.group);
  }
}

function parentOf(path: string): string {
  if (path === '/') return '/';
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(0, trimmed.lastIndexOf('/')) || '/';
}

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

type ConflictDecision = { action: 'overwrite' | 'skip' | 'rename'; applyToAll: boolean } | null;

/** "foto.jpg" -> "foto (1).jpg" -> "foto (2).jpg" ... sampai ketemu nama yang belum dipakai. */
function uniqueRemoteName(name: string, existing: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  let attempt = 1;
  while (existing.has(candidate)) {
    candidate = `${base} (${attempt})${ext}`;
    attempt += 1;
  }
  return candidate;
}

interface FileBrowserProps {
  sessionId: string;
}

export function FileBrowser({ sessionId }: FileBrowserProps) {
  const { t, language } = useI18n();
  const locale = language === 'en' ? 'en-US' : 'id-ID';

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
  const [pendingDelete, setPendingDelete] = useState<RemoteFile[] | null>(null);
  const [renaming, setRenaming] = useState<{ file: RemoteFile; value: string } | null>(null);
  const [infoFile, setInfoFile] = useState<RemoteFile | null>(null);

  const [columns, setColumns] = useState<ColumnState[]>(loadColumns);
  const [nameWidth, setNameWidth] = useState<number>(loadNameWidth);
  const [draggingCol, setDraggingCol] = useState<ColumnId | null>(null);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    files: RemoteFile[];
  } | null>(null);

  const [uploadConflict, setUploadConflict] = useState<{
    name: string;
    resolve: (decision: ConflictDecision) => void;
  } | null>(null);
  const [applyConflictToAll, setApplyConflictToAll] = useState(false);

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    localStorage.setItem(NAME_WIDTH_STORAGE_KEY, String(nameWidth));
  }, [nameWidth]);

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

  // Sesi seleksi tidak boleh menyeberang direktori — file yang terpilih di
  // direktori sebelumnya sudah tidak relevan begitu daftar berkas berganti.
  useEffect(() => {
    setSelected(new Set());
    setSelectionAnchor(null);
  }, [path]);

  useEffect(() => {
    if (!contextMenu && !columnsMenuOpen && selected.size === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (contextMenu) setContextMenu(null);
      else if (columnsMenuOpen) setColumnsMenuOpen(false);
      else setSelected(new Set());
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contextMenu, columnsMenuOpen, selected.size]);

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

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);
  // Lebar total minimum tabel. Kolom-kolom fixed-width tidak boleh memeras
  // kolom Nama saat panel menyempit (mis. sidebar di-resize) — begitu lebar
  // panel kurang dari ini, tabel digulir horizontal, bukan diperas.
  const totalMinWidth = useMemo(
    () => CHECKBOX_COL_WIDTH + nameWidth + visibleColumns.reduce((sum, c) => sum + c.width, 0),
    [visibleColumns, nameWidth],
  );
  const selectedFiles = useMemo(
    () => entries.filter((f) => selected.has(f.path)),
    [entries, selected],
  );

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

  const toggleColumnVisibility = (id: ColumnId) => {
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
  };

  const startColumnResize = (event: ReactPointerEvent, colId: ColumnId | 'name') => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const min = colId === 'name' ? NAME_MIN_WIDTH : MIN_COL_WIDTH;
    const startWidth = colId === 'name' ? nameWidth : columns.find((c) => c.id === colId)?.width;
    if (startWidth === undefined) return;

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(min, startWidth + (moveEvent.clientX - startX));
      if (colId === 'name') setNameWidth(next);
      else setColumns((prev) => prev.map((c) => (c.id === colId ? { ...c, width: next } : c)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const resetColumnWidth = (colId: ColumnId | 'name') => {
    if (colId === 'name') {
      setNameWidth(NAME_DEFAULT_WIDTH);
      return;
    }
    const def = DEFAULT_COLUMNS.find((c) => c.id === colId);
    if (def) setColumns((prev) => prev.map((c) => (c.id === colId ? { ...c, width: def.width } : c)));
  };

  const reorderColumns = (draggedId: ColumnId, targetId: ColumnId) => {
    if (draggedId === targetId) return;
    setColumns((prev) => {
      const next = [...prev];
      const from = next.findIndex((c) => c.id === draggedId);
      const to = next.findIndex((c) => c.id === targetId);
      if (from === -1 || to === -1) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const toggleFileSelection = (filePath: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
    setSelectionAnchor(filePath);
  };

  const handleRowClick = (event: ReactMouseEvent, file: RemoteFile, index: number) => {
    if (event.shiftKey && selectionAnchor) {
      const anchorIndex = visible.findIndex((f) => f.path === selectionAnchor);
      if (anchorIndex !== -1) {
        const [start, end] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        setSelected(new Set(visible.slice(start, end + 1).map((f) => f.path)));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      toggleFileSelection(file.path);
      return;
    }
    setSelected(new Set([file.path]));
    setSelectionAnchor(file.path);
  };

  const handleContextMenu = (event: ReactMouseEvent, file: RemoteFile) => {
    event.preventDefault();
    let files: RemoteFile[];
    if (selected.has(file.path) && selected.size > 1) {
      files = selectedFiles;
    } else {
      setSelected(new Set([file.path]));
      setSelectionAnchor(file.path);
      files = [file];
    }
    setContextMenu({ x: event.clientX, y: event.clientY, files });
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

  const askUploadConflict = (name: string): Promise<ConflictDecision> => {
    setApplyConflictToAll(false);
    return new Promise((resolve) => {
      setUploadConflict({
        name,
        resolve: (decision) => {
          setUploadConflict(null);
          resolve(decision);
        },
      });
    });
  };

  const handleUpload = async () => {
    const localPaths = await window.ssh.dialog.pickUpload();
    if (localPaths.length === 0) return;

    try {
      const sftpPrefs = await window.ssh.settings.sftpGet();
      const existingNames = new Set(entries.map((e) => e.name));
      // Kalau user pilih "terapkan untuk sisanya" di dialog konflik, ini
      // menimpa kebijakan pengaturan untuk sisa berkas di batch ini saja.
      let batchPolicy: 'overwrite' | 'skip' | 'rename' | null = null;
      let uploaded = 0;

      for (const localPath of localPaths) {
        const name = localPath.split(/[\\/]/).pop() ?? 'berkas';
        let targetName = name;

        if (existingNames.has(name)) {
          let action: 'overwrite' | 'skip' | 'rename' | null =
            batchPolicy ?? (sftpPrefs.uploadConflict !== 'ask' ? sftpPrefs.uploadConflict : null);
          if (!action) {
            const decision = await askUploadConflict(name);
            if (!decision) break; // dialog ditutup tanpa pilihan — hentikan sisa batch
            action = decision.action;
            if (decision.applyToAll) batchPolicy = action;
          }
          if (action === 'skip') continue;
          if (action === 'rename') targetName = uniqueRemoteName(name, existingNames);
        }

        await window.ssh.sftp.upload(sessionId, localPath, joinPath(path, targetName));
        existingNames.add(targetName);
        uploaded += 1;
      }

      if (uploaded > 0) await load(path);
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

  const handleDelete = async (files: RemoteFile[]) => {
    try {
      for (const file of files) {
        await window.ssh.sftp.remove(sessionId, file.path, file.isDirectory);
      }
      setPendingDelete(null);
      setSelected(new Set());
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
            title={t('sftp.up')}
            className="aspro-file-icon"
          >
            ↑
          </button>

          <button onClick={() => void load(homePath)} title={t('sftp.home')} className="aspro-file-icon">
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
              aria-label={t('sftp.pathLabel')}
              spellCheck={false}
            />
            <button type="submit" title={t('sftp.goPath')}>↵</button>
          </form>

          <button onClick={() => void load(path)} title={t('sftp.reload')} className="aspro-file-icon">
            ⟳
          </button>
        </div>

        <div className="aspro-file-toolbar-actions">
          <button
            onClick={() => setFollowTerminal((value) => !value)}
            className={`aspro-follow-button ${followTerminal ? 'active' : ''}`}
            title={t('sftp.followHelp')}
          >
            {followTerminal ? t('sftp.followOn') : t('sftp.followOff')}
          </button>

          <label className="aspro-hidden-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            <span>{t('sftp.hidden')}</span>
          </label>

          <div className="relative">
            <button
              onClick={() => setColumnsMenuOpen((v) => !v)}
              title={t('sftp.columns')}
              className="aspro-file-icon"
            >
              ▤
            </button>
            {columnsMenuOpen && (
              <ColumnMenu
                columns={columns}
                onToggle={toggleColumnVisibility}
                onClose={() => setColumnsMenuOpen(false)}
                t={t}
              />
            )}
          </div>

          <button onClick={() => void handleUpload()} className="aspro-file-upload">
            {t('sftp.upload')}
          </button>
        </div>
      </div>

      <div className="aspro-file-subbar">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="mr-0.5 shrink-0 font-mono text-[11px] text-faint">
            {selected.size > 0 ? t('sftp.selected', { count: selected.size }) : ''}
          </span>
          <ActionButton
            icon="edit"
            label={t('sftp.actionEdit')}
            disabled={!(selectedFiles.length === 1 && !selectedFiles[0].isDirectory)}
            onClick={() => void handleEdit(selectedFiles[0])}
          />
          <ActionButton
            icon="download"
            label={t('sftp.actionDownload')}
            disabled={!(selectedFiles.length === 1 && !selectedFiles[0].isDirectory)}
            onClick={() => void handleDownload(selectedFiles[0])}
          />
          <ActionButton
            icon="rename"
            label={t('sftp.actionRename')}
            disabled={selectedFiles.length !== 1}
            onClick={() => setRenaming({ file: selectedFiles[0], value: selectedFiles[0].name })}
          />
          <ActionButton
            icon="info"
            label={t('sftp.actionInfo')}
            disabled={selectedFiles.length !== 1}
            onClick={() => setInfoFile(selectedFiles[0])}
          />
          <ActionButton
            icon="delete"
            danger
            label={t('sftp.actionDelete')}
            disabled={selectedFiles.length === 0}
            onClick={() => setPendingDelete(selectedFiles)}
          />
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              title={t('sftp.clearSelection')}
              className="ml-0.5 shrink-0 rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
            >
              ✕
            </button>
          )}
        </div>

        <div className="aspro-file-filter">
          <span>⌕</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('sftp.filterPlaceholder')}
            aria-label={t('sftp.filterLabel')}
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
          {t('sftp.crowded', { count: entries.length.toLocaleString(locale) })}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
        <div
          className="aspro-file-head flex shrink-0 items-stretch gap-3 border-b border-line bg-panel px-3 py-1.5 text-[10px] text-faint"
          style={{ minWidth: totalMinWidth }}
        >
          <span className="flex w-6 shrink-0 items-center justify-center" />
          <div className="group relative flex shrink-0 items-center" style={{ width: nameWidth }}>
            <SortHeader
              active={sortKey === 'name'}
              ascending={ascending}
              onClick={() => handleSort('name')}
            >
              {t('sftp.columnName')}
            </SortHeader>
            <span
              onPointerDown={(e) => startColumnResize(e, 'name')}
              onDoubleClick={() => resetColumnWidth('name')}
              title={t('sftp.resetWidth')}
              className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-white/[0.04] opacity-0 group-hover:opacity-100 hover:bg-azure/50"
            />
          </div>
          {visibleColumns.map((col) => (
            <ColumnHeaderCell
              key={col.id}
              col={col}
              label={t(columnLabelKey(col.id))}
              sortable={col.id === 'size' || col.id === 'modified'}
              active={sortKey === col.id}
              ascending={ascending}
              onSort={() => handleSort(col.id as SortKey)}
              onDragStart={(e) => {
                setDraggingCol(col.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/asprossh-column', col.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const draggedId =
                  (e.dataTransfer.getData('text/asprossh-column') as ColumnId) || draggingCol;
                setDraggingCol(null);
                if (draggedId) reorderColumns(draggedId, col.id);
              }}
              onResetWidth={() => resetColumnWidth(col.id)}
              resetLabel={t('sftp.resetWidth')}
              onResizeStart={(e) => startColumnResize(e, col.id)}
            />
          ))}
        </div>

        <div
          ref={rows.scrollRef}
          onScroll={rows.onScroll}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden text-[11px]"
          style={{ minWidth: totalMinWidth }}
          role="grid"
          aria-rowcount={visible.length}
        >
          {loading ? (
            <p className="p-8 text-center text-sm text-faint">{t('sftp.loading')}</p>
          ) : visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-faint">
              {filter
                ? t('sftp.noMatch', { filter })
                : entries.length > 0
                  ? t('sftp.allHidden')
                  : t('sftp.emptyDir')}
            </p>
          ) : (
            <div style={{ height: rows.totalHeight, position: 'relative', minWidth: totalMinWidth }}>
              <div style={{ transform: `translateY(${rows.offsetY}px)` }}>
                {visible.slice(rows.startIndex, rows.endIndex).map((file, i) => {
                  const index = rows.startIndex + i;
                  const isSelected = selected.has(file.path);
                  return (
                    <div
                      key={file.path}
                      role="row"
                      aria-selected={isSelected}
                      style={{ height: ROW_HEIGHT, minWidth: totalMinWidth }}
                      onClick={(e) => handleRowClick(e, file, index)}
                      onContextMenu={(e) => handleContextMenu(e, file)}
                      className={`aspro-file-row flex items-center gap-3 border-b border-line-soft px-3 hover:bg-hover ${
                        isSelected ? 'bg-active' : ''
                      }`}
                    >
                      <span className="flex w-6 shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleFileSelection(file.path)}
                          className="accent-azure"
                        />
                      </span>

                      <div className="shrink-0 overflow-hidden" style={{ width: nameWidth }}>
                        {renaming?.file.path === file.path ? (
                          <input
                            value={renaming.value}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
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

                      {visibleColumns.map((col) => (
                        <span
                          key={col.id}
                          style={{ width: col.width }}
                          className={`shrink-0 truncate font-mono text-faint ${
                            col.id === 'size' ? 'text-right' : ''
                          }`}
                        >
                          {columnValue(col.id, file)}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {activeEdits.length > 0 && (
        <div className="border-t border-line bg-panel px-4 py-2.5">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-faint">
            {t('sftp.editingSection')}
          </h3>
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
                <span className="ml-auto shrink-0 text-faint">{editLabel(edit, t, locale)}</span>
                <button
                  onClick={() => void handleStopEdit(edit.editId)}
                  className="shrink-0 rounded px-2 py-0.5 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                >
                  {t('sftp.stopEdit')}
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
        {t('sftp.footerItems', { count: visible.length.toLocaleString(locale) })}
        {visible.length !== entries.length &&
          ` ${t('sftp.footerOf', { total: entries.length.toLocaleString(locale) })}`}
        {' · '}
        {t('sftp.footerHint')}
      </div>

      {pendingDelete && pendingDelete.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="text-sm font-semibold text-fg">
              {pendingDelete.length === 1
                ? t('sftp.deleteTitle', {
                    type: pendingDelete[0].isDirectory
                      ? t('sftp.typeDirectory')
                      : t('sftp.typeFile'),
                  })
                : t('sftp.deleteTitleMulti', { count: pendingDelete.length })}
            </h2>
            {pendingDelete.length === 1 && (
              <p className="mt-2 break-all font-mono text-xs text-muted">{pendingDelete[0].path}</p>
            )}
            <p className="mt-3 text-xs text-coral">{t('sftp.deleteWarning')}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('sftp.cancel')}
              </button>
              <button
                onClick={() => void handleDelete(pendingDelete)}
                className="rounded bg-coral px-4 py-2 text-sm font-medium text-abyss hover:bg-coral-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('sftp.actionDelete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="break-all text-sm font-semibold text-fg">
              {t('sftp.conflictTitle', { name: uploadConflict.name })}
            </h2>
            <p className="mt-2 text-xs text-muted">{t('sftp.conflictDesc')}</p>
            <label className="mt-4 flex items-center gap-2 text-xs text-dim">
              <input
                type="checkbox"
                checked={applyConflictToAll}
                onChange={(e) => setApplyConflictToAll(e.target.checked)}
                className="accent-azure"
              />
              {t('sftp.conflictApplyAll')}
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => uploadConflict.resolve(null)}
                className="rounded px-3 py-1.5 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('sftp.cancel')}
              </button>
              <button
                onClick={() =>
                  uploadConflict.resolve({ action: 'skip', applyToAll: applyConflictToAll })
                }
                className="rounded px-3 py-1.5 text-sm text-dim hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('settings.sftpConflictSkip')}
              </button>
              <button
                onClick={() =>
                  uploadConflict.resolve({ action: 'rename', applyToAll: applyConflictToAll })
                }
                className="rounded px-3 py-1.5 text-sm text-dim hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('settings.sftpConflictRename')}
              </button>
              <button
                onClick={() =>
                  uploadConflict.resolve({ action: 'overwrite', applyToAll: applyConflictToAll })
                }
                className="rounded bg-coral px-3 py-1.5 text-sm font-medium text-abyss hover:bg-coral-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('settings.sftpConflictOverwrite')}
              </button>
            </div>
          </div>
        </div>
      )}

      {infoFile && (
        <FileInfoDialog file={infoFile} onClose={() => setInfoFile(null)} t={t} locale={locale} />
      )}

      {contextMenu && (
        <FileContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onDownload={(file) => void handleDownload(file)}
          onEdit={(file) => void handleEdit(file)}
          onRename={(file) => setRenaming({ file, value: file.name })}
          onDelete={(files) => setPendingDelete(files)}
          onInfo={(file) => setInfoFile(file)}
          t={t}
        />
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


function editLabel(edit: EditStatus, t: TFunc, locale: string): string {
  switch (edit.state) {
    case 'uploading':
      return t('sftp.editUploading');
    case 'error':
      return t('sftp.editFailed');
    case 'saved':
      return edit.savedAt
        ? t('sftp.editSavedAt', { time: new Date(edit.savedAt).toLocaleTimeString(locale) })
        : t('sftp.editSaved');
    default:
      return t('sftp.editWatching');
  }
}

function SortHeader({
  active,
  ascending,
  onClick,
  className,
  style,
  children,
}: {
  active: boolean;
  ascending: boolean;
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <span className={className} style={style}>
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

function ColumnHeaderCell({
  col,
  label,
  sortable,
  active,
  ascending,
  onSort,
  onDragStart,
  onDrop,
  onResizeStart,
  onResetWidth,
  resetLabel,
}: {
  col: ColumnState;
  label: string;
  sortable: boolean;
  active: boolean;
  ascending: boolean;
  onSort: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onResizeStart: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onResetWidth: () => void;
  resetLabel: string;
}) {
  const justify = col.id === 'size' ? 'justify-end' : '';

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{ width: col.width }}
      className="group relative flex shrink-0 items-center"
    >
      {/* Grip ini satu-satunya area untuk drag-urutkan kolom, ditumpuk di
          atas label (posisi absolute) supaya tidak menggeser posisi teksnya
          — label harus sejajar persis dengan nilai di baris data di
          bawahnya. Dipisah juga dari tepi kanan (drag = resize) supaya
          ketiga gestur (sort/reorder/resize) tidak saling rebutan. */}
      <span
        draggable
        onDragStart={onDragStart}
        className="absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-3 cursor-grab items-center justify-center text-faint/15 opacity-0 group-hover:opacity-100 hover:text-dim active:cursor-grabbing"
      >
        ⠿
      </span>
      {sortable ? (
        <button
          onClick={onSort}
          className={`flex min-w-0 flex-1 items-center gap-1 truncate hover:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-azure ${justify}`}
        >
          <span className="truncate">{label}</span>
          {active && <span>{ascending ? '↑' : '↓'}</span>}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      <span
        draggable={false}
        onPointerDown={onResizeStart}
        onDoubleClick={onResetWidth}
        title={resetLabel}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-white/[0.04] opacity-0 group-hover:opacity-100 hover:bg-azure/50"
      />
    </div>
  );
}

function ColumnMenu({
  columns,
  onToggle,
  onClose,
  t,
}: {
  columns: ColumnState[];
  onToggle: (id: ColumnId) => void;
  onClose: () => void;
  t: TFunc;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full z-50 mt-1 min-w-[170px] rounded border border-line bg-raised p-2 text-xs shadow-lg">
        {columns.map((col) => (
          <label
            key={col.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-hover"
          >
            <input
              type="checkbox"
              checked={col.visible}
              onChange={() => onToggle(col.id)}
              className="accent-azure"
            />
            <span className="text-dim">{t(columnLabelKey(col.id))}</span>
          </label>
        ))}
      </div>
    </>
  );
}

type ActionIconKind = 'edit' | 'download' | 'rename' | 'info' | 'delete';

function ActionIcon({ kind }: { kind: ActionIconKind }) {
  switch (kind) {
    case 'edit':
      return (
        <svg viewBox="0 0 18 18" aria-hidden className="aspro-action-icon">
          <path d="M12.6 2.6a1.7 1.7 0 0 1 2.4 2.4L6.4 13.6l-3.4.9.9-3.4z" />
          <path d="M11 4.2l2.4 2.4" />
        </svg>
      );
    case 'download':
      return (
        <svg viewBox="0 0 18 18" aria-hidden className="aspro-action-icon">
          <path d="M9 2.5v8.2" />
          <path d="M5.4 7.4 9 11l3.6-3.6" />
          <path d="M3 14h12" />
        </svg>
      );
    case 'rename':
      return (
        <svg viewBox="0 0 18 18" aria-hidden className="aspro-action-icon">
          <path d="M9 3.2v11.6" />
          <path d="M6.2 3.2h5.6" />
          <path d="M6.2 14.8h5.6" />
        </svg>
      );
    case 'info':
      return (
        <svg viewBox="0 0 18 18" aria-hidden className="aspro-action-icon">
          <circle cx="9" cy="9" r="6.3" />
          <path d="M9 8.3v4.2" />
          <circle cx="9" cy="5.7" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'delete':
      return (
        <svg viewBox="0 0 18 18" aria-hidden className="aspro-action-icon">
          <path d="M3.2 5h11.6" />
          <path d="M7 5V3.6c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7V5" />
          <path d="M4.8 5l.6 8.4c0 .7.6 1.3 1.3 1.3h4.6c.7 0 1.3-.6 1.3-1.3L13.2 5" />
          <path d="M7.4 7.6v5" />
          <path d="M10.6 7.6v5" />
        </svg>
      );
  }
}

function ActionButton({
  icon,
  onClick,
  label,
  danger,
  disabled,
}: {
  icon: ActionIconKind;
  onClick: () => void;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`aspro-file-icon shrink-0 ${danger ? 'danger' : ''}`}
    >
      <ActionIcon kind={icon} />
    </button>
  );
}

function FileContextMenu({
  state,
  onClose,
  onDownload,
  onEdit,
  onRename,
  onDelete,
  onInfo,
  t,
}: {
  state: { x: number; y: number; files: RemoteFile[] };
  onClose: () => void;
  onDownload: (file: RemoteFile) => void;
  onEdit: (file: RemoteFile) => void;
  onRename: (file: RemoteFile) => void;
  onDelete: (files: RemoteFile[]) => void;
  onInfo: (file: RemoteFile) => void;
  t: TFunc;
}) {
  const single = state.files.length === 1 ? state.files[0] : null;
  const left = Math.min(state.x, window.innerWidth - 180);
  const top = Math.min(state.y, window.innerHeight - 220);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 min-w-[160px] rounded border border-line bg-raised py-1 text-xs shadow-lg"
        style={{ left, top }}
      >
        {single && !single.isDirectory && (
          <MenuItem
            onClick={() => {
              onEdit(single);
              onClose();
            }}
          >
            {t('sftp.actionEdit')}
          </MenuItem>
        )}
        {single && !single.isDirectory && (
          <MenuItem
            onClick={() => {
              onDownload(single);
              onClose();
            }}
          >
            {t('sftp.actionDownload')}
          </MenuItem>
        )}
        {single && (
          <MenuItem
            onClick={() => {
              onRename(single);
              onClose();
            }}
          >
            {t('sftp.actionRename')}
          </MenuItem>
        )}
        <MenuItem
          danger
          onClick={() => {
            onDelete(state.files);
            onClose();
          }}
        >
          {t('sftp.actionDelete')}
        </MenuItem>
        {single && (
          <>
            <div className="my-1 border-t border-line" />
            <MenuItem
              onClick={() => {
                onInfo(single);
                onClose();
              }}
            >
              {t('sftp.actionInfo')}
            </MenuItem>
          </>
        )}
      </div>
    </>
  );
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left hover:bg-hover focus:outline-none ${
        danger ? 'text-coral' : 'text-dim'
      }`}
    >
      {children}
    </button>
  );
}

function FileInfoDialog({
  file,
  onClose,
  t,
  locale,
}: {
  file: RemoteFile;
  onClose: () => void;
  t: TFunc;
  locale: string;
}) {
  const typeLabel = file.isDirectory
    ? t('sftp.infoTypeFolder')
    : file.isSymlink
      ? t('sftp.infoTypeSymlink')
      : t('sftp.infoTypeFile');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-line bg-raised p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="truncate text-sm font-semibold text-fg">{file.name}</h2>
        <dl className="mt-4 space-y-2 text-xs">
          <InfoRow label={t('sftp.infoPath')} value={file.path} mono />
          <InfoRow label={t('sftp.infoType')} value={typeLabel} />
          {!file.isDirectory && <InfoRow label={t('sftp.columnSize')} value={formatBytes(file.sizeBytes)} />}
          <InfoRow label={t('sftp.columnModified')} value={formatDate(file.modifiedAt, locale)} />
          <InfoRow label={t('sftp.columnPermissions')} value={file.mode} mono />
          <InfoRow label={t('sftp.infoOwner')} value={String(file.owner)} />
          <InfoRow label={t('sftp.infoGroup')} value={String(file.group)} />
        </dl>
        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            {t('sftp.infoClose')}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-faint">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-dim ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

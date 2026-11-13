import type {
  DragEvent,
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteFile, TransferProgress } from '../shared/types';
import type { EditStatus } from '../../electron/ssh/remote-edit';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { useI18n } from '../i18n';
import { formatBytes, formatDate } from '../lib/format';
import { SftpQuickEditorModal } from './SftpQuickEditorModal';
import { SftpChmodModal } from './SftpChmodModal';

function isArchiveFile(file: RemoteFile): boolean {
  if (file.isDirectory) return false;
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.bz2') ||
    lower.endsWith('.tar')
  );
}

/**
 * Browser berkas SFTP.
 *
 * Daftar berkasnya divirtualisasi — hanya baris yang terlihat yang dirender.
 * Direktori seperti /var/spool atau folder unggahan bisa berisi puluhan ribu
 * entri, dan merendernya sekaligus membekukan aplikasi.
 */

type SortKey = 'name' | 'size' | 'modified';
type ColumnId = 'name' | 'size' | 'modified' | 'permissions' | 'owner' | 'group';
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
const CHECKBOX_COL_WIDTH = 24;

const NAME_WIDTH_STORAGE_KEY = 'asproops.sftpNameWidth';

function loadNameWidth(): number {
  const raw = Number(localStorage.getItem(NAME_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return 240;
  return Math.max(MIN_COL_WIDTH, raw);
}

const COLUMN_STORAGE_KEY = 'asproops.sftpColumns';
const DEFAULT_COLUMNS: ColumnState[] = [
  { id: 'name', width: 240, visible: true },
  { id: 'size', width: 85, visible: true },
  { id: 'modified', width: 140, visible: true },
  { id: 'permissions', width: 68, visible: true },
  { id: 'owner', width: 64, visible: false },
  { id: 'group', width: 64, visible: false },
];

function loadColumns(): ColumnState[] {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const saved = JSON.parse(raw) as ColumnState[];
    const validIds = new Set(DEFAULT_COLUMNS.map((c) => c.id));
    let savedValid = saved.filter((c) => validIds.has(c.id));
    // Jika config tersimpan lama belum menyertakan 'name', sisipkan di awal
    if (!savedValid.some((c) => c.id === 'name')) {
      const oldNameWidth = loadNameWidth();
      savedValid = [{ id: 'name', width: oldNameWidth, visible: true }, ...savedValid];
    }
    // Kolom baru dari update aplikasi (belum ada di config tersimpan)
    // ditambahkan di akhir supaya tetap muncul.
    const missing = DEFAULT_COLUMNS.filter((def) => !savedValid.some((c) => c.id === def.id));
    return [...savedValid, ...missing].map((c) => ({
      ...c,
      visible: c.id === 'name' ? true : c.visible,
      width: Math.max(MIN_COL_WIDTH, c.width),
    }));
  } catch {
    return DEFAULT_COLUMNS;
  }
}

export interface SftpBookmark {
  id: string;
  name: string;
  path: string;
  sessionId?: string;
}

const BOOKMARKS_STORAGE_KEY = 'asproops.sftpBookmarks.v1';

function loadBookmarks(): SftpBookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SftpBookmark[];
  } catch {
    return [];
  }
}

function saveBookmarks(bookmarks: SftpBookmark[]): void {
  localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
}

function columnLabelKey(id: ColumnId) {
  switch (id) {
    case 'name':
      return 'sftp.columnName' as const;
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
    case 'name':
      return file.name;
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

  // Persistent preferences
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const saved = localStorage.getItem('asproops.sftpSortKey');
    return (saved as SortKey) || 'name';
  });
  const [ascending, setAscending] = useState<boolean>(() => {
    const raw = localStorage.getItem('asproops.sftpSortAsc');
    return raw !== null ? raw === 'true' : true;
  });
  const [showHidden, setShowHidden] = useState<boolean>(() => {
    return localStorage.getItem('asproops.sftpShowHidden') === 'true';
  });

  // Navigation history
  const navHistoryRef = useRef<string[]>(['/']);
  const navIndexRef = useRef<number>(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  // Search filter ref
  const filterInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState('');
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});
  const [edits, setEdits] = useState<Record<string, EditStatus>>({});
  const [pendingDelete, setPendingDelete] = useState<RemoteFile[] | null>(null);
  const [renaming, setRenaming] = useState<{ file: RemoteFile; value: string } | null>(null);
  const [infoFile, setInfoFile] = useState<RemoteFile | null>(null);
  const [quickEditorFile, setQuickEditorFile] = useState<RemoteFile | null>(null);
  const [chmodFile, setChmodFile] = useState<RemoteFile | null>(null);

  const [columns, setColumns] = useState<ColumnState[]>(loadColumns);
  const [draggingCol, setDraggingCol] = useState<ColumnId | null>(null);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [createModal, setCreateModal] = useState<{
    type: 'folder' | 'file';
    name: string;
    error?: string;
  } | null>(null);
  const [isPathEditing, setIsPathEditing] = useState(false);

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

  const [bookmarks, setBookmarks] = useState<SftpBookmark[]>(loadBookmarks);
  const [bookmarkMenuOpen, setBookmarkMenuOpen] = useState(false);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  const activeBookmarks = useMemo(() => {
    return bookmarks.filter((b) => !b.sessionId || b.sessionId === sessionId);
  }, [bookmarks, sessionId]);

  const isCurrentPathBookmarked = useMemo(() => {
    return activeBookmarks.some((b) => b.path === path);
  }, [activeBookmarks, path]);

  const handleAddBookmark = (name: string, targetPath: string, isSessionSpecific: boolean) => {
    const newBm: SftpBookmark = {
      id: crypto.randomUUID(),
      name: name.trim() || targetPath,
      path: targetPath,
      sessionId: isSessionSpecific ? sessionId : undefined,
    };
    setBookmarks((prev) => {
      const next = [
        ...prev.filter(
          (b) => !(b.path === targetPath && b.sessionId === (isSessionSpecific ? sessionId : undefined)),
        ),
        newBm,
      ];
      saveBookmarks(next);
      return next;
    });
    window.dispatchEvent(
      new CustomEvent('asproops:toast', {
        detail: t('sftp.bookmarkSaved', { name: newBm.name }),
      }),
    );
  };

  const handleRemoveBookmark = (id: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      saveBookmarks(next);
      return next;
    });
    window.dispatchEvent(
      new CustomEvent('asproops:toast', {
        detail: t('sftp.bookmarkRemoved'),
      }),
    );
  };

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);

  const load = useCallback(
    async (target: string, pushHistory = true) => {
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

        if (pushHistory) {
          if (navHistoryRef.current[navIndexRef.current] !== resolvedTarget) {
            navHistoryRef.current = [
              ...navHistoryRef.current.slice(0, navIndexRef.current + 1),
              resolvedTarget,
            ];
            navIndexRef.current = navHistoryRef.current.length - 1;
            setCanGoBack(navIndexRef.current > 0);
            setCanGoForward(false);
          }
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, homePath],
  );

  const handleGoBack = useCallback(() => {
    if (navIndexRef.current > 0) {
      navIndexRef.current -= 1;
      setCanGoBack(navIndexRef.current > 0);
      setCanGoForward(navIndexRef.current < navHistoryRef.current.length - 1);
      const prevPath = navHistoryRef.current[navIndexRef.current];
      void load(prevPath, false);
    }
  }, [load]);

  const handleGoForward = useCallback(() => {
    if (navIndexRef.current < navHistoryRef.current.length - 1) {
      navIndexRef.current += 1;
      setCanGoBack(navIndexRef.current > 0);
      setCanGoForward(navIndexRef.current < navHistoryRef.current.length - 1);
      const nextPath = navHistoryRef.current[navIndexRef.current];
      void load(nextPath, false);
    }
  }, [load]);

  const handleToggleHidden = (next: boolean) => {
    setShowHidden(next);
    localStorage.setItem('asproops.sftpShowHidden', String(next));
  };

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

    window.addEventListener('asproops:terminal-cwd', handleTerminalCwd);
    return () => window.removeEventListener('asproops:terminal-cwd', handleTerminalCwd);
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
    () => CHECKBOX_COL_WIDTH + visibleColumns.reduce((sum, c) => sum + c.width, 0),
    [visibleColumns],
  );
  const selectedFiles = useMemo(
    () => entries.filter((f) => selected.has(f.path)),
    [entries, selected],
  );

  const goToPath = () => {
    void load(pathInput);
  };

  const handleSort = (key: SortKey) => {
    let nextAsc = true;
    if (key === sortKey) {
      nextAsc = !ascending;
      setAscending(nextAsc);
    } else {
      setSortKey(key);
      setAscending(true);
      localStorage.setItem('asproops.sftpSortKey', key);
    }
    localStorage.setItem('asproops.sftpSortAsc', String(nextAsc));
  };

  // Global SFTP keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const targetTag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea';

      if (event.key === 'Escape') {
        if (contextMenu) setContextMenu(null);
        else if (columnsMenuOpen) setColumnsMenuOpen(false);
        else setSelected(new Set());
        return;
      }

      // F5 -> Reload directory
      if (event.key === 'F5') {
        event.preventDefault();
        void load(path, false);
        return;
      }

      // Ctrl+H -> Toggle hidden files
      if ((event.ctrlKey || event.metaKey) && (event.key === 'h' || event.key === 'H')) {
        event.preventDefault();
        handleToggleHidden(!showHidden);
        return;
      }

      // When not typing in an input/textarea
      if (!isInput) {
        // Alt+Left -> Back
        if (event.altKey && event.key === 'ArrowLeft') {
          event.preventDefault();
          handleGoBack();
          return;
        }

        // Alt+Right -> Forward
        if (event.altKey && event.key === 'ArrowRight') {
          event.preventDefault();
          handleGoForward();
          return;
        }

        // Alt+Up -> Up to parent folder
        if (event.altKey && event.key === 'ArrowUp') {
          event.preventDefault();
          if (path !== '/') void load(parentOf(path));
          return;
        }

        // F2 -> Rename selected file
        if (event.key === 'F2' && selectedFiles.length === 1) {
          event.preventDefault();
          setRenaming({ file: selectedFiles[0], value: selectedFiles[0].name });
          return;
        }

        // Delete -> Delete selected file(s)
        if (event.key === 'Delete' && selectedFiles.length > 0) {
          event.preventDefault();
          setPendingDelete(selectedFiles);
          return;
        }

        // Ctrl+F -> Focus filter input
        if ((event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'F')) {
          event.preventDefault();
          filterInputRef.current?.focus();
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    contextMenu,
    columnsMenuOpen,
    selectedFiles,
    path,
    showHidden,
    handleGoBack,
    handleGoForward,
    load,
  ]);

  const toggleColumnVisibility = (id: ColumnId) => {
    setColumns((prev) =>
      prev.map((c) => {
        // Jangan biarkan kolom nama disembunyikan supaya tidak bingung
        if (c.id === 'name') return c;
        return c.id === id ? { ...c, visible: !c.visible } : c;
      }),
    );
  };

  const startColumnResize = (event: ReactPointerEvent, colId: ColumnId) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const min = MIN_COL_WIDTH;
    const col = columns.find((c) => c.id === colId);
    if (!col) return;
    const startWidth = col.width;

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(min, startWidth + (moveEvent.clientX - startX));
      setColumns((prev) => prev.map((c) => (c.id === colId ? { ...c, width: next } : c)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const resetColumnWidth = (colId: ColumnId) => {
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

  const handleMoveColumn = (id: ColumnId, direction: 'up' | 'down') => {
    setColumns((prev) => {
      const index = prev.findIndex((c) => c.id === id);
      if (index === -1) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const handleSetPreset = (preset: 'standard' | 'compact' | 'full') => {
    if (preset === 'standard') {
      setColumns([
        { id: 'name', width: 240, visible: true },
        { id: 'size', width: 85, visible: true },
        { id: 'modified', width: 140, visible: true },
        { id: 'permissions', width: 68, visible: true },
        { id: 'owner', width: 64, visible: false },
        { id: 'group', width: 64, visible: false },
      ]);
    } else if (preset === 'compact') {
      setColumns([
        { id: 'name', width: 280, visible: true },
        { id: 'size', width: 90, visible: true },
        { id: 'modified', width: 140, visible: false },
        { id: 'permissions', width: 68, visible: false },
        { id: 'owner', width: 64, visible: false },
        { id: 'group', width: 64, visible: false },
      ]);
    } else if (preset === 'full') {
      setColumns([
        { id: 'name', width: 220, visible: true },
        { id: 'size', width: 85, visible: true },
        { id: 'modified', width: 130, visible: true },
        { id: 'permissions', width: 68, visible: true },
        { id: 'owner', width: 64, visible: true },
        { id: 'group', width: 64, visible: true },
      ]);
    }
  };

  const handleResetColumns = () => {
    setColumns(DEFAULT_COLUMNS);
  };

  const handleOpenCreateModal = (type: 'folder' | 'file') => {
    setCreateModal({ type, name: '', error: undefined });
  };

  const handleConfirmCreate = async (name: string) => {
    if (!createModal) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\')) {
      setCreateModal((prev) => (prev ? { ...prev, error: t('sftp.invalidName') } : null));
      return;
    }
    if (entries.some((e) => e.name.toLowerCase() === trimmed.toLowerCase())) {
      setCreateModal((prev) => (prev ? { ...prev, error: t('sftp.nameAlreadyExists') } : null));
      return;
    }

    const targetPath = joinPath(path, trimmed);
    try {
      if (createModal.type === 'folder') {
        await window.ssh.sftp.mkdir(sessionId, targetPath);
        window.dispatchEvent(
          new CustomEvent('asproops:toast', {
            detail: t('sftp.folderCreated', { name: trimmed }),
          }),
        );
      } else {
        await window.ssh.sftp.createFile(sessionId, targetPath);
        window.dispatchEvent(
          new CustomEvent('asproops:toast', {
            detail: t('sftp.fileCreated', { name: trimmed }),
          }),
        );
      }
      setCreateModal(null);
      await load(path);
    } catch (err) {
      setCreateModal((prev) => (prev ? { ...prev, error: (err as Error).message } : null));
    }
  };

  const handleCopyPath = () => {
    void navigator.clipboard.writeText(path).then(() => {
      window.dispatchEvent(
        new CustomEvent('asproops:toast', {
          detail: t('sftp.pathCopied'),
        }),
      );
    });
  };

  const handleArchive = async (
    action: 'extract' | 'compress',
    file: RemoteFile,
    format?: 'zip' | 'tar.gz',
  ) => {
    window.dispatchEvent(
      new CustomEvent('asproops:toast', {
        detail:
          action === 'extract'
            ? t('sftp.extracting', { name: file.name })
            : t('sftp.compressing', { name: file.name }),
      }),
    );

    try {
      await window.ssh.sftp.archive(sessionId, action, file.path, undefined, format);
      window.dispatchEvent(
        new CustomEvent('asproops:toast', {
          detail:
            action === 'extract'
              ? t('sftp.extractSuccess', { name: file.name })
              : t('sftp.compressSuccess', { name: file.name }),
        }),
      );
      await load(path);
    } catch (err) {
      setError((err as Error).message);
    }
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
    event.stopPropagation();
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

  const handleBackgroundContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    setSelected(new Set());
    setSelectionAnchor(null);
    setContextMenu({ x: event.clientX, y: event.clientY, files: [] });
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

  const uploadFilesBatch = async (localPaths: string[]) => {
    if (localPaths.length === 0) return;

    try {
      const sftpPrefs = await window.ssh.settings.sftpGet();
      const existingNames = new Set(entries.map((e) => e.name));
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

      if (uploaded > 0) {
        await load(path);
        window.dispatchEvent(
          new CustomEvent('asproops:toast', {
            detail: t('sftp.uploadSuccess', { count: uploaded, path }),
          }),
        );
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleUpload = async () => {
    const localPaths = await window.ssh.dialog.pickUpload();
    if (localPaths.length > 0) {
      await uploadFilesBatch(localPaths);
    }
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDraggingOver(true);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
      }
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    const localPaths = files
      .map((file) => window.ssh.file.getPathForFile(file))
      .filter(Boolean) as string[];

    if (localPaths.length > 0) {
      await uploadFilesBatch(localPaths);
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
            onClick={handleGoBack}
            disabled={!canGoBack}
            title="Kembali (Alt+Left)"
            className="aspro-file-icon disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ←
          </button>
          <button
            onClick={handleGoForward}
            disabled={!canGoForward}
            title="Maju (Alt+Right)"
            className="aspro-file-icon disabled:opacity-30 disabled:cursor-not-allowed"
          >
            →
          </button>
          <button
            onClick={() => void load(parentOf(path))}
            disabled={path === '/'}
            title={`${t('sftp.up')} (Alt+Up)`}
            className="aspro-file-icon"
          >
            ↑
          </button>

          <button onClick={() => void load(homePath)} title={t('sftp.home')} className="aspro-file-icon">
            ⌂
          </button>

          <div className="relative">
            <button
              onClick={() => setBookmarkMenuOpen((v) => !v)}
              title={t('sftp.bookmarks')}
              className={`aspro-file-icon ${
                isCurrentPathBookmarked ? 'border-amber/40 bg-amber/10 text-amber' : ''
              }`}
            >
              {isCurrentPathBookmarked ? '★' : '☆'}
            </button>
            {bookmarkMenuOpen && (
              <BookmarkMenu
                currentPath={path}
                homePath={homePath}
                bookmarks={activeBookmarks}
                isCurrentBookmarked={isCurrentPathBookmarked}
                onNavigate={(target) => {
                  setBookmarkMenuOpen(false);
                  void load(target);
                }}
                onAddBookmark={handleAddBookmark}
                onRemoveBookmark={handleRemoveBookmark}
                onClose={() => setBookmarkMenuOpen(false)}
                t={t}
              />
            )}
          </div>

          <BreadcrumbBar
            path={path}
            isEditing={isPathEditing}
            pathInput={pathInput}
            onStartEdit={() => {
              setIsPathEditing(true);
              setFollowTerminal(false);
            }}
            onCancelEdit={() => {
              setIsPathEditing(false);
              setPathInput(path);
            }}
            onChangeInput={(val) => setPathInput(val)}
            onSubmit={() => {
              setIsPathEditing(false);
              goToPath();
            }}
            onNavigate={(targetPath) => void load(targetPath)}
            onCopyPath={handleCopyPath}
            t={t}
          />

          <button onClick={() => void load(path, false)} title={`${t('sftp.reload')} (F5)`} className="aspro-file-icon">
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

          <label className="aspro-hidden-toggle" title="Tampilkan Berkas Tersembunyi (Ctrl+H)">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => handleToggleHidden(e.target.checked)}
            />
            <span>{t('sftp.hidden')}</span>
          </label>

          <div className="relative">
            <button
              onClick={() => setColumnsMenuOpen((v) => !v)}
              title={t('sftp.columnsConfig')}
              className="aspro-file-icon"
            >
              ▤
            </button>
            {columnsMenuOpen && (
              <ColumnMenu
                columns={columns}
                onToggle={toggleColumnVisibility}
                onMove={handleMoveColumn}
                onSetPreset={handleSetPreset}
                onReset={handleResetColumns}
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
          <ActionButton
            icon="newFolder"
            label={t('sftp.newFolder')}
            onClick={() => handleOpenCreateModal('folder')}
          />
          <ActionButton
            icon="newFile"
            label={t('sftp.newFile')}
            onClick={() => handleOpenCreateModal('file')}
          />

          <div className="mx-1 h-3.5 w-px bg-line/60" />

          {selected.size > 0 && (
            <span
              title={t('sftp.selected', { count: selected.size })}
              className="mr-0.5 shrink-0 rounded-full bg-active px-1.5 py-0.5 text-center font-mono text-[10px] text-dim"
            >
              {selected.size}
            </span>
          )}
          <ActionButton
            icon="quickEdit"
            label={t('sftp.actionQuickEdit')}
            disabled={!(selectedFiles.length === 1 && !selectedFiles[0].isDirectory)}
            onClick={() => setQuickEditorFile(selectedFiles[0])}
          />
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
            icon="chmod"
            label={t('sftp.actionChmod')}
            disabled={selectedFiles.length !== 1}
            onClick={() => setChmodFile(selectedFiles[0])}
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
            ref={filterInputRef}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`${t('sftp.filterPlaceholder')} (Ctrl+F)`}
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

      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-x-auto"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => void handleDrop(e)}
      >
        <div
          className="aspro-file-head flex shrink-0 items-stretch gap-3 border-b border-line bg-panel px-3 py-1.5 text-[10px] text-faint"
          style={{ minWidth: totalMinWidth }}
        >
          <span className="flex w-6 shrink-0 items-center justify-center">
            <input
              type="checkbox"
              checked={visible.length > 0 && selected.size === visible.length}
              onChange={() => {
                if (selected.size === visible.length) {
                  setSelected(new Set());
                } else {
                  setSelected(new Set(visible.map((f) => f.path)));
                }
              }}
              title={selected.size === visible.length ? t('sftp.clearSelection') : t('sftp.selectAll')}
              className="accent-azure"
            />
          </span>
          {visibleColumns.map((col) => (
            <ColumnHeaderCell
              key={col.id}
              col={col}
              label={t(columnLabelKey(col.id))}
              sortable={col.id === 'name' || col.id === 'size' || col.id === 'modified'}
              active={sortKey === col.id}
              ascending={ascending}
              onSort={() => handleSort(col.id as SortKey)}
              onDragStart={(e) => {
                setDraggingCol(col.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/asproops-column', col.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const draggedId =
                  (e.dataTransfer.getData('text/asproops-column') as ColumnId) || draggingCol;
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
          onContextMenu={handleBackgroundContextMenu}
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

                      {visibleColumns.map((col) => {
                        if (col.id === 'name') {
                          return (
                            <div key="name" className="shrink-0 overflow-hidden" style={{ width: col.width }}>
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
                                  onDoubleClick={() => {
                                    if (file.isDirectory) {
                                      void load(file.path);
                                    } else {
                                      setQuickEditorFile(file);
                                    }
                                  }}
                                  className="flex w-full items-center gap-2 truncate text-left font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                                >
                                  <FileTypeIcon file={file} />
                                  <span className={`truncate ${file.isDirectory ? 'font-medium text-azure hover:underline' : 'text-dim'}`}>
                                    {file.name}
                                  </span>
                                </button>
                              )}
                            </div>
                          );
                        }

                        return (
                          <span
                            key={col.id}
                            style={{ width: col.width }}
                            className={`shrink-0 truncate font-mono text-faint ${
                              col.id === 'size' ? 'text-right' : ''
                            }`}
                          >
                            {columnValue(col.id, file)}
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {isDraggingOver && (
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-azure bg-abyss/90 p-6 backdrop-blur-sm animate-pulse">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-azure/20 text-3xl text-azure">
              📥
            </div>
            <div className="mt-3 text-sm font-semibold text-fg">
              {t('sftp.dropTitle')}
            </div>
            <div className="mt-1 font-mono text-xs text-mint">
              {path}
            </div>
            <div className="mt-2 text-[11px] text-muted">
              {t('sftp.dropSubtitle')}
            </div>
          </div>
        )}
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

      {createModal && (
        <CreateItemModal
          modal={createModal}
          onConfirm={handleConfirmCreate}
          onClose={() => setCreateModal(null)}
          t={t}
        />
      )}

      {quickEditorFile && (
        <SftpQuickEditorModal
          sessionId={sessionId}
          file={quickEditorFile}
          onClose={() => setQuickEditorFile(null)}
          onSaved={() => void load(path)}
          t={t}
        />
      )}

      {chmodFile && (
        <SftpChmodModal
          sessionId={sessionId}
          file={chmodFile}
          onClose={() => setChmodFile(null)}
          onSaved={() => void load(path)}
          t={t}
        />
      )}

      {contextMenu && (
        <FileContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onQuickEdit={(file) => setQuickEditorFile(file)}
          onEdit={(file) => void handleEdit(file)}
          onDownload={(file) => void handleDownload(file)}
          onRename={(file) => setRenaming({ file, value: file.name })}
          onChmod={(file) => setChmodFile(file)}
          onArchive={(action, file, format) => void handleArchive(action, file, format)}
          onDelete={(files) => setPendingDelete(files)}
          onInfo={(file) => setInfoFile(file)}
          onNewFolder={() => handleOpenCreateModal('folder')}
          onNewFile={() => handleOpenCreateModal('file')}
          onReload={() => void load(path)}
          onCopyPath={handleCopyPath}
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
      className="group relative flex shrink-0 items-center select-none"
    >
      <span
        draggable
        onDragStart={onDragStart}
        className="absolute inset-y-0 left-0 z-10 flex w-3.5 -translate-x-3 cursor-grab items-center justify-center text-faint/30 opacity-0 group-hover:opacity-100 hover:text-dim active:cursor-grabbing"
        title="Geser urutan kolom"
      >
        ⠿
      </span>
      {sortable ? (
        <button
          onClick={onSort}
          className={`flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] font-medium transition-colors hover:text-fg focus:outline-none ${
            active ? 'text-azure font-semibold' : 'text-faint'
          } ${justify}`}
        >
          <span className="truncate">{label}</span>
          {active && (
            <span className="text-[10px] text-azure">
              {ascending ? '▲' : '▼'}
            </span>
          )}
        </button>
      ) : (
        <span className={`min-w-0 flex-1 truncate text-[11px] font-medium text-faint ${justify}`}>
          {label}
        </span>
      )}
      <span
        draggable={false}
        onPointerDown={onResizeStart}
        onDoubleClick={onResetWidth}
        title={resetLabel}
        className="absolute -right-1.5 top-0 h-full w-3 cursor-col-resize z-20 flex items-center justify-center group/handle"
      >
        <span className="h-3/4 w-[1.5px] rounded bg-white/[0.08] transition-all group-hover/handle:bg-azure group-hover/handle:w-[2px] group-hover/handle:shadow-[0_0_8px_rgba(0,229,255,0.8)]" />
      </span>
    </div>
  );
}

function ColumnMenu({
  columns,
  onToggle,
  onMove,
  onSetPreset,
  onReset,
  onClose,
  t,
}: {
  columns: ColumnState[];
  onToggle: (id: ColumnId) => void;
  onMove: (id: ColumnId, direction: 'up' | 'down') => void;
  onSetPreset: (preset: 'standard' | 'compact' | 'full') => void;
  onReset: () => void;
  onClose: () => void;
  t: TFunc;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-raised p-2 text-xs shadow-2xl backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between border-b border-line/60 pb-1.5 px-1 font-mono text-[10px] uppercase tracking-wider text-faint">
          <span>{t('sftp.columnsConfig')}</span>
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] text-azure hover:underline capitalize"
            title={t('sftp.resetColumns')}
          >
            Reset
          </button>
        </div>

        {/* Quick Presets */}
        <div className="mb-2 flex items-center gap-1 border-b border-line/40 pb-2 px-1">
          <button
            type="button"
            onClick={() => onSetPreset('standard')}
            className="flex-1 rounded bg-active/40 px-1.5 py-1 text-center text-[10px] text-dim hover:bg-hover hover:text-fg"
          >
            {t('sftp.presetStandard').split(' ')[0]}
          </button>
          <button
            type="button"
            onClick={() => onSetPreset('compact')}
            className="flex-1 rounded bg-active/40 px-1.5 py-1 text-center text-[10px] text-dim hover:bg-hover hover:text-fg"
          >
            {t('sftp.presetCompact').split(' ')[0]}
          </button>
          <button
            type="button"
            onClick={() => onSetPreset('full')}
            className="flex-1 rounded bg-active/40 px-1.5 py-1 text-center text-[10px] text-dim hover:bg-hover hover:text-fg"
          >
            {t('sftp.presetFull').split(' ')[0]}
          </button>
        </div>

        {/* Column items with toggle & reorder arrows */}
        <div className="space-y-0.5">
          {columns.map((col, index) => {
            const isFirst = index === 0;
            const isLast = index === columns.length - 1;
            return (
              <div
                key={col.id}
                className="group flex items-center justify-between rounded px-2 py-1 transition-colors hover:bg-hover"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={col.visible}
                    disabled={col.id === 'name'}
                    onChange={() => onToggle(col.id)}
                    className="accent-azure disabled:opacity-50"
                  />
                  <span className={`truncate text-xs ${col.visible ? 'text-fg font-medium' : 'text-faint'}`}>
                    {t(columnLabelKey(col.id))}
                  </span>
                </label>

                {/* Move buttons */}
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={isFirst}
                    onClick={() => onMove(col.id, 'up')}
                    title={t('sftp.moveLeft')}
                    className="h-5 w-5 rounded text-[10px] text-faint hover:bg-line hover:text-azure disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-faint"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={isLast}
                    onClick={() => onMove(col.id, 'down')}
                    title={t('sftp.moveRight')}
                    className="h-5 w-5 rounded text-[10px] text-faint hover:bg-line hover:text-azure disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-faint"
                  >
                    ▼
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function BreadcrumbBar({
  path,
  isEditing,
  pathInput,
  onStartEdit,
  onCancelEdit,
  onChangeInput,
  onSubmit,
  onNavigate,
  onCopyPath,
  t,
}: {
  path: string;
  isEditing: boolean;
  pathInput: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeInput: (val: string) => void;
  onSubmit: () => void;
  onNavigate: (p: string) => void;
  onCopyPath: () => void;
  t: TFunc;
}) {
  const segments = useMemo(() => {
    const parts = path.split('/').filter(Boolean);
    let accum = '';
    return parts.map((name) => {
      accum += `/${name}`;
      return { name, path: accum };
    });
  }, [path]);

  if (isEditing) {
    return (
      <form
        className="aspro-path-box min-w-0 flex-1 ring-1 ring-azure"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <span className="text-orange">▱</span>
        <input
          autoFocus
          value={pathInput}
          onChange={(e) => onChangeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancelEdit();
          }}
          aria-label={t('sftp.pathLabel')}
          spellCheck={false}
          className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xs text-fg focus:outline-none"
        />
        <button
          type="button"
          onClick={onCancelEdit}
          title={t('sftp.cancel')}
          className="text-xs text-faint hover:text-dim"
        >
          ✕
        </button>
        <button type="submit" title={t('sftp.goPath')} className="text-xs text-azure hover:text-fg">
          ↵
        </button>
      </form>
    );
  }

  return (
    <div
      onClick={onStartEdit}
      className="aspro-path-box min-w-0 flex-1 cursor-text hover:border-azure/40 transition-colors group flex items-center justify-between"
      title="Klik untuk ketik path manual"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate('/');
          }}
          title="Root (/)"
          className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 font-mono text-xs text-dim hover:bg-hover hover:text-azure"
        >
          <span className="text-orange">▱</span>
          <span>/</span>
        </button>

        {segments.map((seg, idx) => {
          const isLast = idx === segments.length - 1;
          return (
            <div key={seg.path} className="flex shrink-0 items-center gap-1">
              <span className="text-[10px] text-faint/40">›</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate(seg.path);
                }}
                className={`truncate rounded px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-hover ${
                  isLast ? 'font-semibold text-fg' : 'text-dim hover:text-azure'
                }`}
              >
                {seg.name}
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-1 pl-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCopyPath();
          }}
          title={t('sftp.copyPath')}
          className="rounded p-1 text-faint hover:bg-hover hover:text-fg"
        >
          <svg viewBox="0 0 18 18" aria-hidden className="h-3 w-3 stroke-current fill-none" strokeWidth="1.5">
            <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
            <path d="M3.5 11.5v-7A1.5 1.5 0 0 1 5 3h7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit();
          }}
          title="Edit path"
          className="rounded p-1 text-faint hover:bg-hover hover:text-fg"
        >
          <svg viewBox="0 0 18 18" aria-hidden className="h-3 w-3 stroke-current fill-none" strokeWidth="1.5">
            <path d="M12.6 2.6a1.7 1.7 0 0 1 2.4 2.4L6.4 13.6l-3.4.9.9-3.4z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function CreateItemModal({
  modal,
  onConfirm,
  onClose,
  t,
}: {
  modal: { type: 'folder' | 'file'; name: string; error?: string };
  onConfirm: (name: string) => Promise<void>;
  onClose: () => void;
  t: TFunc;
}) {
  const [name, setName] = useState(modal.name);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    await onConfirm(name);
    setSubmitting(false);
  };

  const isFolder = modal.type === 'folder';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="text-base">{isFolder ? '📁' : '📄'}</span>
          <h2 className="text-sm font-semibold text-fg">
            {isFolder ? t('sftp.newFolderTitle') : t('sftp.newFileTitle')}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                isFolder
                  ? t('sftp.folderNamePlaceholder')
                  : t('sftp.fileNamePlaceholder')
              }
              className="w-full rounded border border-line bg-abyss px-3 py-1.5 font-mono text-xs text-fg placeholder:text-muted focus:border-azure focus:outline-none focus:ring-1 focus:ring-azure"
            />
            {modal.error && (
              <p className="mt-1.5 text-xs text-coral">{modal.error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded px-3 py-1.5 text-xs text-dim hover:text-fg hover:bg-hover focus:outline-none"
            >
              {t('sftp.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="rounded bg-azure px-3.5 py-1.5 text-xs font-medium text-abyss hover:bg-azure-bright disabled:opacity-40 focus:outline-none"
            >
              {submitting ? '...' : t('sftp.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BookmarkMenu({
  currentPath,
  homePath,
  bookmarks,
  isCurrentBookmarked,
  onNavigate,
  onAddBookmark,
  onRemoveBookmark,
  onClose,
  t,
}: {
  currentPath: string;
  homePath: string;
  bookmarks: SftpBookmark[];
  isCurrentBookmarked: boolean;
  onNavigate: (path: string) => void;
  onAddBookmark: (name: string, path: string, isSessionSpecific: boolean) => void;
  onRemoveBookmark: (id: string) => void;
  onClose: () => void;
  t: TFunc;
}) {
  const [adding, setAdding] = useState(false);
  const defaultName =
    currentPath === homePath
      ? 'Home'
      : currentPath.split('/').filter(Boolean).pop() || currentPath;
  const [nameInput, setNameInput] = useState(defaultName);
  const [thisServerOnly, setThisServerOnly] = useState(true);

  const standardLocations = [
    { name: 'Home (~)', path: homePath, icon: '⌂' },
    { name: 'Root (/)', path: '/', icon: '▱' },
    { name: '/var/log', path: '/var/log', icon: '📁' },
    { name: '/etc', path: '/etc', icon: '⚙️' },
    { name: '/tmp', path: '/tmp', icon: '💾' },
    { name: '/var/www', path: '/var/www', icon: '🌐' },
  ];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onAddBookmark(nameInput, currentPath, thisServerOnly);
    setAdding(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-line bg-raised p-2 text-xs shadow-2xl backdrop-blur-md">
        {/* Header / Pin Current Button */}
        {!adding ? (
          <div className="mb-2 border-b border-line/40 pb-2">
            {isCurrentBookmarked ? (
              <div className="flex items-center justify-between rounded bg-amber/10 px-2.5 py-1.5 text-[11px] text-amber">
                <span className="flex items-center gap-1.5 font-medium">
                  <span>★</span>
                  <span>{t('sftp.isPinned')}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const existing = bookmarks.find((b) => b.path === currentPath);
                    if (existing) onRemoveBookmark(existing.id);
                  }}
                  className="text-xs text-faint hover:text-coral"
                  title={t('sftp.bookmarkRemoved')}
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left font-medium text-dim transition-colors hover:bg-hover hover:text-fg"
              >
                <span className="text-amber">☆</span>
                <span className="truncate">{t('sftp.pinCurrent')}</span>
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleSave} className="mb-2 space-y-2 border-b border-line/40 pb-2">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                {t('sftp.pinCurrent')}
              </span>
              <div className="truncate font-mono text-[10px] text-azure">
                {currentPath}
              </div>
            </div>
            <input
              type="text"
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t('sftp.bookmarkNamePlaceholder')}
              className="aspro-input w-full px-2 py-1 text-xs"
              required
            />
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-dim">
              <input
                type="checkbox"
                checked={thisServerOnly}
                onChange={(e) => setThisServerOnly(e.target.checked)}
                className="accent-azure"
              />
              <span>{t('sftp.bookmarkThisServerOnly')}</span>
            </label>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="aspro-button aspro-button-secondary compact px-2 py-0.5 text-[10px]"
              >
                {t('settings.close')}
              </button>
              <button
                type="submit"
                className="aspro-button aspro-button-primary compact px-2 py-0.5 text-[10px]"
              >
                {t('sftp.addBookmark')}
              </button>
            </div>
          </form>
        )}

        {/* Custom Bookmarks Section */}
        <div className="mb-2">
          <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-faint">
            {t('sftp.savedBookmarks')}
          </div>
          {bookmarks.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] italic text-muted">
              {t('sftp.noBookmarks')}
            </div>
          ) : (
            <div className="max-h-36 space-y-0.5 overflow-y-auto">
              {bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="group flex items-center justify-between rounded px-2 py-1 transition-colors hover:bg-hover"
                >
                  <button
                    type="button"
                    onClick={() => onNavigate(bm.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={bm.path}
                  >
                    <span className="text-xs text-amber">★</span>
                    <div className="min-w-0 flex-1 truncate">
                      <div className="truncate text-xs font-medium text-dim group-hover:text-fg">
                        {bm.name}
                      </div>
                      <div className="truncate font-mono text-[10px] text-faint">
                        {bm.path}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveBookmark(bm.id);
                    }}
                    className="ml-1.5 text-xs text-faint opacity-0 transition-opacity hover:text-coral group-hover:opacity-100"
                    title="Hapus bookmark"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Standard Locations Section */}
        <div className="border-t border-line/40 pt-1.5">
          <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-faint">
            {t('sftp.standardLocations')}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {standardLocations.map((loc) => (
              <button
                key={loc.path}
                type="button"
                onClick={() => onNavigate(loc.path)}
                className="flex items-center gap-1.5 truncate rounded px-2 py-1 text-left text-[11px] text-dim transition-colors hover:bg-hover hover:text-fg"
                title={loc.path}
              >
                <span className="text-xs">{loc.icon}</span>
                <span className="truncate">{loc.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

type ActionIconKind =
  | 'edit'
  | 'download'
  | 'rename'
  | 'info'
  | 'delete'
  | 'newFolder'
  | 'newFile'
  | 'quickEdit'
  | 'chmod';

function ActionIcon({ kind }: { kind: ActionIconKind }) {
  switch (kind) {
    case 'quickEdit':
      return (
        <svg viewBox="0 0 18 18" aria-hidden className="aspro-action-icon text-azure">
          <path d="M2.5 3.5h13a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
          <path d="M6 7.5l-2 1.5 2 1.5m6-3l2 1.5-2 1.5m-3-3.5l-2 7" strokeWidth="1.3" />
        </svg>
      );
    case 'chmod':
      return (
        <svg viewBox="0 0 18 18" aria-hidden className="aspro-action-icon text-amber">
          <rect x="3.5" y="7.5" width="11" height="8" rx="1.5" />
          <path d="M6 7.5V5a3 3 0 0 1 6 0v2.5" />
          <circle cx="9" cy="11.5" r="1" fill="currentColor" />
        </svg>
      );
    case 'newFolder':
      return (
        <svg viewBox="0 0 18 18" aria-hidden className="aspro-action-icon">
          <path d="M2.2 4.2c0-.7.6-1.2 1.2-1.2h3.5l1.4 1.6h6.5c.7 0 1.2.5 1.2 1.2v6.4c0 .7-.5 1.2-1.2 1.2H3.4c-.7 0-1.2-.5-1.2-1.2z" />
          <path d="M12.5 9v4m-2-2h4" strokeWidth="1.6" />
        </svg>
      );
    case 'newFile':
      return (
        <svg viewBox="0 0 18 18" aria-hidden className="aspro-action-icon">
          <path d="M4 2.5h6l4 4V15a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V4A1.5 1.5 0 0 1 4 2.5z" />
          <path d="M10 2.5V7h4.5" />
          <path d="M8.5 9.5v4m-2-2h4" strokeWidth="1.6" />
        </svg>
      );
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
  onQuickEdit,
  onEdit,
  onDownload,
  onRename,
  onChmod,
  onArchive,
  onDelete,
  onInfo,
  onNewFolder,
  onNewFile,
  onReload,
  onCopyPath,
  t,
}: {
  state: { x: number; y: number; files: RemoteFile[] };
  onClose: () => void;
  onQuickEdit: (file: RemoteFile) => void;
  onEdit: (file: RemoteFile) => void;
  onDownload: (file: RemoteFile) => void;
  onRename: (file: RemoteFile) => void;
  onChmod: (file: RemoteFile) => void;
  onArchive: (action: 'extract' | 'compress', file: RemoteFile, format?: 'zip' | 'tar.gz') => void;
  onDelete: (files: RemoteFile[]) => void;
  onInfo: (file: RemoteFile) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onReload: () => void;
  onCopyPath: (targetPath?: string) => void;
  t: TFunc;
}) {
  const single = state.files.length === 1 ? state.files[0] : null;
  const left = Math.min(state.x, window.innerWidth - 210);
  const top = Math.min(state.y, window.innerHeight - 340);

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
        className="fixed z-50 min-w-[190px] rounded-lg border border-line bg-raised py-1 text-xs shadow-2xl backdrop-blur-md"
        style={{ left, top }}
      >
        {single && !single.isDirectory && (
          <MenuItem
            onClick={() => {
              onQuickEdit(single);
              onClose();
            }}
          >
            <span className="mr-2 text-azure">⚡</span>
            {t('sftp.actionQuickEdit')}
          </MenuItem>
        )}
        {single && !single.isDirectory && (
          <MenuItem
            onClick={() => {
              onEdit(single);
              onClose();
            }}
          >
            <span className="mr-2 text-faint">✎</span>
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
            <span className="mr-2 text-faint">↓</span>
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
            <span className="mr-2 text-faint">✏</span>
            {t('sftp.actionRename')}
          </MenuItem>
        )}
        {single && (
          <MenuItem
            onClick={() => {
              onChmod(single);
              onClose();
            }}
          >
            <span className="mr-2 text-amber">🔒</span>
            {t('sftp.actionChmod')}
          </MenuItem>
        )}

        {/* Extraction option for archive files */}
        {single && isArchiveFile(single) && (
          <MenuItem
            onClick={() => {
              onArchive('extract', single);
              onClose();
            }}
          >
            <span className="mr-2 text-mint">📦</span>
            {t('sftp.actionExtract')}
          </MenuItem>
        )}

        {/* Compression options */}
        {single && (
          <>
            <MenuItem
              onClick={() => {
                onArchive('compress', single, 'zip');
                onClose();
              }}
            >
              <span className="mr-2 text-amber">🗜️</span>
              {t('sftp.actionCompressZip')}
            </MenuItem>
            <MenuItem
              onClick={() => {
                onArchive('compress', single, 'tar.gz');
                onClose();
              }}
            >
              <span className="mr-2 text-amber">🗜️</span>
              {t('sftp.actionCompressTar')}
            </MenuItem>
          </>
        )}

        {state.files.length > 0 && (
          <MenuItem
            danger
            onClick={() => {
              onDelete(state.files);
              onClose();
            }}
          >
            <span className="mr-2">🗑</span>
            {t('sftp.actionDelete')}
          </MenuItem>
        )}
        {single && (
          <MenuItem
            onClick={() => {
              onInfo(single);
              onClose();
            }}
          >
            <span className="mr-2 text-faint">ⓘ</span>
            {t('sftp.actionInfo')}
          </MenuItem>
        )}

        {state.files.length > 0 && <div className="my-1 border-t border-line/60" />}

        <MenuItem
          onClick={() => {
            onClose();
            onNewFolder();
          }}
        >
          <span className="mr-2 text-amber">📁+</span>
          {t('sftp.newFolder')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onClose();
            onNewFile();
          }}
        >
          <span className="mr-2 text-mint">📄+</span>
          {t('sftp.newFile')}
        </MenuItem>

        <div className="my-1 border-t border-line/60" />

        <MenuItem
          onClick={() => {
            onClose();
            const toCopy = single
              ? single.path
              : state.files.length > 0
              ? state.files.map((f) => f.path).join('\n')
              : undefined;
            onCopyPath(toCopy);
          }}
        >
          <span className="mr-2 text-faint">📋</span>
          {t('sftp.copyPath')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onClose();
            onReload();
          }}
        >
          <span className="mr-2 text-faint">⟳</span>
          {t('sftp.reload')}
        </MenuItem>
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

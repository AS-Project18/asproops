import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface WorkspacePrefs {
  /** Shell lokal bawaan saat membuka workspace project baru ('auto', 'powershell7', 'windows-powershell', 'cmd', dll.) */
  defaultShell: string;
  /** Lokasi folder awal bawaan saat memilih 'Buka Folder Project' */
  defaultProjectFolder: string;
  /** Tampilkan dialog konfirmasi sebelum membuka terminal Elevated (Run as Administrator) */
  confirmElevatedLaunch: boolean;
  /** Kerapatan antarmuka pengguna ('comfortable' atau 'compact') */
  uiDensity: 'comfortable' | 'compact';
  /** Format judul tab terminal remote ('name' saja atau 'name-host' dengan IP) */
  tabTitleFormat: 'name' | 'name-host';
  /** Tampilkan bilah Quick Snippets perintah di bawah panel terminal */
  showSnippetsBar: boolean;
}

export const DEFAULT_WORKSPACE_PREFS: WorkspacePrefs = {
  defaultShell: 'auto',
  defaultProjectFolder: '',
  confirmElevatedLaunch: false,
  uiDensity: 'comfortable',
  tabTitleFormat: 'name',
  showSnippetsBar: false,
};

const STORAGE_KEY = 'asproops.workspacePrefs.v1';

function loadWorkspacePrefs(): WorkspacePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_PREFS;
    return { ...DEFAULT_WORKSPACE_PREFS, ...(JSON.parse(raw) as Partial<WorkspacePrefs>) };
  } catch {
    return DEFAULT_WORKSPACE_PREFS;
  }
}

function saveWorkspacePrefs(prefs: WorkspacePrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

interface WorkspacePrefsValue {
  prefs: WorkspacePrefs;
  setPrefs: (patch: Partial<WorkspacePrefs>) => void;
  resetPrefs: () => void;
}

const WorkspacePrefsContext = createContext<WorkspacePrefsValue | null>(null);

export function WorkspacePrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<WorkspacePrefs>(loadWorkspacePrefs);

  const value = useMemo<WorkspacePrefsValue>(
    () => ({
      prefs,
      setPrefs: (patch) => {
        setPrefsState((prev) => {
          const next = { ...prev, ...patch };
          saveWorkspacePrefs(next);
          return next;
        });
      },
      resetPrefs: () => {
        setPrefsState(DEFAULT_WORKSPACE_PREFS);
        saveWorkspacePrefs(DEFAULT_WORKSPACE_PREFS);
      },
    }),
    [prefs],
  );

  return (
    <WorkspacePrefsContext.Provider value={value}>
      {children}
    </WorkspacePrefsContext.Provider>
  );
}

export function useWorkspacePrefs(): WorkspacePrefsValue {
  const context = useContext(WorkspacePrefsContext);
  if (!context) {
    throw new Error('useWorkspacePrefs must be used inside WorkspacePrefsProvider');
  }
  return context;
}

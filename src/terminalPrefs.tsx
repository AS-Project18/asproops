import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Preferensi tampilan terminal (font, ukuran, cursor, scrollback).
 *
 * Murni kosmetik di sisi renderer — tidak menyentuh koneksi SSH sama sekali,
 * jadi disimpan di localStorage seperti bahasa aplikasi, bukan lewat main
 * process. TerminalView dan LocalTerminalView membaca nilai awal saat
 * terminal dibuka, lalu ikut memperbarui instance xterm yang sudah berjalan
 * kalau preferensi berubah sementara terminal masih terbuka.
 */

export type CursorStyle = 'block' | 'underline' | 'bar';

export interface TerminalPrefs {
  /** Kosong berarti ikut variabel CSS --font-mono (bawaan tema). */
  fontFamily: string;
  fontSize: number;
  cursorBlink: boolean;
  cursorStyle: CursorStyle;
  scrollback: number;
}

export const DEFAULT_TERMINAL_PREFS: TerminalPrefs = {
  fontFamily: '',
  fontSize: 13,
  cursorBlink: true,
  cursorStyle: 'block',
  scrollback: 10_000,
};

const STORAGE_KEY = 'asprossh.terminalPrefs';

function loadTerminalPrefs(): TerminalPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TERMINAL_PREFS;
    return { ...DEFAULT_TERMINAL_PREFS, ...(JSON.parse(raw) as Partial<TerminalPrefs>) };
  } catch {
    return DEFAULT_TERMINAL_PREFS;
  }
}

function saveTerminalPrefs(prefs: TerminalPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

interface TerminalPrefsValue {
  prefs: TerminalPrefs;
  setPrefs: (patch: Partial<TerminalPrefs>) => void;
  resetPrefs: () => void;
}

const TerminalPrefsContext = createContext<TerminalPrefsValue | null>(null);

export function TerminalPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<TerminalPrefs>(loadTerminalPrefs);

  const value = useMemo<TerminalPrefsValue>(
    () => ({
      prefs,
      setPrefs: (patch) => {
        setPrefsState((prev) => {
          const next = { ...prev, ...patch };
          saveTerminalPrefs(next);
          return next;
        });
      },
      resetPrefs: () => {
        setPrefsState(DEFAULT_TERMINAL_PREFS);
        saveTerminalPrefs(DEFAULT_TERMINAL_PREFS);
      },
    }),
    [prefs],
  );

  return <TerminalPrefsContext.Provider value={value}>{children}</TerminalPrefsContext.Provider>;
}

export function useTerminalPrefs(): TerminalPrefsValue {
  const context = useContext(TerminalPrefsContext);
  if (!context) throw new Error('useTerminalPrefs must be used inside TerminalPrefsProvider');
  return context;
}

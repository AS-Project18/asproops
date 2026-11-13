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

export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;

export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent?: string;
  selectionBackground: string;
  selectionForeground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TerminalThemePreset {
  id: string;
  name: string;
  previewBg: string;
  previewAccent: string;
  colors: TerminalThemeColors;
}

export const TERMINAL_THEMES: TerminalThemePreset[] = [
  {
    id: 'aspro',
    name: 'ASPro Cyber Dark (Bawaan)',
    previewBg: '#020307',
    previewAccent: '#c05cff',
    colors: {
      background: '#020307',
      foreground: '#d9d1de',
      cursor: '#ff9700',
      cursorAccent: '#020307',
      selectionBackground: '#7b2aa955',
      black: '#08050b',
      red: '#ff5a68',
      green: '#58e879',
      yellow: '#ffb52e',
      blue: '#8f83ff',
      magenta: '#c05cff',
      cyan: '#6bd8e8',
      white: '#e9e2ed',
      brightBlack: '#716878',
      brightRed: '#ff7b86',
      brightGreen: '#7cf197',
      brightYellow: '#ffc85f',
      brightBlue: '#aaa2ff',
      brightMagenta: '#d783ff',
      brightCyan: '#8be7f3',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'vscode',
    name: 'VS Code Dark+',
    previewBg: '#1e1e1e',
    previewAccent: '#007acc',
    colors: {
      background: '#1e1e1e',
      foreground: '#cccccc',
      cursor: '#ffffff',
      cursorAccent: '#1e1e1e',
      selectionBackground: '#264f78',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    previewBg: '#282a36',
    previewAccent: '#bd93f9',
    colors: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'onedark',
    name: 'One Dark Pro',
    previewBg: '#282c34',
    previewAccent: '#61afef',
    colors: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#282c34',
      selectionBackground: '#3e4451',
      black: '#282c34',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#be5046',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai Pro',
    previewBg: '#272822',
    previewAccent: '#a6e22e',
    colors: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#272822',
      selectionBackground: '#49483e',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5',
    },
  },
  {
    id: 'solarized',
    name: 'Solarized Dark',
    previewBg: '#002b36',
    previewAccent: '#268bd2',
    colors: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      cursorAccent: '#002b36',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    previewBg: '#2e3440',
    previewAccent: '#88c0d0',
    colors: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#2e3440',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4',
    },
  },
  {
    id: 'github',
    name: 'GitHub Dark',
    previewBg: '#0d1117',
    previewAccent: '#58a6ff',
    colors: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      cursorAccent: '#0d1117',
      selectionBackground: '#1f6feb44',
      black: '#161b22',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#ffffff',
    },
  },
];

export const TERMINAL_FONT_PRESETS = [
  { id: '', label: 'Bawaan Tema / Sistem' },
  { id: 'Cascadia Code, Consolas, monospace', label: 'Cascadia Code' },
  { id: 'JetBrains Mono, monospace', label: 'JetBrains Mono' },
  { id: 'Fira Code, monospace', label: 'Fira Code' },
  { id: 'Consolas, monospace', label: 'Consolas' },
  { id: 'Courier New, monospace', label: 'Courier New' },
];

export function resolveTerminalTheme(themeId?: string): TerminalThemeColors {
  const match = TERMINAL_THEMES.find((t) => t.id === themeId);
  return match ? match.colors : TERMINAL_THEMES[0].colors;
}

export interface TerminalPrefs {
  /** Kosong berarti ikut variabel CSS --font-mono (bawaan tema). */
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorBlink: boolean;
  cursorStyle: CursorStyle;
  scrollback: number;
  themeId: string;
  copyOnSelect: boolean;
  pasteOnRightClick: boolean;
}

export const DEFAULT_TERMINAL_PREFS: TerminalPrefs = {
  fontFamily: '',
  fontSize: 13,
  lineHeight: 1.25,
  cursorBlink: true,
  cursorStyle: 'block',
  scrollback: 10_000,
  themeId: 'aspro',
  copyOnSelect: false,
  pasteOnRightClick: true,
};

const STORAGE_KEY = 'asproops.terminalPrefs';

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

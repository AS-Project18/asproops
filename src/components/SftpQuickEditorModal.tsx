import { useState, useEffect, useRef, useMemo } from 'react';
import type { RemoteFile } from '../shared/types';
import { formatBytes } from '../lib/format';
import type { useI18n } from '../i18n';
import {
  detectLanguageFromFilename,
  highlightCode,
  SUPPORTED_LANGUAGES,
} from '../lib/syntaxHighlight';

type TFunc = ReturnType<typeof useI18n>['t'];

interface SftpQuickEditorModalProps {
  sessionId: string;
  file: RemoteFile;
  onClose: () => void;
  onSaved?: () => void;
  t: TFunc;
}

export function SftpQuickEditorModal({
  sessionId,
  file,
  onClose,
  onSaved,
  t,
}: SftpQuickEditorModalProps) {
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [formatToast, setFormatToast] = useState<{ message: string; isError: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);

  // Language state
  const [language, setLanguage] = useState(() => detectLanguageFromFilename(file.name));

  // Cursor & Line tracking
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // Find in file
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const isDirty = useMemo(() => content !== originalContent, [content, originalContent]);

  // Highlighted code output with Prism
  const highlightedHtml = useMemo(() => {
    return highlightCode(content, language);
  }, [content, language]);

  // Load file content
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    window.ssh.sftp
      .readFile(sessionId, file.path)
      .then((data) => {
        if (cancelled) return;
        setContent(data);
        setOriginalContent(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, file.path]);

  // Format code handler (Prettier)
  const handleFormatCode = async () => {
    if (formatting || isReadOnly || !content) return;
    setFormatting(true);
    try {
      const res = await window.ssh.code.format(content, file.name, language);
      if (res.error) {
        setFormatToast({ message: res.error, isError: true });
      } else if (res.formatted !== content) {
        setContent(res.formatted);
        setFormatToast({ message: '✨ Kode berhasil diformat', isError: false });
      } else {
        setFormatToast({ message: 'Kode sudah rapi (tidak ada perubahan)', isError: false });
      }
    } catch (err) {
      setFormatToast({ message: (err as Error).message, isError: true });
    } finally {
      setFormatting(false);
      setTimeout(() => setFormatToast(null), 3500);
    }
  };

  // Save handler
  const handleSave = async () => {
    if (isReadOnly || saving || !isDirty) return;
    setSaving(true);
    setSaveStatus(t('sftp.editorSaving'));
    try {
      await window.ssh.sftp.writeFile(sessionId, file.path, content);
      setOriginalContent(content);
      setSaveStatus(t('sftp.editorSaved'));
      onSaved?.();
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setSaveStatus((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Safe close check
  const handleRequestClose = () => {
    if (isDirty) {
      if (!window.confirm(t('sftp.editorUnsavedConfirm'))) {
        return;
      }
    }
    onClose();
  };

  // Keyboard shortcuts (Ctrl+S, Ctrl+F, Shift+Alt+F, Escape)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void handleSave();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      setShowFind(true);
      return;
    }

    // Format document shortcut (Shift+Alt+F or Ctrl+Shift+I)
    if (
      (e.shiftKey && e.altKey && (e.key === 'f' || e.key === 'F')) ||
      (e.ctrlKey && e.shiftKey && (e.key === 'i' || e.key === 'I'))
    ) {
      e.preventDefault();
      void handleFormatCode();
      return;
    }

    if (e.key === 'Escape') {
      if (showFind) {
        setShowFind(false);
        return;
      }
      handleRequestClose();
      return;
    }

    // Handle Tab key indentation
    if (e.key === 'Tab' && !isReadOnly) {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const spaces = '  '; // 2 spaces

      const updated = content.substring(0, start) + spaces + content.substring(end);
      setContent(updated);

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + spaces.length;
          textareaRef.current.selectionEnd = start + spaces.length;
        }
      });
    }
  };

  // Track cursor position
  const updateCursorPosition = () => {
    if (!textareaRef.current) return;
    const pos = textareaRef.current.selectionStart;
    const textBefore = content.substring(0, pos);
    const lines = textBefore.split('\n');
    const currentLine = lines.length;
    const currentCol = lines[lines.length - 1].length + 1;
    setCursorPos({ line: currentLine, col: currentCol });
  };

  // Scroll sync between gutter, highlight pre, and textarea
  const handleScroll = () => {
    if (!textareaRef.current) return;
    const top = textareaRef.current.scrollTop;
    const left = textareaRef.current.scrollLeft;

    if (gutterRef.current) {
      gutterRef.current.scrollTop = top;
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = top;
      highlightRef.current.scrollLeft = left;
    }
  };

  // Compute line count
  const lineCount = useMemo(() => {
    return Math.max(1, content.split('\n').length);
  }, [content]);

  // Find matches count
  const findMatchesCount = useMemo(() => {
    if (!findQuery.trim()) return 0;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    return (content.match(regex) || []).length;
  }, [content, findQuery]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 animate-fadeIn">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-line bg-abyss shadow-2xl overflow-hidden ring-1 ring-line/50">
        {/* Top Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-panel/80 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-azure/10 text-sm text-azure border border-azure/20">
              📄
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-fg font-mono">
                  {file.name}
                </span>
                {isDirty && (
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-amber animate-pulse"
                    title={t('sftp.editorUnsaved')}
                  />
                )}
                {isReadOnly && (
                  <span className="rounded bg-line/80 px-1.5 py-0.5 text-[10px] font-medium text-faint">
                    {t('sftp.editorReadOnly')}
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[10px] text-faint" title={file.path}>
                {file.path} · {formatBytes(file.sizeBytes)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {saveStatus && (
              <span className="text-xs text-mint font-mono animate-fadeIn">
                {saveStatus}
              </span>
            )}

            {formatToast && (
              <span
                className={`text-xs font-mono animate-fadeIn ${
                  formatToast.isError ? 'text-coral' : 'text-mint'
                }`}
                title={formatToast.message}
              >
                {formatToast.message.length > 35
                  ? `${formatToast.message.slice(0, 35)}…`
                  : formatToast.message}
              </span>
            )}

            <button
              type="button"
              onClick={() => setIsReadOnly((v) => !v)}
              className={`rounded px-2.5 py-1 text-xs font-mono transition-colors border ${
                isReadOnly
                  ? 'border-amber/40 bg-amber/10 text-amber'
                  : 'border-line bg-active/40 text-dim hover:text-fg hover:bg-hover'
              }`}
              title={isReadOnly ? 'Mode Hanya Baca Aktif' : 'Klik untuk kunci Hanya Baca'}
            >
              {isReadOnly ? '🔒 Read-Only' : '🔓 Edit'}
            </button>

            <button
              type="button"
              onClick={() => setShowFind((v) => !v)}
              className={`rounded px-2.5 py-1 text-xs font-mono transition-colors border ${
                showFind
                  ? 'border-azure/50 bg-azure/10 text-azure'
                  : 'border-line bg-active/40 text-dim hover:text-fg hover:bg-hover'
              }`}
              title="Cari Teks (Ctrl+F)"
            >
              🔍 Cari
            </button>

            {/* Autoformat Button */}
            <button
              type="button"
              disabled={isReadOnly || formatting}
              onClick={() => void handleFormatCode()}
              className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-mono transition-colors border border-line bg-active/40 text-dim hover:text-fg hover:bg-hover disabled:opacity-40"
              title="Rapikan Kode (Shift+Alt+F)"
            >
              <span>✨</span>
              <span>{formatting ? 'Memformat…' : 'Format'}</span>
            </button>

            <button
              type="button"
              disabled={isReadOnly || saving || !isDirty}
              onClick={() => void handleSave()}
              className="flex items-center gap-1.5 rounded bg-azure px-3 py-1 text-xs font-semibold text-white hover:bg-azure-hover disabled:opacity-40 transition-colors shadow-sm"
              title="Simpan Perubahan (Ctrl+S)"
            >
              <span>💾</span>
              <span>{saving ? t('sftp.editorSaving') : t('sftp.editorSaveBtn')}</span>
            </button>

            <button
              type="button"
              onClick={handleRequestClose}
              className="rounded p-1 text-faint hover:bg-line hover:text-fg focus:outline-none transition-colors ml-1"
              title="Tutup (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Find Bar (Toggle with Ctrl+F) */}
        {showFind && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-4 py-1.5 text-xs">
            <span className="text-faint">⌕</span>
            <input
              type="text"
              autoFocus
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder={t('sftp.editorFind')}
              className="aspro-input flex-1 px-2 py-0.5 text-xs font-mono"
            />
            {findQuery && (
              <span className="font-mono text-[11px] text-faint">
                {findMatchesCount} matches
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowFind(false)}
              className="text-faint hover:text-fg px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Editor Body */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-abyss font-mono text-[12px] leading-relaxed">
          {loading ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-faint">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-azure border-t-transparent" />
              <span>{t('sftp.loading')}</span>
            </div>
          ) : error ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="text-2xl">⚠️</span>
              <p className="max-w-md text-sm text-coral">{error}</p>
              <button
                type="button"
                onClick={handleRequestClose}
                className="mt-2 rounded bg-active px-3 py-1 text-xs text-dim hover:text-fg"
              >
                {t('settings.close')}
              </button>
            </div>
          ) : (
            <div className="flex h-full w-full overflow-hidden">
              {/* Line Numbers Gutter */}
              <div
                ref={gutterRef}
                className="select-none overflow-hidden border-r border-line/60 bg-panel/40 px-3 py-2 text-right font-mono text-[11px] text-faint/40 shrink-0"
                style={{ width: `${Math.max(42, String(lineCount).length * 10 + 20)}px` }}
              >
                {Array.from({ length: lineCount }).map((_, idx) => (
                  <div key={idx + 1} className="h-5 leading-5">
                    {idx + 1}
                  </div>
                ))}
              </div>

              {/* Code Area: Syntax Highlighted Layer + Transparent Overlay Textarea */}
              <div className="relative flex-1 h-full min-w-0 overflow-hidden bg-abyss">
                {/* Syntax Highlighted View Layer (VS Code Dark+ tokens) */}
                <pre
                  ref={highlightRef}
                  aria-hidden="true"
                  className="aspro-editor-pre pointer-events-none absolute inset-0 m-0 p-2 font-mono text-[12px] leading-5 whitespace-pre overflow-hidden"
                  style={{ tabSize: 2 }}
                >
                  <code
                    className={`language-${language}`}
                    dangerouslySetInnerHTML={{
                      __html: content.endsWith('\n') ? `${highlightedHtml}\n` : highlightedHtml,
                    }}
                  />
                </pre>

                {/* Editable Textarea Layer */}
                <textarea
                  ref={textareaRef}
                  readOnly={isReadOnly}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onKeyUp={updateCursorPosition}
                  onClick={updateCursorPosition}
                  onSelect={updateCursorPosition}
                  onScroll={handleScroll}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  className="aspro-code-textarea absolute inset-0 h-full w-full resize-none border-0 bg-transparent p-2 font-mono text-[12px] leading-5 outline-none whitespace-pre overflow-auto"
                  style={{
                    tabSize: 2,
                    color: 'transparent',
                    caretColor: '#58e879',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Bottom Status Bar */}
        <div className="flex shrink-0 items-center justify-between border-t border-line bg-panel/90 px-4 py-1 text-[11px] font-mono text-faint">
          <div className="flex items-center gap-4">
            <span>
              {t('sftp.editorLineCol', { line: cursorPos.line, col: cursorPos.col })}
            </span>
            <span>{lineCount} lines</span>
            <span>{content.length} chars</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Language Selector Dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="text-dim">Language:</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-raised border border-line rounded px-1.5 py-0.5 text-[11px] text-fg focus:outline-none focus:border-azure cursor-pointer"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
            <span>UTF-8</span>
            <span>LF</span>
            <span className="text-muted/60 hidden sm:inline">Shift+Alt+F: Format | Ctrl+S: Simpan</span>
          </div>
        </div>
      </div>
    </div>
  );
}

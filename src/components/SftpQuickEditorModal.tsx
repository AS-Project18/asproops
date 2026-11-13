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

  // Word wrap state (persisted)
  const [wordWrap, setWordWrap] = useState<boolean>(() => {
    return localStorage.getItem('asproops.editorWordWrap') === 'true';
  });

  // Find in file
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(-1);

  // Go to line
  const [showGoToLine, setShowGoToLine] = useState(false);
  const [goToLineInput, setGoToLineInput] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const isDirty = useMemo(() => content !== originalContent, [content, originalContent]);

  const toggleWordWrap = () => {
    setWordWrap((prev) => {
      const next = !prev;
      localStorage.setItem('asproops.editorWordWrap', String(next));
      return next;
    });
  };

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

  // Find matches computation
  useEffect(() => {
    if (!findQuery.trim()) {
      setFindMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }
    try {
      const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      const indices: number[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        indices.push(match.index);
        if (indices.length >= 1000) break; // safety ceiling
      }
      setFindMatches(indices);
      setCurrentMatchIndex(indices.length > 0 ? 0 : -1);
    } catch {
      setFindMatches([]);
      setCurrentMatchIndex(-1);
    }
  }, [findQuery, content]);

  // Jump to specific search match
  const jumpToMatch = (idx: number) => {
    if (idx < 0 || idx >= findMatches.length || !textareaRef.current) return;
    const pos = findMatches[idx];
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(pos, pos + findQuery.length);
    setCurrentMatchIndex(idx);
    updateCursorPosition();
  };

  const handleNextMatch = () => {
    if (findMatches.length === 0) return;
    const next = (currentMatchIndex + 1) % findMatches.length;
    jumpToMatch(next);
  };

  const handlePrevMatch = () => {
    if (findMatches.length === 0) return;
    const prev = (currentMatchIndex - 1 + findMatches.length) % findMatches.length;
    jumpToMatch(prev);
  };

  // Go to line handler
  const handleGoToLine = (targetLineStr: string) => {
    const targetLine = parseInt(targetLineStr, 10);
    if (isNaN(targetLine) || targetLine < 1 || !textareaRef.current) return;
    const lines = content.split('\n');
    const clampedLine = Math.min(lines.length, targetLine);
    let charIndex = 0;
    for (let i = 0; i < clampedLine - 1; i++) {
      charIndex += lines[i].length + 1;
    }
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(charIndex, charIndex);
    updateCursorPosition();
    setShowGoToLine(false);
  };

  const AUTO_PAIRS: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
    '`': '`',
  };

  // Keyboard shortcuts (Ctrl+S, Ctrl+F, Ctrl+G, Shift+Alt+F, Tab, Auto-Pairs, Escape)
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

    if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
      e.preventDefault();
      setGoToLineInput(String(cursorPos.line));
      setShowGoToLine(true);
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
      if (showGoToLine) {
        setShowGoToLine(false);
        return;
      }
      handleRequestClose();
      return;
    }

    // Handle Tab & Shift+Tab indentation (single-line and multi-line block)
    if (e.key === 'Tab' && !isReadOnly) {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const isMultiLine = start !== end && content.substring(start, end).includes('\n');

      if (isMultiLine) {
        // Multi-line block indent/unindent
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        let lineEnd = content.indexOf('\n', end);
        if (lineEnd === -1) lineEnd = content.length;

        const selectedBlock = content.substring(lineStart, lineEnd);
        const lines = selectedBlock.split('\n');

        if (e.shiftKey) {
          // Unindent: remove up to 2 leading spaces from each line
          const unindented = lines.map((l) =>
            l.startsWith('  ') ? l.slice(2) : l.startsWith(' ') ? l.slice(1) : l,
          );
          const newBlock = unindented.join('\n');
          const diff = selectedBlock.length - newBlock.length;
          setContent(content.substring(0, lineStart) + newBlock + content.substring(lineEnd));
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = start;
              textareaRef.current.selectionEnd = Math.max(start, end - diff);
            }
          });
        } else {
          // Indent: prepend 2 spaces to each line
          const indented = lines.map((l) => '  ' + l);
          const newBlock = indented.join('\n');
          const diff = newBlock.length - selectedBlock.length;
          setContent(content.substring(0, lineStart) + newBlock + content.substring(lineEnd));
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = start + 2;
              textareaRef.current.selectionEnd = end + diff;
            }
          });
        }
      } else {
        if (e.shiftKey) {
          // Single line unindent before cursor
          const lineStart = content.lastIndexOf('\n', start - 1) + 1;
          const textBeforeCursor = content.substring(lineStart, start);
          if (textBeforeCursor.endsWith('  ')) {
            const updated = content.substring(0, start - 2) + content.substring(start);
            setContent(updated);
            requestAnimationFrame(() => {
              if (textareaRef.current) {
                textareaRef.current.selectionStart = start - 2;
                textareaRef.current.selectionEnd = start - 2;
              }
            });
          } else if (textBeforeCursor.endsWith(' ')) {
            const updated = content.substring(0, start - 1) + content.substring(start);
            setContent(updated);
            requestAnimationFrame(() => {
              if (textareaRef.current) {
                textareaRef.current.selectionStart = start - 1;
                textareaRef.current.selectionEnd = start - 1;
              }
            });
          }
        } else {
          // Insert 2 spaces
          const spaces = '  ';
          const updated = content.substring(0, start) + spaces + content.substring(end);
          setContent(updated);
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = start + spaces.length;
              textareaRef.current.selectionEnd = start + spaces.length;
            }
          });
        }
      }
      return;
    }

    // Auto-close pairs & Selection wrapping
    if (AUTO_PAIRS[e.key] && !isReadOnly && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const openChar = e.key;
      const closeChar = AUTO_PAIRS[openChar];

      if (start !== end) {
        // Wrap selected text
        e.preventDefault();
        const selected = content.substring(start, end);
        const updated = content.substring(0, start) + openChar + selected + closeChar + content.substring(end);
        setContent(updated);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = start + 1;
            textareaRef.current.selectionEnd = end + 1;
          }
        });
        return;
      } else {
        // If typing closing quote/bracket when cursor is already right before it, skip over it
        if (openChar === closeChar && content[start] === closeChar) {
          e.preventDefault();
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = start + 1;
              textareaRef.current.selectionEnd = start + 1;
            }
          });
          return;
        }

        e.preventDefault();
        const updated = content.substring(0, start) + openChar + closeChar + content.substring(end);
        setContent(updated);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = start + 1;
            textareaRef.current.selectionEnd = start + 1;
          }
        });
        return;
      }
    }

    // Skip over closing bracket if typed
    if ((e.key === ')' || e.key === ']' || e.key === '}') && !isReadOnly && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start === end && content[start] === e.key) {
        e.preventDefault();
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = start + 1;
            textareaRef.current.selectionEnd = start + 1;
          }
        });
        return;
      }
    }

    // Handle Backspace deleting pair
    if (e.key === 'Backspace' && !isReadOnly) {
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start === end && start > 0) {
        const prevChar = content[start - 1];
        const nextChar = content[start];
        if (AUTO_PAIRS[prevChar] === nextChar) {
          e.preventDefault();
          const updated = content.substring(0, start - 1) + content.substring(start + 1);
          setContent(updated);
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = start - 1;
              textareaRef.current.selectionEnd = start - 1;
            }
          });
          return;
        }
      }
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
      if (!wordWrap) {
        highlightRef.current.scrollLeft = left;
      }
    }
  };

  // Compute line count
  const lineCount = useMemo(() => {
    return Math.max(1, content.split('\n').length);
  }, [content]);

  // High performance line numbers text
  const lineNumbersText = useMemo(() => {
    let s = '';
    for (let i = 1; i <= lineCount; i++) {
      s += (i === 1 ? '' : '\n') + i;
    }
    return s;
  }, [lineCount]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4 md:p-6 animate-fadeIn">
      <div className="flex h-[95vh] sm:h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-line bg-abyss shadow-2xl overflow-hidden ring-1 ring-line/50">
        {/* Top Header */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-panel/80 px-3 py-2 sm:px-4 sm:py-2.5 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-azure/10 text-sm text-azure border border-azure/20">
              📄
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs sm:text-sm font-semibold text-fg font-mono">
                  {file.name}
                </span>
                {isDirty && (
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber animate-pulse"
                    title={t('sftp.editorUnsaved')}
                  />
                )}
                {isReadOnly && (
                  <span className="shrink-0 rounded bg-line/80 px-1 py-0.2 text-[9px] font-medium text-faint">
                    {t('sftp.editorReadOnly')}
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[9px] sm:text-[10px] text-faint max-w-[200px] sm:max-w-md" title={file.path}>
                {file.path} · {formatBytes(file.sizeBytes)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 ml-auto">
            {saveStatus && (
              <span className="text-[11px] sm:text-xs text-mint font-mono animate-fadeIn hidden xs:inline">
                {saveStatus}
              </span>
            )}

            {formatToast && (
              <span
                className={`text-[11px] sm:text-xs font-mono animate-fadeIn ${
                  formatToast.isError ? 'text-coral' : 'text-mint'
                }`}
                title={formatToast.message}
              >
                {formatToast.message.length > 25
                  ? `${formatToast.message.slice(0, 25)}…`
                  : formatToast.message}
              </span>
            )}

            <button
              type="button"
              onClick={() => setIsReadOnly((v) => !v)}
              className={`rounded px-2 py-1 text-xs font-mono transition-colors border ${
                isReadOnly
                  ? 'border-amber/40 bg-amber/10 text-amber'
                  : 'border-line bg-active/40 text-dim hover:text-fg hover:bg-hover'
              }`}
              title={isReadOnly ? 'Mode Hanya Baca Aktif' : 'Klik untuk kunci Hanya Baca'}
            >
              <span>{isReadOnly ? '🔒' : '🔓'}</span>
              <span className="hidden md:inline">{isReadOnly ? ' Read-Only' : ' Edit'}</span>
            </button>

            <button
              type="button"
              onClick={toggleWordWrap}
              className={`rounded px-2 py-1 text-xs font-mono transition-colors border ${
                wordWrap
                  ? 'border-azure/50 bg-azure/10 text-azure'
                  : 'border-line bg-active/40 text-dim hover:text-fg hover:bg-hover'
              }`}
              title="Ganti Mode Word Wrap (Bungkus Baris Panjang)"
            >
              <span>{wordWrap ? '↩' : '➔'}</span>
              <span className="hidden md:inline">{wordWrap ? ' Wrap' : ' No-Wrap'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setGoToLineInput(String(cursorPos.line));
                setShowGoToLine((v) => !v);
              }}
              className={`rounded px-2 py-1 text-xs font-mono transition-colors border ${
                showGoToLine
                  ? 'border-azure/50 bg-azure/10 text-azure'
                  : 'border-line bg-active/40 text-dim hover:text-fg hover:bg-hover'
              }`}
              title="Lompat ke Baris (Ctrl+G)"
            >
              <span>:</span>
              <span className="hidden sm:inline">Baris</span>
            </button>

            <button
              type="button"
              onClick={() => setShowFind((v) => !v)}
              className={`rounded px-2 py-1 text-xs font-mono transition-colors border ${
                showFind
                  ? 'border-azure/50 bg-azure/10 text-azure'
                  : 'border-line bg-active/40 text-dim hover:text-fg hover:bg-hover'
              }`}
              title="Cari Teks (Ctrl+F)"
            >
              <span>🔍</span>
              <span className="hidden sm:inline"> Cari</span>
            </button>

            {/* Autoformat Button */}
            <button
              type="button"
              disabled={isReadOnly || formatting}
              onClick={() => void handleFormatCode()}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-mono transition-colors border border-line bg-active/40 text-dim hover:text-fg hover:bg-hover disabled:opacity-40"
              title="Rapikan Kode (Shift+Alt+F)"
            >
              <span>✨</span>
              <span className="hidden sm:inline">{formatting ? 'Format…' : 'Format'}</span>
            </button>

            <button
              type="button"
              disabled={isReadOnly || saving || !isDirty}
              onClick={() => void handleSave()}
              className="flex items-center gap-1 rounded bg-azure px-2.5 py-1 text-xs font-semibold text-white hover:bg-azure-hover disabled:opacity-40 transition-colors shadow-sm"
              title="Simpan Perubahan (Ctrl+S)"
            >
              <span>💾</span>
              <span className="hidden xs:inline sm:inline">{saving ? t('sftp.editorSaving') : t('sftp.editorSaveBtn')}</span>
            </button>

            <button
              type="button"
              onClick={handleRequestClose}
              className="rounded p-1 text-faint hover:bg-line hover:text-fg focus:outline-none transition-colors ml-0.5"
              title="Tutup (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Find Bar (Toggle with Ctrl+F) */}
        {showFind && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-4 py-1.5 text-xs animate-fadeIn">
            <span className="text-azure font-mono font-semibold">⌕ Cari:</span>
            <input
              type="text"
              autoFocus
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) handlePrevMatch();
                  else handleNextMatch();
                }
                if (e.key === 'Escape') setShowFind(false);
              }}
              placeholder={t('sftp.editorFind')}
              className="aspro-input flex-1 px-2 py-0.5 text-xs font-mono"
            />
            <span className="font-mono text-[11px] text-faint">
              {findMatches.length > 0
                ? `${currentMatchIndex + 1} dari ${findMatches.length}`
                : findQuery
                ? '0 hasil'
                : ''}
            </span>
            <button
              type="button"
              disabled={findMatches.length === 0}
              onClick={handlePrevMatch}
              className="rounded px-2 py-0.5 text-xs border border-line bg-active/40 text-dim hover:text-fg disabled:opacity-30"
              title="Hasil Sebelumnya (Shift+Enter)"
            >
              ▲
            </button>
            <button
              type="button"
              disabled={findMatches.length === 0}
              onClick={handleNextMatch}
              className="rounded px-2 py-0.5 text-xs border border-line bg-active/40 text-dim hover:text-fg disabled:opacity-30"
              title="Hasil Selanjutnya (Enter)"
            >
              ▼
            </button>
            <button
              type="button"
              onClick={() => setShowFind(false)}
              className="text-faint hover:text-fg px-1 ml-1"
              title="Tutup (Esc)"
            >
              ✕
            </button>
          </div>
        )}

        {/* Go to Line Bar (Toggle with Ctrl+G) */}
        {showGoToLine && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleGoToLine(goToLineInput);
            }}
            className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-4 py-1.5 text-xs animate-fadeIn"
          >
            <span className="text-azure font-mono font-semibold">:Lompat ke Baris:</span>
            <input
              type="number"
              min={1}
              max={lineCount}
              autoFocus
              value={goToLineInput}
              onChange={(e) => setGoToLineInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowGoToLine(false);
              }}
              placeholder={`1 - ${lineCount}`}
              className="aspro-input w-28 px-2 py-0.5 text-xs font-mono"
            />
            <button
              type="submit"
              className="rounded bg-azure px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-azure-hover"
            >
              Lompat
            </button>
            <button
              type="button"
              onClick={() => setShowGoToLine(false)}
              className="text-faint hover:text-fg px-1 ml-1"
              title="Tutup (Esc)"
            >
              ✕
            </button>
          </form>
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
              {/* High-Performance Line Numbers Gutter */}
              <div
                ref={gutterRef}
                className="select-none overflow-hidden border-r border-line/60 bg-panel/40 px-3 py-2 text-right font-mono text-[11px] text-faint/40 shrink-0"
                style={{ width: `${Math.max(42, String(lineCount).length * 10 + 20)}px` }}
              >
                <pre className="m-0 p-0 font-mono text-[11px] leading-5 whitespace-pre">
                  {lineNumbersText}
                </pre>
              </div>

              {/* Code Area: Syntax Highlighted Layer + Transparent Overlay Textarea */}
              <div className="relative flex-1 h-full min-w-0 overflow-hidden bg-abyss">
                {/* Syntax Highlighted View Layer (VS Code Dark+ tokens) */}
                <pre
                  ref={highlightRef}
                  aria-hidden="true"
                  className={`aspro-editor-pre pointer-events-none absolute inset-0 m-0 p-2 font-mono text-[12px] leading-5 overflow-hidden ${
                    wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                  }`}
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
                  className={`aspro-code-textarea absolute inset-0 h-full w-full resize-none border-0 bg-transparent p-2 font-mono text-[12px] leading-5 outline-none ${
                    wordWrap
                      ? 'whitespace-pre-wrap break-words overflow-y-auto overflow-x-hidden'
                      : 'whitespace-pre overflow-auto'
                  }`}
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
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-panel/90 px-3 py-1 text-[10px] sm:text-[11px] font-mono text-faint">
          <div className="flex items-center gap-2 sm:gap-4">
            <span>
              {t('sftp.editorLineCol', { line: cursorPos.line, col: cursorPos.col })}
            </span>
            <span>{lineCount} lines</span>
            <span className="hidden xs:inline">{content.length} chars</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Language Selector Dropdown */}
            <div className="flex items-center gap-1">
              <span className="text-dim hidden sm:inline">Lang:</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-raised border border-line rounded px-1.5 py-0.5 text-[10px] sm:text-[11px] text-fg focus:outline-none focus:border-azure cursor-pointer"
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
            <span className="text-muted/60 hidden md:inline">
              Ctrl+G: Baris | Ctrl+F: Cari | Shift+Alt+F: Format | Ctrl+S: Simpan
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

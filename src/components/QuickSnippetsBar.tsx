import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommandSnippet, CommandSnippetCreateInput, SnippetPlatform } from '../shared/types';
import { useI18n } from '../i18n';
import { extractSnippetVariables, dispatchTerminalExec } from '../lib/snippetUtils';
import { SnippetVariableModal } from './SnippetVariableModal';
import { SnippetFormModal } from './SnippetFormModal';

interface QuickSnippetsBarProps {
  activePlatform?: 'linux' | 'windows' | 'all';
  onClose: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  Docker: '#0db7ed',
  Systemd: '#a342ca',
  Network: '#10b981',
  System: '#f59e0b',
  Git: '#f97316',
  Nginx: '#009639',
  Windows: '#0078d4',
  PowerShell: '#2670e8',
};

export function QuickSnippetsBar({ activePlatform = 'all', onClose }: QuickSnippetsBarProps) {
  const { t } = useI18n();
  const [snippets, setSnippets] = useState<CommandSnippet[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedPlatform, setSelectedPlatform] = useState<SnippetPlatform>(activePlatform);
  const [search, setSearch] = useState('');

  const [selectedSnippetForVar, setSelectedSnippetForVar] = useState<CommandSnippet | null>(null);
  const [editingSnippet, setEditingSnippet] = useState<CommandSnippet | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Sinkronisasi otomatis saat pengguna beralih terminal (Windows vs Linux/WSL vs Dashboard)
  useEffect(() => {
    setSelectedPlatform(activePlatform);
    setActiveCategory('all');
  }, [activePlatform]);

  const reloadSnippets = useCallback(async () => {
    try {
      const list = await window.ssh.snippets.list();
      setSnippets(list);
    } catch {
      // Abaikan jika store belum siap
    }
  }, []);

  useEffect(() => {
    void reloadSnippets();
  }, [reloadSnippets]);

  // Snippets yang valid sesuai platform aktif
  const platformSnippets = useMemo(() => {
    if (selectedPlatform === 'windows') {
      return snippets.filter((s) => !s.platform || s.platform === 'windows' || s.platform === 'all');
    }
    if (selectedPlatform === 'linux') {
      return snippets.filter((s) => !s.platform || s.platform === 'linux' || s.platform === 'all');
    }
    return snippets;
  }, [snippets, selectedPlatform]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of platformSnippets) {
      if (s.category) set.add(s.category);
    }
    return ['all', ...Array.from(set).sort()];
  }, [platformSnippets]);

  const filteredSnippets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return platformSnippets.filter((s) => {
      if (activeCategory !== 'all' && s.category !== activeCategory) return false;
      if (!needle) return true;
      return (
        s.name.toLowerCase().includes(needle) ||
        s.command.toLowerCase().includes(needle) ||
        (s.description?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [platformSnippets, activeCategory, search]);

  const handleSnippetClick = (snippet: CommandSnippet, forceInsert = false) => {
    const vars = extractSnippetVariables(snippet.command);
    if (vars.length > 0) {
      setSelectedSnippetForVar(snippet);
    } else {
      dispatchTerminalExec(snippet.command, !forceInsert);
    }
  };

  const handleSaveSnippet = async (input: CommandSnippetCreateInput, existingId?: string) => {
    if (existingId) {
      await window.ssh.snippets.update(existingId, input);
    } else {
      await window.ssh.snippets.create(input);
    }
    await reloadSnippets();
  };

  const handleDeleteSnippet = async (id: string) => {
    await window.ssh.snippets.remove(id);
    await reloadSnippets();
  };

  return (
    <>
      <div className="shrink-0 border-t border-line/60 bg-surface/95 px-3 py-2.5 backdrop-blur-md shadow-lg transition-all z-20">
        {/* Baris Kontrol Atas: Judul, Pemilih OS, Kategori, Pencarian, Tambah, Tutup */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 overflow-x-auto text-xs py-0.5">
            <span className="flex items-center gap-1 font-bold text-azure mr-1 text-[11px] shrink-0">
              <span>⚡</span>
              <span>{t('snippets.barTitle')}</span>
            </span>

            {/* Filter OS / Platform Switcher */}
            <div className="flex items-center rounded-lg border border-line bg-abyss p-0.5 text-[10px] shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSelectedPlatform('windows');
                  setActiveCategory('all');
                }}
                className={`rounded px-1.5 py-0.5 font-medium transition-colors flex items-center gap-1 ${
                  selectedPlatform === 'windows'
                    ? 'bg-azure text-white font-bold shadow-sm'
                    : 'text-faint hover:text-fg'
                }`}
                title="Tampilkan snippet untuk Windows PowerShell / CMD"
              >
                <span>🪟</span>
                <span>Windows</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedPlatform('linux');
                  setActiveCategory('all');
                }}
                className={`rounded px-1.5 py-0.5 font-medium transition-colors flex items-center gap-1 ${
                  selectedPlatform === 'linux'
                    ? 'bg-azure text-white font-bold shadow-sm'
                    : 'text-faint hover:text-fg'
                }`}
                title="Tampilkan snippet untuk Linux & WSL"
              >
                <span>🐧</span>
                <span>Linux/WSL</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedPlatform('all');
                  setActiveCategory('all');
                }}
                className={`rounded px-1.5 py-0.5 font-medium transition-colors ${
                  selectedPlatform === 'all'
                    ? 'bg-azure text-white font-bold shadow-sm'
                    : 'text-faint hover:text-fg'
                }`}
                title="Tampilkan semua snippet tanpa filter OS"
              >
                <span>🌐 {t('snippets.platformAll')}</span>
              </button>
            </div>

            <div className="h-3 w-px bg-line/60 shrink-0 mx-0.5" />

            {/* Category Pills */}
            <div className="flex items-center gap-1 overflow-x-auto">
              {categories.map((cat) => {
                const active = activeCategory === cat;
                const color = cat === 'all' ? undefined : CATEGORY_COLORS[cat];
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors shrink-0 ${
                      active
                        ? 'bg-azure text-white shadow-sm'
                        : 'text-muted hover:bg-hover hover:text-fg'
                    }`}
                    style={!active && color ? { borderLeft: `3px solid ${color}` } : undefined}
                  >
                    {cat === 'all' ? t('palette.all') : cat}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick search input */}
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('snippets.searchPlaceholder')}
                className="aspro-input h-6 w-28 px-2 text-[11px] focus:w-40 transition-all"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-faint hover:text-fg"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Expand / Collapse Button */}
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className={`flex h-6 w-6 items-center justify-center rounded border border-line bg-raised text-[10px] transition-colors ${
                isExpanded ? 'text-azure border-azure/40 font-bold' : 'text-muted hover:border-azure hover:text-fg'
              }`}
              title={isExpanded ? 'Tampilan Ringkas' : 'Perluas Bilah Snippets'}
            >
              {isExpanded ? '▼' : '▲'}
            </button>

            {/* Tambah Snippet Button */}
            <button
              type="button"
              onClick={() => {
                setEditingSnippet(null);
                setIsFormOpen(true);
              }}
              className="flex h-6 items-center gap-1 rounded border border-line bg-raised px-2 text-[11px] text-muted hover:border-azure hover:text-fg transition-colors"
              title={t('snippets.addSnippet')}
            >
              <span>+</span>
              <span className="hidden sm:inline">{t('snippets.add')}</span>
            </button>

            {/* Close Bar Button */}
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-hover text-faint hover:text-fg text-xs"
              title={t('settings.close')}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Snippet Pills Horizontal List / Wrap */}
        <div
          className={`flex flex-wrap items-center gap-1.5 overflow-y-auto pr-1 pb-1 transition-[max-height] duration-200 ${
            isExpanded ? 'max-h-60' : 'max-h-28'
          }`}
        >
          {filteredSnippets.length === 0 ? (
            <div className="py-2 text-xs text-faint italic">
              {snippets.length === 0 ? t('snippets.noSnippets') : t('snippets.noMatches')}
            </div>
          ) : (
            filteredSnippets.map((snippet) => {
              const catColor = CATEGORY_COLORS[snippet.category] || '#6366f1';
              const hasVars = extractSnippetVariables(snippet.command).length > 0;

              return (
                <div
                  key={snippet.id}
                  className="group flex items-center rounded border border-line/70 bg-raised text-xs hover:border-line hover:bg-hover transition-all"
                  title={`${snippet.name}\n[${snippet.platform || 'all'}]\n$ ${snippet.command}${
                    snippet.description ? `\n\n${snippet.description}` : ''
                  }`}
                >
                  {/* Category dot */}
                  <span
                    className="ml-2 h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: catColor }}
                  />

                  {/* Main Click Button (Runs command) */}
                  <button
                    type="button"
                    onClick={() => handleSnippetClick(snippet, false)}
                    className="flex items-center gap-1.5 py-1 px-2 font-medium text-dim hover:text-fg"
                  >
                    <span>{snippet.name}</span>
                    {hasVars && (
                      <span className="rounded bg-azure/20 px-1 text-[9px] font-mono text-azure">
                        {`{...}`}
                      </span>
                    )}
                  </button>

                  {/* Hover Actions: Insert without executing, or Edit */}
                  <div className="hidden items-center gap-0.5 border-l border-line/50 px-1 group-hover:flex">
                    <button
                      type="button"
                      onClick={() => handleSnippetClick(snippet, true)}
                      className="p-0.5 text-[10px] text-faint hover:text-azure"
                      title={t('snippets.insertTooltip')}
                    >
                      📋
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSnippet(snippet);
                        setIsFormOpen(true);
                      }}
                      className="p-0.5 text-[10px] text-faint hover:text-fg"
                      title={t('snippets.editTooltip')}
                    >
                      ✏️
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Variable interpolation modal */}
      {selectedSnippetForVar && (
        <SnippetVariableModal
          snippet={selectedSnippetForVar}
          onExecute={(cmd, enter) => dispatchTerminalExec(cmd, enter)}
          onClose={() => setSelectedSnippetForVar(null)}
        />
      )}

      {/* Snippet Create / Edit modal */}
      {isFormOpen && (
        <SnippetFormModal
          existing={editingSnippet}
          onSave={handleSaveSnippet}
          onDelete={handleDeleteSnippet}
          onClose={() => {
            setIsFormOpen(false);
            setEditingSnippet(null);
          }}
        />
      )}
    </>
  );
}

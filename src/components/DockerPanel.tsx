import { useEffect, useMemo, useState } from 'react';
import type { ContainerAction, DockerContainerInfo } from '../shared/types';
import { useI18n } from '../i18n';

/**
 * Panel Docker container manager — daftar container (`docker ps -a`) di
 * server yang sedang aktif, start/stop/restart, dan buka tab log live.
 * Struktur sama seperti ServicesPanel (systemd): query sekali per refresh,
 * bukan polling terus-menerus, karena daftar container juga jarang berubah
 * dibanding metrik Monitor.
 */

interface DockerPanelProps {
  sessionId: string;
  onOpenLogs: (sessionId: string, containerId: string, containerName: string) => void;
}

const STATE_COLOR: Record<string, string> = {
  running: '#58e879',
  restarting: '#ffb52e',
  paused: '#ffb52e',
  created: '#5b6275',
  exited: '#5b6275',
  dead: '#ff5d5d',
};

export function DockerPanel({ sessionId, onOpenLogs }: DockerPanelProps) {
  const { t } = useI18n();
  const [containers, setContainers] = useState<DockerContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState<DockerContainerInfo | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setContainers(await window.ssh.docker.list(sessionId));
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [sessionId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return containers
      .filter((c) => showAll || c.state === 'running')
      .filter(
        (c) =>
          !query ||
          c.name.toLowerCase().includes(query) ||
          c.image.toLowerCase().includes(query),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [containers, search, showAll]);

  const runAction = async (id: string, action: ContainerAction) => {
    setPending(id);
    setActionError(null);
    try {
      await window.ssh.docker.action(sessionId, id, action);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="aspro-local-panel">
      <div className="aspro-local-title">
        <div>
          <span>{t('nav.docker')}</span>
          <small>{t('docker.subtitle', { count: filtered.length })}</small>
        </div>
        <button onClick={() => void refresh()} title={t('service.refresh')}>
          ⟳
        </button>
      </div>

      <div className="aspro-search">
        <span>⌕</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('docker.searchPlaceholder')}
          aria-label={t('docker.searchPlaceholder')}
        />
        <button
          onClick={() => setShowAll((v) => !v)}
          title={showAll ? t('docker.showAllOn') : t('docker.showAllOff')}
        >
          {showAll ? '◉' : '◎'}
        </button>
      </div>

      {actionError && (
        <div className="mx-1 mt-2 rounded border border-coral/40 bg-coral/10 px-3 py-2 text-[11px] text-coral">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="aspro-local-empty">{t('sftp.loading')}</div>
      ) : loadError ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('service.error')}</strong>
          <span>{loadError}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('docker.empty')}</strong>
          <span>{showAll ? t('docker.emptyDetail') : t('docker.emptyRunningDetail')}</span>
        </div>
      ) : (
        <div className="aspro-local-list">
          {filtered.map((c) => {
            const isRunning = c.state === 'running';
            return (
              <div key={c.id} className="aspro-local-row group">
                <span
                  className="aspro-local-icon"
                  style={{ color: STATE_COLOR[c.state] ?? '#5b6275' }}
                  title={c.status}
                >
                  ●
                </span>
                <div className="min-w-0 flex-1">
                  <strong>{c.name}</strong>
                  <small className="font-mono">{c.image}</small>
                  <small>{c.status}</small>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onOpenLogs(sessionId, c.id, c.name)}
                    title={t('docker.logs')}
                    className="rounded px-1.5 py-1 text-faint opacity-0 hover:bg-line hover:text-fg focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure group-hover:opacity-100"
                  >
                    ▤
                  </button>
                  <button
                    disabled={pending === c.id}
                    onClick={() => void runAction(c.id, isRunning ? 'restart' : 'start')}
                    title={isRunning ? t('docker.restart') : t('docker.start')}
                    className="rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:opacity-30"
                  >
                    {isRunning ? '⟳' : '▶'}
                  </button>
                  <button
                    disabled={pending === c.id || !isRunning}
                    onClick={() => setConfirmStop(c)}
                    title={t('docker.stop')}
                    className="rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:opacity-30"
                  >
                    ■
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="break-all text-sm font-semibold text-fg">
              {t('docker.stopConfirmTitle', { name: confirmStop.name })}
            </h2>
            <p className="mt-2 text-xs text-muted">{t('docker.stopConfirmDesc')}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setConfirmStop(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={() => {
                  const id = confirmStop.id;
                  setConfirmStop(null);
                  void runAction(id, 'stop');
                }}
                className="rounded bg-coral px-4 py-2 text-sm font-medium text-abyss hover:bg-coral-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('docker.stop')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

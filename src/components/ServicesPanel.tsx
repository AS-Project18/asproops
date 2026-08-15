import { useEffect, useMemo, useState } from 'react';
import type { ServiceAction, ServiceInfo } from '../shared/types';
import { useI18n } from '../i18n';

/**
 * Panel Service Manager — mendeteksi unit systemd di server yang sedang
 * aktif dan menyediakan start/stop/restart. Statusnya di-query lewat
 * `systemctl list-units`, bukan dipoll otomatis seperti Monitor, karena
 * daftar layanan jauh lebih jarang berubah daripada CPU/RAM.
 */

interface ServicesPanelProps {
  sessionId: string;
  /** Nama unit yang mau langsung disorot di kotak pencarian, mis. dari chip di ProjectsPanel. */
  focusService?: string | null;
}

const STATE_COLOR: Record<string, string> = {
  active: '#58e879',
  reloading: '#58e879',
  activating: '#ffb52e',
  deactivating: '#ffb52e',
  inactive: '#5b6275',
  failed: '#ff5d5d',
};

export function ServicesPanel({ sessionId, focusService }: ServicesPanelProps) {
  const { t } = useI18n();
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState<ServiceInfo | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setServices(await window.ssh.service.list(sessionId));
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [sessionId]);

  useEffect(() => {
    if (focusService) setSearch(focusService);
  }, [focusService]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return services
      .filter((svc) => showAll || svc.activeState === 'active')
      .filter(
        (svc) =>
          !query ||
          svc.name.toLowerCase().includes(query) ||
          svc.description.toLowerCase().includes(query),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [services, search, showAll]);

  const runAction = async (unit: string, action: ServiceAction) => {
    setPending(unit);
    setActionError(null);
    try {
      await window.ssh.service.action(sessionId, unit, action);
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
          <span>{t('nav.services')}</span>
          <small>{t('service.subtitle', { count: filtered.length })}</small>
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
          placeholder={t('service.searchPlaceholder')}
          aria-label={t('service.searchPlaceholder')}
        />
        <button
          onClick={() => setShowAll((v) => !v)}
          title={showAll ? t('service.showAllOn') : t('service.showAllOff')}
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
          <strong className="mb-1 block text-dim">{t('service.empty')}</strong>
          <span>{showAll ? t('service.emptyDetail') : t('service.emptyRunningDetail')}</span>
        </div>
      ) : (
        <div className="aspro-local-list">
          {filtered.map((svc) => (
            <div key={svc.name} className="aspro-local-row group">
              <span
                className="aspro-local-icon"
                style={{ color: STATE_COLOR[svc.activeState] ?? '#5b6275' }}
                title={`${svc.activeState} / ${svc.subState}`}
              >
                ●
              </span>
              <div className="min-w-0 flex-1">
                <strong>{svc.name}</strong>
                <small>{svc.description || svc.subState}</small>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  disabled={pending === svc.name}
                  onClick={() => void runAction(svc.name, 'start')}
                  title={t('service.start')}
                  className="rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:opacity-30"
                >
                  ▶
                </button>
                <button
                  disabled={pending === svc.name}
                  onClick={() => void runAction(svc.name, 'restart')}
                  title={t('service.restart')}
                  className="rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:opacity-30"
                >
                  ⟳
                </button>
                <button
                  disabled={pending === svc.name}
                  onClick={() => setConfirmStop(svc)}
                  title={t('service.stop')}
                  className="rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:opacity-30"
                >
                  ■
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="break-all text-sm font-semibold text-fg">
              {t('service.stopConfirmTitle', { name: confirmStop.name })}
            </h2>
            <p className="mt-2 text-xs text-muted">{t('service.stopConfirmDesc')}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setConfirmStop(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={() => {
                  const unit = confirmStop.name;
                  setConfirmStop(null);
                  void runAction(unit, 'stop');
                }}
                className="rounded bg-coral px-4 py-2 text-sm font-medium text-abyss hover:bg-coral-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('service.stop')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

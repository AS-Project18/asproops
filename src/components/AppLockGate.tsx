import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useI18n } from '../i18n';

/**
 * Gerbang di depan seluruh aplikasi. Kalau kunci aplikasi belum diatur
 * (belum pernah setup PIN di Settings), ini langsung transparan — anak
 * (App) dirender apa adanya. Kalau sudah diatur, App baru dirender setelah
 * PIN diverifikasi lewat main process untuk sesi proses ini.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<{
    enabled: boolean;
    locked: boolean;
    idleMinutes: number;
  } | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.ssh.appLock.status().then(setStatus);
    // relock() dipanggil dari effect idle-timer di bawah — status di sini
    // perlu ikut diperbarui supaya layar PIN benar-benar muncul lagi.
    return window.ssh.appLock.onChanged(setStatus);
  }, []);

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = setInterval(() => setRetrySeconds((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, [retrySeconds]);

  // Kunci ulang otomatis setelah sekian menit tanpa aktivitas mouse/keyboard
  // — cuma jalan kalau lock sudah diaktifkan, sedang terbuka, dan
  // idleMinutes > 0 (0 berarti dimatikan oleh pengguna).
  useEffect(() => {
    if (!status?.enabled || status.locked || status.idleMinutes <= 0) return;

    const timeoutMs = status.idleMinutes * 60_000;
    let timer: ReturnType<typeof setTimeout>;

    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void window.ssh.appLock.relock(), timeoutMs);
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of activityEvents) window.addEventListener(name, reset, { passive: true });
    reset();

    return () => {
      clearTimeout(timer);
      for (const name of activityEvents) window.removeEventListener(name, reset);
    };
  }, [status?.enabled, status?.locked, status?.idleMinutes]);

  // Belum tahu status → jangan kedipkan konten sebelum keputusan final ada.
  if (!status) return null;
  if (!status.enabled || !status.locked) return <>{children}</>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || retrySeconds > 0 || !pin) return;
    setBusy(true);
    setError(null);
    const result = await window.ssh.appLock.verify(pin);
    setBusy(false);

    if (result.ok) {
      setStatus((prev) => (prev ? { ...prev, enabled: true, locked: false } : prev));
      return;
    }

    setPin('');
    if (result.retryAfterMs) {
      setRetrySeconds(Math.ceil(result.retryAfterMs / 1000));
    } else {
      setError(t('applock.wrongPin'));
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-abyss p-6">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-xs rounded-lg border border-line bg-raised p-6"
      >
        <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-orange">ASProOps</div>
        <h2 className="text-sm font-semibold text-fg">{t('applock.lockTitle')}</h2>
        <p className="mt-2 text-xs text-muted">{t('applock.lockSubtitle')}</p>

        <input
          type="password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={busy || retrySeconds > 0}
          placeholder={t('applock.placeholder')}
          className="aspro-input mt-4 w-full px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
        />

        {(error || retrySeconds > 0) && (
          <p className="mt-2 text-xs text-coral">
            {retrySeconds > 0
              ? t('applock.tooManyAttempts', { seconds: retrySeconds })
              : error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || retrySeconds > 0 || !pin}
          className="aspro-button aspro-button-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('applock.unlock')}
        </button>
      </form>
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthLogOpenResult } from '../shared/types';
import { LogStreamView } from './LogView';
import { AuthLogEventsView } from './AuthLogEventsView';
import { useI18n } from '../i18n';

/**
 * Log login SSH milik SERVER (journalctl/auth.log lewat sshd) — mencakup
 * login dari klien mana pun, bukan cuma yang dibuka lewat ASProOps. Beda
 * dari histori koneksi lokal app ini sendiri.
 *
 * Membaca log ini lazimnya butuh privilese; alurnya:
 *   1. coba akses langsung
 *   2. coba `sudo -n` (jalan kalau NOPASSWD sudah dikonfigurasi)
 *   3. kalau masih butuh password, tanya lewat form di bawah — password
 *      cuma dikirim lewat IPC ke main process dan mengalir ke stdin channel
 *      SSH, tidak pernah disimpan ke disk.
 */

interface AuthLogPanelProps {
  sessionId: string;
  active: boolean;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'needsPassword'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; tailId: string; label: string };

type ViewMode = 'ringkas' | 'mentah';

export function AuthLogPanel({ sessionId, active }: AuthLogPanelProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('ringkas');
  const requestIdRef = useRef(0);
  // tailId yang lagi "dipegang" panel ini — dipakai supaya open (di sini)
  // dan close (juga di sini) selalu simetris, sesuai siapa yang membuka.
  // Lihat catatan panjang di LogStreamView soal kenapa LogStreamView sendiri
  // TIDAK boleh menutup tailId yang cuma diterima lewat prop.
  const tailIdRef = useRef<string | null>(null);

  const closeCurrentTail = () => {
    if (tailIdRef.current) {
      window.ssh.log.close(tailIdRef.current);
      tailIdRef.current = null;
    }
  };

  const applyResult = (result: AuthLogOpenResult) => {
    if (result.ok) {
      tailIdRef.current = result.tailId;
      setPhase({ kind: 'ready', tailId: result.tailId, label: result.label });
      return;
    }
    if (result.needsPassword) {
      setPhase({ kind: 'needsPassword', label: result.label });
      return;
    }
    setPhase({ kind: 'error', message: result.message });
  };

  const probe = () => {
    closeCurrentTail();
    const requestId = (requestIdRef.current += 1);
    setPassword('');
    setPasswordError(null);
    setPhase({ kind: 'loading' });
    void window.ssh.authLog.open(sessionId).then((result) => {
      if (requestIdRef.current !== requestId) {
        // Percobaan ini sudah usang (mis. React StrictMode memanggil efek
        // mount dua kali di dev, atau sessionId sudah berganti sebelum ini
        // selesai) — tutup tailId yang terlanjur kebuka di percobaan basi
        // ini, jangan biarkan jadi proses journalctl -f/tail -F yang
        // menggantung di server tanpa pernah ditonton.
        if (result.ok) window.ssh.log.close(result.tailId);
        return;
      }
      applyResult(result);
    });
  };

  useEffect(() => {
    probe();
    return () => closeCurrentTail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setPasswordError(null);
    const requestId = (requestIdRef.current += 1);
    const result = await window.ssh.authLog.openWithPassword(sessionId, password);
    setBusy(false);
    setPassword('');
    if (requestIdRef.current !== requestId) return;

    // authlog:openWithPassword tidak pernah membalas needsPassword:true (itu
    // cuma untuk authlog:open) — tapi tetap dicek di sini karena keduanya
    // berbagi tipe AuthLogOpenResult yang sama. Password salah maupun
    // kegagalan sudo lain ditampilkan inline di form, bukan mengganti
    // seluruh panel jadi layar error.
    if (!result.ok && !result.needsPassword) {
      setPasswordError(result.message);
      return;
    }
    if (!result.ok) return;
    applyResult(result);
  };

  if (phase.kind === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-abyss p-8 text-center">
        <p className="text-xs text-faint">{t('authlog.checking')}</p>
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div className="flex h-full items-center justify-center bg-abyss p-8 text-center">
        <div className="max-w-sm">
          <p className="text-sm text-coral">{t('authlog.errorTitle')}</p>
          <p className="mt-2 text-xs text-muted">{phase.message}</p>
          <button className="aspro-button mt-4" onClick={probe}>
            {t('authlog.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'needsPassword') {
    return (
      <div className="flex h-full items-center justify-center bg-abyss p-8 text-center">
        <form
          onSubmit={(e) => void submitPassword(e)}
          className="w-full max-w-xs rounded-lg border border-line bg-raised p-6 text-left"
        >
          <h2 className="text-sm font-semibold text-fg">{t('authlog.sudoTitle')}</h2>
          <p className="mt-2 text-xs text-muted">
            {t('authlog.sudoSubtitle', { label: phase.label })}
          </p>

          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            placeholder={t('authlog.sudoPlaceholder')}
            className="aspro-input mt-4 w-full px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
          />

          {passwordError && <p className="mt-2 text-xs text-coral">{passwordError}</p>}

          <button
            type="submit"
            disabled={busy || !password}
            className="aspro-button aspro-button-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? t('authlog.sudoVerifying') : t('authlog.sudoSubmit')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/70 px-3 py-1.5 text-[10px] text-faint">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
        <span className="uppercase tracking-wider">{t('authlog.source')}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-dim">{phase.label}</span>
        <div className="flex shrink-0 overflow-hidden rounded border border-line-soft">
          <button
            className={`px-2 py-0.5 ${viewMode === 'ringkas' ? 'bg-active text-dim' : 'text-faint hover:text-dim'}`}
            onClick={() => setViewMode('ringkas')}
          >
            {t('authlog.viewSummary')}
          </button>
          <button
            className={`px-2 py-0.5 ${viewMode === 'mentah' ? 'bg-active text-dim' : 'text-faint hover:text-dim'}`}
            onClick={() => setViewMode('mentah')}
          >
            {t('authlog.viewRaw')}
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* Dua-duanya selalu ter-mount (cuma disembunyikan via CSS) supaya
            keduanya tetap menerima data streaming-nya masing-masing —
            beralih tampilan tidak akan pernah kehilangan baris yang lewat
            saat sedang tidak dilihat. */}
        <div className={viewMode === 'ringkas' ? 'absolute inset-0' : 'pointer-events-none invisible absolute inset-0'}>
          <AuthLogEventsView sessionId={sessionId} tailId={phase.tailId} />
        </div>
        <div className={viewMode === 'mentah' ? 'absolute inset-0' : 'pointer-events-none invisible absolute inset-0'}>
          <LogStreamView tailId={phase.tailId} active={active && viewMode === 'mentah'} onExit={probe} />
        </div>
      </div>
    </div>
  );
}

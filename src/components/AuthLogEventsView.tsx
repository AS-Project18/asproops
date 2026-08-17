import { useEffect, useRef, useState } from 'react';
import { createAuthLogParser, type AuthFeedItem } from '../lib/authLogParse';
import { formatLogTimestamp, formatDurationShort } from '../lib/format';
import { useI18n } from '../i18n';

type TFunc = ReturnType<typeof useI18n>['t'];

/**
 * Tampilan ringkas log login — daftar kartu vertikal (bukan tabel kolom,
 * sidebar ini cuma ~330px lebar defaultnya) hasil parsing baris mentah
 * journalctl/auth.log jadi event login berhasil (digabung per PID) dan
 * kelompok percobaan gagal (digabung per IP, supaya scan bot yang kirim
 * ratusan "Failed password" tidak membanjiri daftar).
 *
 * Dua mode:
 *   - Live: ikuti tailId yang sedang streaming (default).
 *   - Rentang tanggal: query histori sekali-jalan lewat authLog.query,
 *     tidak nyambung ke tailId sama sekali.
 */

type Scope = { kind: 'live' } | { kind: 'range'; sinceMs: number; untilMs: number; label: string };

interface AuthLogEventsViewProps {
  sessionId: string;
  tailId: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function AuthLogEventsView({ sessionId, tailId }: AuthLogEventsViewProps) {
  const { t, language } = useI18n();
  const locale = language === 'en' ? 'en-US' : 'id-ID';
  const [scope, setScope] = useState<Scope>({ kind: 'live' });
  const [items, setItems] = useState<AuthFeedItem[]>([]);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const parserRef = useRef(createAuthLogParser());

  const presetToday = (): Scope => {
    const now = new Date();
    return { kind: 'range', sinceMs: startOfDay(now).getTime(), untilMs: endOfDay(now).getTime(), label: t('authlog.scopeToday') };
  };
  const presetYesterday = (): Scope => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return { kind: 'range', sinceMs: startOfDay(y).getTime(), untilMs: endOfDay(y).getTime(), label: t('authlog.scopeYesterday') };
  };
  const presetLast7Days = (): Scope => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return { kind: 'range', sinceMs: startOfDay(start).getTime(), untilMs: endOfDay(now).getTime(), label: t('authlog.scopeLast7') };
  };
  const presetForDate = (value: string): Scope | null => {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const [, y, m, d] = match;
    const picked = new Date(Number(y), Number(m) - 1, Number(d));
    return { kind: 'range', sinceMs: startOfDay(picked).getTime(), untilMs: endOfDay(picked).getTime(), label: formatLogTimestamp(picked.getTime(), locale) };
  };

  // Mode live: ikuti tailId yang sedang streaming.
  useEffect(() => {
    if (scope.kind !== 'live') return;
    parserRef.current = createAuthLogParser();
    setItems([]);

    return window.ssh.log.onData(({ tailId: source, data }) => {
      if (source !== tailId) return;
      if (parserRef.current.ingest(data)) setItems(parserRef.current.feed());
    });
  }, [tailId, scope.kind]);

  // Mode rentang tanggal: query sekali-jalan, tidak streaming.
  useEffect(() => {
    if (scope.kind !== 'range') return;
    let cancelled = false;
    setQueryLoading(true);
    setQueryError(null);
    setItems([]);

    void window.ssh.authLog.query(sessionId, scope.sinceMs, scope.untilMs).then((result) => {
      if (cancelled) return;
      setQueryLoading(false);
      if (!result.ok) {
        setQueryError(result.message);
        return;
      }
      const parser = createAuthLogParser();
      // Titik tengah rentang dipakai sebagai acuan tahun buat baris syslog
      // yang tidak menyertakan tahun — lebih akurat daripada "sekarang"
      // untuk rentang yang jauh di masa lalu.
      //
      // "\n" tambahan sengaja diselipkan: ingest() menahan potongan TERAKHIR
      // sebagai "baris belum lengkap" (dirancang untuk chunk stream yang bisa
      // terpotong di tengah baris) — tanpa \n penutup ini, baris paling
      // akhir dari hasil query (yang di sini SUDAH lengkap, bukan potongan
      // stream) akan diam-diam tidak pernah diproses.
      parser.ingest(`${result.text}\n`, new Date((scope.sinceMs + scope.untilMs) / 2));
      setItems(parser.feed());
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId, scope]);

  const pill = (active: boolean) =>
    `shrink-0 rounded px-1.5 py-0.5 text-[10px] ${active ? 'bg-active text-dim' : 'text-faint hover:text-dim'}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line-soft bg-panel/40 px-2 py-1.5">
        <button className={pill(scope.kind === 'live')} onClick={() => setScope({ kind: 'live' })}>
          {t('authlog.scopeLive')}
        </button>
        <button className={pill(false)} onClick={() => setScope(presetToday())}>
          {t('authlog.scopeToday')}
        </button>
        <button className={pill(false)} onClick={() => setScope(presetYesterday())}>
          {t('authlog.scopeYesterday')}
        </button>
        <button className={pill(false)} onClick={() => setScope(presetLast7Days())}>
          {t('authlog.scopeLast7')}
        </button>
        <input
          type="date"
          className="min-w-0 flex-1 rounded border border-line-soft bg-transparent px-1 py-0.5 text-[10px] text-faint"
          onChange={(e) => {
            const next = presetForDate(e.target.value);
            if (next) setScope(next);
          }}
        />
      </div>

      {scope.kind === 'range' && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line-soft px-2 py-1 text-[10px] text-faint">
          <span>{t('authlog.scopeShowing', { label: scope.label })}</span>
        </div>
      )}

      {queryLoading ? (
        <div className="flex h-full items-center justify-center p-6 text-center">
          <p className="text-xs text-faint">{t('authlog.queryLoading')}</p>
        </div>
      ) : queryError ? (
        <div className="flex h-full items-center justify-center p-6 text-center">
          <p className="text-xs text-coral">{queryError}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-full items-center justify-center p-6 text-center">
          <p className="text-xs text-faint">
            {scope.kind === 'live' ? t('authlog.eventsEmpty') : t('authlog.eventsEmptyRange')}
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {items.map((item) =>
            item.kind === 'success' ? (
              <SuccessCard key={`s-${item.id}`} item={item} locale={locale} t={t} live={scope.kind === 'live'} />
            ) : (
              <FailedCard key={`f-${item.id}`} item={item} locale={locale} t={t} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function SuccessCard({
  item,
  locale,
  t,
  live,
}: {
  item: Extract<AuthFeedItem, { kind: 'success' }>;
  locale: string;
  t: TFunc;
  /**
   * "Masih aktif" cuma jujur ditampilkan di mode Live — di situ kita
   * BENERAN mengamati stream real-time, jadi kalau belum ada baris
   * "session closed" berarti sesi itu memang belum ditutup. Di mode
   * rentang tanggal (query sekali-jalan atas potongan log masa lalu),
   * closedAt null cuma berarti "tidak ada baris penutup TERLIHAT di
   * rentang yang di-query ini" — bukan bukti sesi itu masih hidup
   * sekarang. Klaim "masih aktif" di situ menyesatkan, jadi disembunyikan
   * saja daripada menampilkan status yang belum tentu benar.
   */
  live: boolean;
}) {
  const stillActive = item.closedAt === null;
  const claimActive = stillActive && live;
  return (
    <div className="flex items-start gap-2 rounded border border-line-soft bg-panel px-2.5 py-2">
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${claimActive ? 'bg-mint' : 'bg-faint'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-dim">
          {item.user} <span className="font-normal text-faint">· {item.ip}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-faint">
          {item.method} · {formatLogTimestamp(item.openedAt, locale)}
          {claimActive ? (
            <> · {t('authlog.stillActive')}</>
          ) : stillActive ? null : (
            <> → {formatLogTimestamp(item.closedAt as number, locale)} ({formatDurationShort((item.closedAt as number) - item.openedAt)})</>
          )}
        </div>
      </div>
    </div>
  );
}

function FailedCard({
  item,
  locale,
  t,
}: {
  item: Extract<AuthFeedItem, { kind: 'failed' }>;
  locale: string;
  t: TFunc;
}) {
  return (
    <div className="flex items-start gap-2 rounded border border-line-soft bg-panel px-2.5 py-2">
      <span className="mt-0.5 shrink-0 text-amber">⚠</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-amber">
          {t('authlog.failedCount', { count: item.count })} <span className="font-normal text-faint">· {item.ip}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-faint">
          {item.users.join(', ')} · {formatLogTimestamp(item.lastAt, locale)}
        </div>
      </div>
    </div>
  );
}

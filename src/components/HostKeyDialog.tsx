import { useEffect, useState } from 'react';

/**
 * Dialog verifikasi host key.
 *
 * Dua keadaan yang ditangani sangat berbeda bobotnya:
 *
 * - `unknown` — normal, terjadi setiap kali menghubungi server baru. Pengguna
 *   membandingkan fingerprint dengan yang dia ketahui, lalu menyimpan.
 * - `changed` — host key server berubah dari yang tersimpan. Bisa jadi server
 *   di-reinstall, bisa jadi ada yang menyadap. Aksi utama di sini adalah
 *   MEMBATALKAN, dan menerima butuh konfirmasi eksplisit.
 */

export interface HostKeyPromptPayload {
  promptId: string;
  sessionId: string;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  storedFingerprint?: string;
  changed: boolean;
}

/** Potong fingerprint jadi kelompok pendek supaya bisa dibandingkan mata. */
function chunk(fingerprint: string): string {
  const [prefix, body] = fingerprint.split(':');
  if (!body) return fingerprint;
  return `${prefix}:${body.match(/.{1,8}/g)?.join(' ') ?? body}`;
}

export function useHostKeyPrompts() {
  const [queue, setQueue] = useState<HostKeyPromptPayload[]>([]);

  useEffect(
    () =>
      window.ssh.ssh.onHostKeyPrompt((payload) =>
        setQueue((prev) => [...prev, payload as unknown as HostKeyPromptPayload]),
      ),
    [],
  );

  const respond = async (promptId: string, trust: boolean) => {
    await window.ssh.ssh.respondToHostKey(promptId, trust);
    setQueue((prev) => prev.filter((p) => p.promptId !== promptId));
  };

  return { prompt: queue[0] ?? null, respond };
}

interface HostKeyDialogProps {
  prompt: HostKeyPromptPayload;
  onRespond: (promptId: string, trust: boolean) => void;
}

export function HostKeyDialog({ prompt, onRespond }: HostKeyDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const target = prompt.port === 22 ? prompt.host : `${prompt.host}:${prompt.port}`;

  // Reset centang saat prompt berganti, supaya persetujuan untuk satu server
  // tidak terbawa ke server berikutnya di antrean.
  useEffect(() => setAcknowledged(false), [prompt.promptId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hostkey-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-raised shadow-2xl"
      >
        <div
          className={`px-6 py-4 ${
            prompt.changed ? 'bg-danger-header text-coral' : 'bg-active text-fg'
          }`}
        >
          <h2 id="hostkey-title" className="text-base font-semibold">
            {prompt.changed
              ? 'Host key server ini berubah'
              : `Server ${target} belum dikenal`}
          </h2>
        </div>

        <div className="space-y-4 px-6 py-5 text-sm text-dim">
          {prompt.changed ? (
            <p>
              Kunci yang dikirim <span className="text-fg">{target}</span> berbeda dari
              yang tersimpan di <code className="text-azure">known_hosts</code>. Ini terjadi
              kalau server dipasang ulang atau kuncinya diganti — tapi juga terjadi kalau ada
              pihak lain yang menyamar sebagai server ini. Hubungi administrator server sebelum
              melanjutkan.
            </p>
          ) : (
            <p>
              Ini pertama kalinya kamu menghubungi <span className="text-fg">{target}</span>.
              Cocokkan fingerprint di bawah dengan yang kamu dapat langsung dari server, lalu
              simpan supaya koneksi berikutnya diverifikasi otomatis.
            </p>
          )}

          <dl className="space-y-3 rounded border border-line bg-abyss p-4 font-mono text-xs">
            <div>
              <dt className="text-muted">Tipe kunci</dt>
              <dd className="mt-1 text-fg">{prompt.keyType}</dd>
            </div>
            <div>
              <dt className="text-muted">
                {prompt.changed ? 'Fingerprint yang dikirim sekarang' : 'Fingerprint'}
              </dt>
              <dd className={`mt-1 break-all ${prompt.changed ? 'text-coral' : 'text-mint'}`}>
                {chunk(prompt.fingerprint)}
              </dd>
            </div>
            {prompt.storedFingerprint && (
              <div>
                <dt className="text-muted">Fingerprint yang tersimpan sebelumnya</dt>
                <dd className="mt-1 break-all text-fg">
                  {chunk(prompt.storedFingerprint)}
                </dd>
              </div>
            )}
          </dl>

          <p className="text-xs text-muted">
            Di server, jalankan{' '}
            <code className="text-azure">
              ssh-keygen -lf /etc/ssh/ssh_host_{prompt.keyType.replace('ssh-', '')}_key.pub
            </code>{' '}
            untuk melihat fingerprint aslinya.
          </p>

          {prompt.changed && (
            <label className="flex items-start gap-3 rounded border border-danger-line bg-danger-surface p-3 text-xs text-fg">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-coral"
              />
              <span>
                Saya sudah mengonfirmasi ke administrator bahwa kunci server memang diganti.
              </span>
            </label>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-line bg-active px-6 py-4">
          <button
            onClick={() => onRespond(prompt.promptId, false)}
            className={`rounded px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-azure ${
              prompt.changed
                ? 'bg-fg text-abyss hover:bg-white'
                : 'text-dim hover:text-fg'
            }`}
          >
            Batalkan koneksi
          </button>
          <button
            onClick={() => onRespond(prompt.promptId, true)}
            disabled={prompt.changed && !acknowledged}
            className={`rounded px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:cursor-not-allowed disabled:opacity-40 ${
              prompt.changed
                ? 'border border-coral text-coral hover:bg-danger-header'
                : 'bg-mint text-abyss hover:bg-mint-bright'
            }`}
          >
            {prompt.changed ? 'Ganti kunci tersimpan' : 'Simpan dan hubungkan'}
          </button>
        </div>
      </div>
    </div>
  );
}

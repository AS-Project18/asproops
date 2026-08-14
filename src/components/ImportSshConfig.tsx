import { useEffect, useMemo, useState } from 'react';

/**
 * Dialog import dari `~/.ssh/config`.
 *
 * Host yang sudah punya session dengan host, port, dan pengguna sama
 * ditandai dan tidak bisa dipilih — mengimpor berkas config yang sama dua
 * kali seharusnya tidak menghasilkan daftar server ganda.
 */

interface Candidate {
  alias: string;
  host: string;
  port: number;
  username?: string;
  identityFile?: string;
  proxyJump?: string;
  alreadyImported: boolean;
}

interface ImportSshConfigProps {
  onDone: (result: { imported: number; linked: number }) => void;
  onCancel: () => void;
}

export function ImportSshConfig({ onDone, onCancel }: ImportSshConfigProps) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const found = await window.ssh.sshConfig.scan();
        setCandidates(found);
        // Pilih otomatis semua yang belum pernah diimpor — itu yang
        // hampir selalu diinginkan saat pertama kali membuka dialog ini.
        setSelected(new Set(found.filter((c) => !c.alreadyImported).map((c) => c.alias)));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const importable = useMemo(() => candidates.filter((c) => !c.alreadyImported), [candidates]);
  const allSelected = importable.length > 0 && selected.size === importable.length;

  const toggle = (alias: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      onDone(await window.ssh.sshConfig.import([...selected], group));
    } catch (err) {
      setError((err as Error).message);
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-raised shadow-2xl">
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-fg">Import dari ~/.ssh/config</h2>
          <p className="mt-1 text-xs text-muted">
            Password tidak tersimpan di berkas config, jadi server yang tidak menyebut
            IdentityFile akan diimpor memakai SSH agent. Kamu bisa mengubahnya per server
            setelah import.
          </p>
        </div>

        {loading ? (
          <p className="p-10 text-center text-sm text-faint">Membaca berkas config…</p>
        ) : candidates.length === 0 ? (
          <div className="p-10 text-center text-sm text-faint">
            <p>Tidak ada host konkret yang ditemukan di ~/.ssh/config.</p>
            <p className="mt-2 text-xs">
              Entri dengan pola wildcard seperti{' '}
              <code className="font-mono text-azure">Host *</code> dilewati karena bukan
              server tertentu.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-line px-6 py-2.5">
              <label className="flex items-center gap-2 text-xs text-dim">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? new Set(importable.map((c) => c.alias)) : new Set(),
                    )
                  }
                  disabled={importable.length === 0}
                  className="h-3.5 w-3.5 accent-mint"
                />
                Pilih semua
              </label>
              <span className="text-xs text-faint">
                {selected.size} dari {importable.length} dipilih
              </span>
              <input
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="Masukkan ke grup (opsional)"
                className="ml-auto w-56 rounded border border-line bg-abyss px-3 py-1 text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-panel text-left text-faint">
                  <tr>
                    <th className="w-10 px-4 py-2" />
                    <th className="px-4 py-2 font-normal">Alias</th>
                    <th className="px-4 py-2 font-normal">Tujuan</th>
                    <th className="px-4 py-2 font-normal">Autentikasi</th>
                    <th className="px-4 py-2 font-normal">Bastion</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr
                      key={candidate.alias}
                      className={`border-t border-line-soft ${
                        candidate.alreadyImported ? 'opacity-40' : 'hover:bg-hover'
                      }`}
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(candidate.alias)}
                          disabled={candidate.alreadyImported}
                          onChange={() => toggle(candidate.alias)}
                          aria-label={`Pilih ${candidate.alias}`}
                          className="h-3.5 w-3.5 accent-mint"
                        />
                      </td>
                      <td className="px-4 py-2 font-mono text-fg">
                        {candidate.alias}
                        {candidate.alreadyImported && (
                          <span className="ml-2 text-faint">(sudah ada)</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-dim">
                        {candidate.username ? `${candidate.username}@` : ''}
                        {candidate.host}
                        {candidate.port !== 22 && `:${candidate.port}`}
                      </td>
                      <td className="px-4 py-2 text-muted">
                        {candidate.identityFile ? (
                          <span className="font-mono">
                            {candidate.identityFile.split(/[\\/]/).pop()}
                          </span>
                        ) : (
                          'SSH agent'
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-muted">
                        {candidate.proxyJump ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {error && <p className="border-t border-line px-6 py-3 text-sm text-coral">{error}</p>}

        <div className="flex justify-end gap-3 border-t border-line bg-active px-6 py-4">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            Batal
          </button>
          <button
            onClick={() => void handleImport()}
            disabled={selected.size === 0 || importing}
            className="rounded bg-mint px-4 py-2 text-sm font-medium text-abyss hover:bg-mint-bright disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            {importing ? 'Mengimpor…' : `Import ${selected.size} server`}
          </button>
        </div>
      </div>
    </div>
  );
}

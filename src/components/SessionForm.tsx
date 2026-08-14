import type { ReactNode } from 'react';
import { useState } from 'react';
import type { AuthMethod, SessionConfig, Secret } from '../shared/types';

/**
 * Form tambah/ubah server.
 *
 * Password hanya dikirim ke proses main saat disimpan; setelah itu tidak
 * pernah dibaca kembali ke renderer. Karena itu saat mengubah server yang
 * sudah ada, kolom password tampil kosong dan hanya menimpa nilai lama
 * jika benar-benar diisi.
 */

const LABEL_COLORS = [
  { value: '', name: 'Tanpa warna' },
  { value: '#f07178', name: 'Merah — produksi' },
  { value: '#ffcb6b', name: 'Kuning — staging' },
  { value: '#6ee7b7', name: 'Hijau — pengembangan' },
  { value: '#82aaff', name: 'Biru — infrastruktur' },
  { value: '#c792ea', name: 'Ungu — lainnya' },
];

interface SessionFormProps {
  /** null berarti membuat server baru. */
  existing: SessionConfig | null;
  /** Kandidat jump host — server lain yang sudah tersimpan. */
  candidates: SessionConfig[];
  onSave: (
    config: Omit<SessionConfig, 'id' | 'createdAt'>,
    secret: Secret,
    existingId?: string,
  ) => Promise<void>;
  onCancel: () => void;
}

export function SessionForm({ existing, candidates, onSave, onCancel }: SessionFormProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [host, setHost] = useState(existing?.host ?? '');
  const [port, setPort] = useState(String(existing?.port ?? 22));
  const [username, setUsername] = useState(existing?.username ?? '');
  const [authMethod, setAuthMethod] = useState<AuthMethod>(existing?.authMethod ?? 'privateKey');
  const [privateKeyPath, setPrivateKeyPath] = useState(existing?.privateKeyPath ?? '');
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [group, setGroup] = useState(existing?.group ?? '');
  const [color, setColor] = useState(existing?.color ?? '');
  const [jumpHostId, setJumpHostId] = useState(existing?.jumpHostId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536;
  const canSave = name.trim() && host.trim() && username.trim() && portValid && !saving;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          name: name.trim(),
          host: host.trim(),
          port: portNumber,
          username: username.trim(),
          authMethod,
          privateKeyPath: authMethod === 'privateKey' ? privateKeyPath.trim() : undefined,
          group: group.trim() || undefined,
          color: color || undefined,
          jumpHostId: jumpHostId || undefined,
        },
        {
          password: authMethod === 'password' && password ? password : undefined,
          passphrase: authMethod === 'privateKey' && passphrase ? passphrase : undefined,
        },
        existing?.id,
      );
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6">
      <div className="aspro-dialog max-h-full w-full max-w-md overflow-y-auto shadow-2xl">
        <h2 className="border-b border-line px-6 py-4 text-base font-semibold text-fg">
          {existing ? `Ubah ${existing.name}` : 'Tambah server'}
        </h2>

        <div className="space-y-4 px-6 py-5">
          <Field label="Nama">
            <Input value={name} onChange={setName} placeholder="Web Server Produksi" autoFocus />
          </Field>

          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <Field label="Host">
              <Input value={host} onChange={setHost} placeholder="10.0.1.20" mono />
            </Field>
            <Field label="Port">
              <Input value={port} onChange={setPort} mono />
            </Field>
          </div>
          {!portValid && (
            <p className="text-xs text-coral">Port harus berupa angka antara 1 dan 65535.</p>
          )}

          <Field label="Nama pengguna">
            <Input value={username} onChange={setUsername} placeholder="root" mono />
          </Field>

          <Field label="Metode autentikasi">
            <div className="flex gap-2">
              {(
                [
                  ['privateKey', 'Private key'],
                  ['password', 'Password'],
                  ['agent', 'SSH agent'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setAuthMethod(value)}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange ${
                    authMethod === value
                      ? 'border-orange bg-orange/10 text-orange'
                      : 'border-line text-muted hover:text-dim'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {authMethod === 'privateKey' && (
            <>
              <Field label="Path private key">
                <Input
                  value={privateKeyPath}
                  onChange={setPrivateKeyPath}
                  placeholder="C:\Users\nama\.ssh\id_ed25519"
                  mono
                />
              </Field>
              <Field label={existing ? 'Passphrase baru (kosongkan jika tetap)' : 'Passphrase'}>
                <Input value={passphrase} onChange={setPassphrase} type="password" />
              </Field>
            </>
          )}

          {authMethod === 'password' && (
            <Field label={existing ? 'Password baru (kosongkan jika tetap)' : 'Password'}>
              <Input value={password} onChange={setPassword} type="password" />
            </Field>
          )}

          {authMethod === 'agent' && (
            <p className="rounded border border-line bg-abyss p-3 text-xs text-muted">
              Kunci diambil dari OpenSSH Agent Windows. Pastikan layanan
              <code className="mx-1 text-azure">ssh-agent</code>
              berjalan dan kunci sudah ditambahkan dengan
              <code className="ml-1 text-azure">ssh-add</code>.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Grup">
              <Input value={group} onChange={setGroup} placeholder="Produksi" />
            </Field>
            <Field label="Warna label">
              <select
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full rounded border border-line bg-abyss px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
              >
                {LABEL_COLORS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {candidates.length > 0 && (
            <Field label="Lewat jump host (opsional)">
              <select
                value={jumpHostId}
                onChange={(e) => setJumpHostId(e.target.value)}
                className="w-full rounded border border-line bg-abyss px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
              >
                <option value="">Koneksi langsung</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} ({candidate.host})
                  </option>
                ))}
              </select>
            </Field>
          )}

          {error && <p className="text-sm text-coral">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-line bg-active px-6 py-4">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="aspro-button aspro-button-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  mono = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`aspro-input w-full px-3 py-2 text-sm text-fg placeholder-faint ${
        mono ? 'font-mono' : ''
      }`}
    />
  );
}

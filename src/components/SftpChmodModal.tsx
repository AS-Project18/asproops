import { useState, useMemo } from 'react';
import type { RemoteFile } from '../shared/types';
import type { useI18n } from '../i18n';

type TFunc = ReturnType<typeof useI18n>['t'];

interface SftpChmodModalProps {
  sessionId: string;
  file: RemoteFile;
  onClose: () => void;
  onSaved: () => void;
  t: TFunc;
}

export function SftpChmodModal({
  sessionId,
  file,
  onClose,
  onSaved,
  t,
}: SftpChmodModalProps) {
  // Parse initial mode from file.mode (e.g. "0755" or "0644")
  const initialOctal = useMemo(() => {
    const raw = file.mode.replace(/\D/g, '');
    const clean = raw.slice(-3);
    return clean.length === 3 ? clean : '755';
  }, [file.mode]);

  const [ownerRead, setOwnerRead] = useState(Boolean(Number(initialOctal[0]) & 4));
  const [ownerWrite, setOwnerWrite] = useState(Boolean(Number(initialOctal[0]) & 2));
  const [ownerExec, setOwnerExec] = useState(Boolean(Number(initialOctal[0]) & 1));

  const [groupRead, setGroupRead] = useState(Boolean(Number(initialOctal[1]) & 4));
  const [groupWrite, setGroupWrite] = useState(Boolean(Number(initialOctal[1]) & 2));
  const [groupExec, setGroupExec] = useState(Boolean(Number(initialOctal[1]) & 1));

  const [othersRead, setOthersRead] = useState(Boolean(Number(initialOctal[2]) & 4));
  const [othersWrite, setOthersWrite] = useState(Boolean(Number(initialOctal[2]) & 2));
  const [othersExec, setOthersExec] = useState(Boolean(Number(initialOctal[2]) & 1));

  const [isRecursive, setIsRecursive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute octal string (e.g. "0755")
  const octalValue = useMemo(() => {
    const u = (ownerRead ? 4 : 0) + (ownerWrite ? 2 : 0) + (ownerExec ? 1 : 0);
    const g = (groupRead ? 4 : 0) + (groupWrite ? 2 : 0) + (groupExec ? 1 : 0);
    const o = (othersRead ? 4 : 0) + (othersWrite ? 2 : 0) + (othersExec ? 1 : 0);
    return `0${u}${g}${o}`;
  }, [
    ownerRead,
    ownerWrite,
    ownerExec,
    groupRead,
    groupWrite,
    groupExec,
    othersRead,
    othersWrite,
    othersExec,
  ]);

  // Apply a preset
  const applyPreset = (preset: string) => {
    const clean = preset.replace(/\D/g, '').slice(-3);
    if (clean.length !== 3) return;
    const [u, g, o] = clean.split('').map(Number);
    setOwnerRead(Boolean(u & 4));
    setOwnerWrite(Boolean(u & 2));
    setOwnerExec(Boolean(u & 1));

    setGroupRead(Boolean(g & 4));
    setGroupWrite(Boolean(g & 2));
    setGroupExec(Boolean(g & 1));

    setOthersRead(Boolean(o & 4));
    setOthersWrite(Boolean(o & 2));
    setOthersExec(Boolean(o & 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await window.ssh.sftp.chmod(sessionId, file.path, octalValue, isRecursive);
      window.dispatchEvent(
        new CustomEvent('asproops:toast', {
          detail: t('sftp.chmodSuccess', { mode: octalValue }),
        }),
      );
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="w-full max-w-md rounded-xl border border-line bg-raised p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔒</span>
            <div>
              <h2 className="text-sm font-semibold text-fg">{t('sftp.chmodTitle')}</h2>
              <p className="truncate font-mono text-xs text-faint max-w-xs" title={file.path}>
                {file.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-faint hover:text-fg text-sm p-1"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Permission Matrix */}
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="font-semibold text-faint text-left">Entity</div>
            <div className="font-semibold text-dim">{t('sftp.chmodRead')}</div>
            <div className="font-semibold text-dim">{t('sftp.chmodWrite')}</div>
            <div className="font-semibold text-dim">{t('sftp.chmodExecute')}</div>

            {/* Owner */}
            <div className="text-left font-medium text-azure">
              {t('sftp.chmodOwner')}
            </div>
            <div>
              <input
                type="checkbox"
                checked={ownerRead}
                onChange={(e) => setOwnerRead(e.target.checked)}
                className="accent-azure"
              />
            </div>
            <div>
              <input
                type="checkbox"
                checked={ownerWrite}
                onChange={(e) => setOwnerWrite(e.target.checked)}
                className="accent-azure"
              />
            </div>
            <div>
              <input
                type="checkbox"
                checked={ownerExec}
                onChange={(e) => setOwnerExec(e.target.checked)}
                className="accent-azure"
              />
            </div>

            {/* Group */}
            <div className="text-left font-medium text-mint">
              {t('sftp.chmodGroup')}
            </div>
            <div>
              <input
                type="checkbox"
                checked={groupRead}
                onChange={(e) => setGroupRead(e.target.checked)}
                className="accent-azure"
              />
            </div>
            <div>
              <input
                type="checkbox"
                checked={groupWrite}
                onChange={(e) => setGroupWrite(e.target.checked)}
                className="accent-azure"
              />
            </div>
            <div>
              <input
                type="checkbox"
                checked={groupExec}
                onChange={(e) => setGroupExec(e.target.checked)}
                className="accent-azure"
              />
            </div>

            {/* Others */}
            <div className="text-left font-medium text-amber">
              {t('sftp.chmodOthers')}
            </div>
            <div>
              <input
                type="checkbox"
                checked={othersRead}
                onChange={(e) => setOthersRead(e.target.checked)}
                className="accent-azure"
              />
            </div>
            <div>
              <input
                type="checkbox"
                checked={othersWrite}
                onChange={(e) => setOthersWrite(e.target.checked)}
                className="accent-azure"
              />
            </div>
            <div>
              <input
                type="checkbox"
                checked={othersExec}
                onChange={(e) => setOthersExec(e.target.checked)}
                className="accent-azure"
              />
            </div>
          </div>

          {/* Numeric Octal Display & Quick Presets */}
          <div className="rounded-lg border border-line bg-abyss p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-faint">{t('sftp.chmodOctal')}</span>
              <span className="font-mono text-base font-bold text-azure tracking-widest">
                {octalValue}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-line/40">
              <span className="text-[10px] text-faint mr-1">{t('sftp.chmodPresets')}</span>
              {['0644', '0755', '0600', '0700', '0777'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${
                    octalValue === preset
                      ? 'bg-azure text-abyss font-semibold'
                      : 'bg-active/50 text-dim hover:text-fg hover:bg-hover'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Recursive checkbox for directories */}
          {file.isDirectory && (
            <label className="flex items-center gap-2 text-xs text-dim cursor-pointer">
              <input
                type="checkbox"
                checked={isRecursive}
                onChange={(e) => setIsRecursive(e.target.checked)}
                className="accent-azure"
              />
              <span>{t('sftp.chmodRecursive')}</span>
            </label>
          )}

          {error && <p className="text-xs text-coral">{error}</p>}

          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded px-3 py-1.5 text-xs text-dim hover:text-fg hover:bg-hover"
            >
              {t('sftp.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-azure px-4 py-1.5 text-xs font-medium text-abyss hover:bg-azure-bright disabled:opacity-40"
            >
              {submitting ? '...' : t('sftp.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

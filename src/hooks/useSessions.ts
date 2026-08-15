import { useCallback, useEffect, useState } from 'react';
import type { ConnectionStatus, SessionConfig, Secret } from '../shared/types';

/**
 * Sumber kebenaran untuk daftar session dan status koneksinya.
 *
 * Status koneksi datang lewat event, bukan nilai balik `connect()`, karena
 * sebuah koneksi bisa berpindah ke 'reconnecting' kapan saja tanpa ada yang
 * memanggil apa pun dari sisi UI.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<SessionConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await window.ssh.sessions.list();
    setSessions(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Koneksi di main process bisa saja masih hidup dari sebelum renderer
    // ini dimuat (reload window, dsb). Tanya statusnya lewat query yang
    // aman-null, bukan lewat connect() yang punya efek samping.
    void refresh()
      .then(async (list) => {
        const statuses = await Promise.all(
          list.map((session) => window.ssh.ssh.status(session.id)),
        );
        if (cancelled) return;
        // ...prev di akhir: kalau event 'status' sudah lebih dulu datang
        // sebelum query ini selesai, hasil query yang lebih lawas tidak
        // boleh menimpanya.
        setStatuses((prev) => ({
          ...Object.fromEntries(list.map((session, i) => [session.id, statuses[i]])),
          ...prev,
        }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const unsubscribe = window.ssh.ssh.onStatus(({ sessionId, status, detail }) => {
      setStatuses((prev) => ({ ...prev, [sessionId]: status as ConnectionStatus }));
      setErrors((prev) => {
        if (status === 'error' && detail) return { ...prev, [sessionId]: detail };
        const { [sessionId]: _removed, ...rest } = prev;
        return rest;
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh]);

  const connect = useCallback(
    async (sessionId: string) => {
      setStatuses((prev) => ({ ...prev, [sessionId]: 'connecting' }));
      try {
        // Status akhir diambil dari nilai balik, bukan hanya dari event.
        // Kalau connect selesai lebih cepat daripada event sampai ke sini,
        // antarmuka tetap harus tahu koneksinya sudah siap.
        const status = await window.ssh.ssh.connect(sessionId);
        setStatuses((prev) => ({ ...prev, [sessionId]: status as ConnectionStatus }));
        await refresh(); // lastUsedAt berubah setelah connect berhasil
      } catch (err) {
        setStatuses((prev) => ({ ...prev, [sessionId]: 'error' }));
        setErrors((prev) => ({ ...prev, [sessionId]: (err as Error).message }));
      }
    },
    [refresh],
  );

  const disconnect = useCallback(async (sessionId: string) => {
    await window.ssh.ssh.disconnect(sessionId);
    setStatuses((prev) => ({ ...prev, [sessionId]: 'disconnected' }));
  }, []);

  const save = useCallback(
    async (
      config: Omit<SessionConfig, 'id' | 'createdAt'>,
      secret: Secret,
      existingId?: string,
    ) => {
      if (existingId) await window.ssh.sessions.update(existingId, config, secret);
      else await window.ssh.sessions.create(config, secret);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (sessionId: string) => {
      await window.ssh.sessions.remove(sessionId);
      await refresh();
    },
    [refresh],
  );

  return {
    sessions,
    statuses,
    errors,
    loading,
    connect,
    disconnect,
    save,
    remove,
    refresh,
  };
}

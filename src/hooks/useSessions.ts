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

    // App mulai terkunci (App Lock) sudah dirender begitu app dibuka — lihat
    // catatan di AppLockGate.tsx — tapi main process sengaja MENOLAK
    // sessions:list selama masih terkunci (biar kredensial tidak bisa
    // dibaca sebelum PIN benar). Panggilan pertama di bawah bisa saja
    // mendarat SEBELUM pengguna sempat unlock dan gagal — itu bukan error
    // sungguhan, cuma "belum boleh", jadi ditelan diam-diam di sini. Listener
    // onChanged di bawah yang memuat ulang begitu transisi terkunci→terbuka
    // sungguh terjadi.
    const load = () => {
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
        .catch(() => {
          /* App Lock masih aktif — lihat komentar di atas. */
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    load();

    const unsubscribeStatus = window.ssh.ssh.onStatus(({ sessionId, status, detail }) => {
      setStatuses((prev) => ({ ...prev, [sessionId]: status as ConnectionStatus }));
      setErrors((prev) => {
        if (status === 'error' && detail) return { ...prev, [sessionId]: detail };
        const { [sessionId]: _removed, ...rest } = prev;
        return rest;
      });
    });

    // Tidak melacak status terkunci sebelumnya di sini — app bisa saja
    // sudah terkunci SEBELUM effect ini sempat tahu (lihat komentar
    // load() di atas), jadi tidak ada "state lama" yang bisa diandalkan
    // buat mendeteksi transisi. Muat ulang tiap kali disiarkan TIDAK
    // terkunci cukup aman: satu-satunya sumber siaran ini (verify/setup/
    // disable/relock berhasil) masing-masing mewakili aksi pengguna yang
    // nyata, jadi tidak ada risiko spam query berulang selagi diam.
    const unsubscribeLock = window.ssh.appLock.onChanged((status) => {
      if (!status.locked) load();
    });

    return () => {
      cancelled = true;
      unsubscribeStatus();
      unsubscribeLock();
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

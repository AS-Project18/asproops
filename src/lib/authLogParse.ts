/**
 * Parser incremental untuk log auth sshd (format syslog klasik yang dipakai
 * `journalctl -o short` MAUPUN `/var/log/auth.log` — keduanya sama persis):
 *
 *   Aug 17 23:54:03 api sshd[24691]: Accepted password for root from 172.16.2.6 port 54186 ssh2
 *
 * Tujuannya mengubah baris mentah (banyak, berulang, dan penuh noise seperti
 * pesan systemd start/stop atau pam_env deprecated) menjadi dua jenis entri
 * yang enak dipantau di sidebar sempit:
 *   - AuthSuccessEvent: satu login berhasil, digabung dari 2-3 baris raw
 *     (Accepted + session opened) yang PID-nya sama, nanti dilengkapi
 *     closedAt begitu baris "session closed" dengan PID sama muncul.
 *   - AuthFailedGroup: percobaan gagal DIKELOMPOKKAN per IP sumber — server
 *     yang kena scan bot bisa dapat ratusan baris "Failed password" dalam
 *     semenit, satu baris per percobaan akan membanjiri daftar.
 */

export interface AuthSuccessEvent {
  kind: 'success';
  /** PID sshd — dipakai sebagai React key, stabil selama proses itu belum diganti PID lain. */
  id: string;
  user: string;
  ip: string;
  port: string;
  method: string;
  openedAt: number;
  closedAt: number | null;
}

export interface AuthFailedGroup {
  kind: 'failed';
  /** Dikelompokkan per IP, jadi key-nya IP itu sendiri. */
  id: string;
  ip: string;
  /** Username yang dicoba, terbaru duluan, dibatasi supaya tidak meledak kalau kena user-enumeration. */
  users: string[];
  count: number;
  firstAt: number;
  lastAt: number;
}

export type AuthFeedItem = AuthSuccessEvent | AuthFailedGroup;

const MAX_USERS_PER_GROUP = 6;
const MAX_FEED_ITEMS = 300;

const LINE_RE = /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+sshd\[(\d+)\]:\s?(.*)$/;
const ACCEPTED_RE = /^Accepted (\S+) for (\S+) from (\S+) port (\d+)/;
const FAILED_RE = /^Failed (\S+) for(?: invalid user)? (\S+) from (\S+) port (\d+)/;
const SESSION_CLOSED_RE = /^pam_unix\(sshd:session\): session closed for user (\S+)/;
const DISCONNECTED_RE = /^Disconnected from user (\S+) (\S+) port (\d+)/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Timestamp syslog tidak menyertakan tahun — diasumsikan tahun berjalan,
 * kecuali hasilnya jadi "di masa depan" lebih dari sehari (berarti baris ini
 * dari pergantian tahun sebelumnya, mis. dibaca bulan Januari tapi barisnya
 * dari Desember).
 */
function parseSyslogTimestamp(raw: string, reference: Date): number {
  const match = raw.match(/^(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return reference.getTime();
  const [, monStr, dayStr, hh, mm, ss] = match;
  const month = MONTHS.indexOf(monStr);
  if (month === -1) return reference.getTime();

  const candidate = new Date(
    reference.getFullYear(),
    month,
    Number(dayStr),
    Number(hh),
    Number(mm),
    Number(ss),
  );
  if (candidate.getTime() - reference.getTime() > 24 * 60 * 60 * 1000) {
    candidate.setFullYear(candidate.getFullYear() - 1);
  }
  return candidate.getTime();
}

export function createAuthLogParser() {
  /** pid -> event login berhasil yang masih diingat (aktif atau baru saja ditutup). */
  const byPid = new Map<string, AuthSuccessEvent>();
  /** ip -> kelompok percobaan gagal dari IP itu. */
  const byFailedIp = new Map<string, AuthFailedGroup>();
  /** Urutan kemunculan (pid/ip) terbaru duluan — dipakai buat menyusun feed akhir. */
  const order: Array<{ type: 'success'; key: string } | { type: 'failed'; key: string }> = [];
  let partial = '';

  const bumpOrder = (entry: { type: 'success'; key: string } | { type: 'failed'; key: string }) => {
    const idx = order.findIndex((o) => o.type === entry.type && o.key === entry.key);
    if (idx !== -1) order.splice(idx, 1);
    order.unshift(entry);
    if (order.length > MAX_FEED_ITEMS) order.length = MAX_FEED_ITEMS;
  };

  const handleLine = (line: string, now: Date): boolean => {
    const lineMatch = line.match(LINE_RE);
    if (!lineMatch) return false;
    const [, tsRaw, pid, body] = lineMatch;
    const at = parseSyslogTimestamp(tsRaw, now);

    const accepted = body.match(ACCEPTED_RE);
    if (accepted) {
      const [, method, user, ip, port] = accepted;
      const event: AuthSuccessEvent = { kind: 'success', id: pid, user, ip, port, method, openedAt: at, closedAt: null };
      byPid.set(pid, event);
      bumpOrder({ type: 'success', key: pid });
      return true;
    }

    const failed = body.match(FAILED_RE);
    if (failed) {
      const [, , user, ip] = failed;
      const existing = byFailedIp.get(ip);
      if (existing) {
        existing.count += 1;
        existing.lastAt = at;
        if (!existing.users.includes(user)) {
          existing.users.unshift(user);
          if (existing.users.length > MAX_USERS_PER_GROUP) existing.users.length = MAX_USERS_PER_GROUP;
        }
      } else {
        byFailedIp.set(ip, { kind: 'failed', id: ip, ip, users: [user], count: 1, firstAt: at, lastAt: at });
      }
      bumpOrder({ type: 'failed', key: ip });
      return true;
    }

    const closed = body.match(SESSION_CLOSED_RE);
    if (closed) {
      const event = byPid.get(pid);
      if (event && event.closedAt === null) {
        event.closedAt = at;
        bumpOrder({ type: 'success', key: pid });
        return true;
      }
      return false;
    }

    const disconnected = body.match(DISCONNECTED_RE);
    if (disconnected) {
      const event = byPid.get(pid);
      if (event && event.closedAt === null) {
        event.closedAt = at;
        bumpOrder({ type: 'success', key: pid });
        return true;
      }
      return false;
    }

    // Baris lain (systemd start/stop, pam_env deprecated, "Server listening
    // on", dst) sengaja diabaikan — bukan event login, cuma noise di sidebar
    // sempit. Tetap ada di tampilan "log mentah" kalau dibutuhkan.
    return false;
  };

  return {
    /** Suapi potongan teks mentah (bisa berupa banyak baris/baris terpotong) — balikkan true kalau ada perubahan yang perlu dirender ulang. */
    ingest(chunk: string, now: Date = new Date()): boolean {
      const combined = partial + chunk;
      const lines = combined.split('\n');
      partial = lines.pop() ?? '';
      let changed = false;
      for (const line of lines) {
        if (line && handleLine(line, now)) changed = true;
      }
      return changed;
    },

    /** Snapshot feed gabungan, terbaru duluan. */
    feed(): AuthFeedItem[] {
      return order
        .map((entry) => (entry.type === 'success' ? byPid.get(entry.key) : byFailedIp.get(entry.key)))
        .filter((item): item is AuthFeedItem => item !== undefined);
    },
  };
}

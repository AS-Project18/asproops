import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';

import { verifyHostKey } from './known-hosts';
import { preferences } from '../store/preferences';
import type { ConnectionStatus, SessionConfig, Secret } from '../../src/shared/types';

/**
 * Satu SshConnection = satu koneksi TCP ke satu server.
 *
 * Terminal, SFTP browser, dan monitor semuanya jalan sebagai channel terpisah
 * di atas koneksi ini. Membuka tiga koneksi terpisah untuk tiga fitur akan
 * memaksa tiga kali autentikasi dan tiga kali entri di log server.
 */

export interface ConnectionEvents {
  status: (status: ConnectionStatus, detail?: string) => void;
  /** Host key belum dikenal atau berubah — UI wajib bertanya ke pengguna. */
  hostKeyPrompt: (info: {
    keyType: string;
    /** Blob key mentah, dibutuhkan untuk menulis ke known_hosts jika dipercaya. */
    rawKey: Buffer;
    fingerprint: string;
    storedFingerprint?: string;
    changed: boolean;
    accept: (trust: boolean) => void;
  }) => void;
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export class SshConnection extends EventEmitter {
  readonly sessionId: string;

  private client: Client | null = null;
  private sftpPromise: Promise<SFTPWrapper> | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** Disengaja ditutup pengguna — jangan reconnect. */
  private closedByUser = false;
  /**
   * Naik tiap kali connect() atau disconnect() dipanggil. Event dari
   * percobaan koneksi yang sudah usang (mis. 'close' yang datang setelah
   * pengguna menekan disconnect, atau setelah percobaan reconnect baru
   * sudah dimulai) dicek terhadap ini sebelum diizinkan mengubah status
   * atau memicu scheduleReconnect — tanpa ini, percobaan lama yang masih
   * "hidup" di latar belakang bisa menyalakan ulang siklus reconnect
   * walaupun pengguna sudah menekan Disconnect.
   */
  private generation = 0;

  constructor(
    private readonly config: SessionConfig,
    private readonly secret: Secret,
    /** Channel ke bastion, jika session ini di balik jump host. */
    private readonly jumpChannel?: ClientChannel,
  ) {
    super();
    this.sessionId = config.id;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    this.emit('status', status, detail);
  }

  private async buildConnectConfig(): Promise<ConnectConfig> {
    const prefs = preferences.get();
    const base: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      keepaliveInterval: prefs.keepaliveIntervalMs,
      keepaliveCountMax: prefs.keepaliveCountMax,
      readyTimeout: prefs.timeoutMs,
      // Jika session ini lewat bastion, socket-nya adalah channel forwardOut
      // dari koneksi bastion. ssh2 memperlakukannya seperti socket biasa.
      sock: this.jumpChannel,
      hostVerifier: (key: Buffer, callback: (ok: boolean) => void) => {
        void this.handleHostKey(key, callback);
      },
    };

    switch (this.config.authMethod) {
      case 'password':
        if (!this.secret.password) {
          throw new Error(
            'Session ini diatur memakai password, tapi tidak ada password tersimpan. ' +
              'Ubah server ini dan isi kolom passwordnya.',
          );
        }
        return {
          ...base,
          password: this.secret.password,
          // Banyak server — terutama yang memakai PAM — tidak menawarkan
          // metode "password", hanya "keyboard-interactive". Tanpa ini,
          // password yang benar pun ditolak dengan pesan yang menyesatkan.
          tryKeyboard: true,
        };

      case 'privateKey': {
        if (!this.config.privateKeyPath) {
          throw new Error('Path private key belum diisi untuk session ini.');
        }
        let privateKey: Buffer;
        try {
          privateKey = await readFile(this.config.privateKeyPath);
        } catch {
          throw new Error(`Private key tidak terbaca di ${this.config.privateKeyPath}.`);
        }
        return { ...base, privateKey, passphrase: this.secret.passphrase };
      }

      case 'agent':
        // Di Windows, OpenSSH Agent memakai named pipe ini.
        return { ...base, agent: process.env.SSH_AUTH_SOCK ?? '\\\\.\\pipe\\openssh-ssh-agent' };
    }
  }

  private async handleHostKey(key: Buffer, callback: (ok: boolean) => void): Promise<void> {
    try {
      const result = await verifyHostKey(this.config.host, this.config.port, key);

      if (result.status === 'trusted') {
        callback(true);
        return;
      }

      // Keputusan diserahkan ke pengguna lewat UI. Jangan pernah auto-accept.
      this.emit('hostKeyPrompt', {
        keyType: detectKeyType(key),
        rawKey: key,
        fingerprint: result.fingerprint,
        storedFingerprint: result.status === 'changed' ? result.storedFingerprint : undefined,
        changed: result.status === 'changed',
        accept: (trust: boolean) => callback(trust),
      });
    } catch (err) {
      this.setStatus('error', `Gagal memeriksa host key: ${(err as Error).message}`);
      callback(false);
    }
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return;

    this.closedByUser = false;
    this.generation += 1;
    const generation = this.generation;
    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const config = await this.buildConnectConfig();
    const client = new Client();
    this.client = client;

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        client.removeListener('error', onError);
        if (generation !== this.generation) {
          // Percobaan ini sudah usang — pengguna sudah disconnect, atau
          // connect() lain sudah dimulai selagi ini masih menunggu server.
          // Tutup diam-diam, jangan sentuh status milik percobaan yang
          // lebih baru.
          client.end();
          resolve();
          return;
        }
        this.reconnectAttempt = 0;
        this.setStatus('connected');
        resolve();
      };

      const onError = (err: Error) => {
        client.removeListener('ready', onReady);
        const message = this.explainError(err);
        if (generation === this.generation) this.setStatus('error', message);
        reject(new Error(message));
      };

      client.once('ready', onReady);
      client.once('error', onError);

      // Server yang memakai keyboard-interactive mengirim daftar pertanyaan;
      // untuk login password biasa hanya ada satu, yaitu prompt password.
      client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        finish(prompts.map(() => this.secret.password ?? ''));
      });

      client.on('close', () => {
        if (this.client === client) this.client = null;
        this.sftpPromise = null;
        if (generation === this.generation) {
          if (!this.closedByUser) this.scheduleReconnect();
          else this.setStatus('disconnected');
        }
        // 'close' bisa datang sebelum 'ready'/'error' kalau koneksinya
        // diakhiri paksa di tengah handshake (mis. disconnect() memanggil
        // client.end() selagi masih connecting) — tanpa reject ini, promise
        // di atas menggantung selamanya dan pemanggilnya (ConnectionManager
        // .open) tidak pernah tahu percobaan ini sudah berakhir.
        reject(new Error('Koneksi ditutup sebelum siap.'));
      });

      client.connect(config);
    });
  }

  /** Terjemahkan pesan ssh2 yang ringkas menjadi petunjuk yang bisa ditindaklanjuti. */
  private explainError(err: Error): string {
    const raw = err.message;

    if (raw.includes('All configured authentication methods failed')) {
      switch (this.config.authMethod) {
        case 'password':
          return (
            'Autentikasi ditolak server. Periksa password dan nama pengguna. ' +
            'Kalau keduanya sudah benar, server mungkin menolak login password ' +
            '(PasswordAuthentication no) dan mengharuskan private key.'
          );
        case 'privateKey':
          return (
            'Autentikasi ditolak server. Pastikan kunci publik pasangan dari ' +
            `${this.config.privateKeyPath} sudah ada di ~/.ssh/authorized_keys milik ` +
            `${this.config.username}, dan passphrase-nya benar.`
          );
        case 'agent':
          return (
            'Autentikasi ditolak server. Pastikan layanan ssh-agent Windows berjalan ' +
            'dan kuncimu sudah ditambahkan — periksa dengan menjalankan `ssh-add -l`.'
          );
      }
    }

    if (raw.includes('ECONNREFUSED')) {
      return `Server menolak koneksi di port ${this.config.port}. Pastikan SSH berjalan di port itu.`;
    }
    if (raw.includes('ETIMEDOUT') || raw.includes('Timed out')) {
      return `Tidak ada jawaban dari ${this.config.host}:${this.config.port}. Kemungkinan diblokir firewall.`;
    }
    if (raw.includes('ENOTFOUND')) {
      return `Nama host ${this.config.host} tidak bisa diterjemahkan ke alamat IP.`;
    }

    return raw;
  }

  private scheduleReconnect(): void {
    if (!preferences.get().autoReconnect) {
      this.setStatus('disconnected');
      return;
    }

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    const generation = this.generation;
    this.setStatus('reconnecting', `Mencoba ulang dalam ${delay / 1000}s`);

    this.reconnectTimer = setTimeout(() => {
      // Jaga-jaga kalau clearTimeout di disconnect() entah bagaimana
      // terlewat — generasi yang sudah usang tidak boleh mulai connect().
      if (generation !== this.generation) return;
      this.connect().catch(() => {
        /* error sudah dilaporkan lewat event status; biarkan siklus berulang */
      });
    }, delay);
  }

  private requireClient(): Client {
    if (!this.client || this.status !== 'connected') {
      throw new Error('Koneksi SSH belum siap.');
    }
    return this.client;
  }

  /** Channel interaktif untuk terminal. PTY dialokasikan di sisi server. */
  async openShell(cols: number, rows: number): Promise<ClientChannel> {
    const client = this.requireClient();
    return new Promise((resolve, reject) => {
      client.shell(
        { term: 'xterm-256color', cols, rows },
        (err, stream) => (err ? reject(err) : resolve(stream)),
      );
    });
  }

  /** Jalankan satu perintah, kumpulkan stdout. Dipakai oleh monitor. */
  async exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const client = this.requireClient();
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';
        stream.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
        stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
        stream.on('close', (code: number) => resolve({ stdout, stderr, code: code ?? 0 }));
        stream.on('error', reject);
      });
    });
  }

  /** SFTP subsystem dibuka sekali lalu dipakai ulang oleh file browser. */
  async getSftp(): Promise<SFTPWrapper> {
    const client = this.requireClient();
    this.sftpPromise ??= new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
    });
    return this.sftpPromise;
  }

  /** Buka channel TCP ke host lain — dasar dari dukungan ProxyJump. */
  async forwardOut(destHost: string, destPort: number): Promise<ClientChannel> {
    const client = this.requireClient();
    return new Promise((resolve, reject) => {
      client.forwardOut('127.0.0.1', 0, destHost, destPort, (err, channel) =>
        err ? reject(err) : resolve(channel),
      );
    });
  }

  disconnect(): void {
    this.closedByUser = true;
    this.generation += 1;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.client?.end();
    this.client = null;
    this.sftpPromise = null;
    this.setStatus('disconnected');
  }
}

function detectKeyType(key: Buffer): string {
  // Blob host key diawali panjang string (4 byte) lalu nama algoritma.
  const length = key.readUInt32BE(0);
  return key.subarray(4, 4 + length).toString('utf8');
}

/**
 * Kumpulan koneksi untuk satu server.
 *
 * Setiap terminal, SFTP, dan perintah monitor adalah satu channel di atas
 * koneksi SSH. Server membatasi jumlah channel serentak lewat `MaxSessions`
 * di sshd_config — bawaannya 10, tapi server yang dikeraskan sering
 * menyetelnya ke 1 atau 2. Saat batas itu tercapai, server menolak channel
 * berikutnya dan ssh2 melaporkannya sebagai "Channel open failure".
 *
 * Pool ini menanganinya dengan membuka koneksi TCP tambahan ke server yang
 * sama begitu channel pada koneksi yang ada habis — cara yang sama dipakai
 * MobaXterm dan WinSCP. Trade-off-nya: setiap koneksi tambahan berarti satu
 * autentikasi lagi dan satu entri lagi di log server.
 */

/** Sesuai `MaxStartups` yang lazim; di atas ini server hampir pasti menolak. */
const MAX_POOL_SIZE = 6;

function isChannelExhaustion(error: unknown): boolean {
  return /channel open failure/i.test((error as Error)?.message ?? '');
}

/** Permukaan yang dipakai monitor, editor, dan handler IPC. */
export interface SessionChannels {
  openShell(cols: number, rows: number): Promise<ClientChannel>;
  exec(command: string): Promise<{ stdout: string; stderr: string; code: number }>;
  getSftp(): Promise<SFTPWrapper>;
}

export class SessionPool implements SessionChannels {
  private readonly members: SshConnection[] = [];

  constructor(
    readonly sessionId: string,
    /** Membuat koneksi baru ke server yang sama, sudah terautentikasi. */
    private readonly spawn: () => Promise<SshConnection>,
  ) {}

  addMember(connection: SshConnection): void {
    this.members.push(connection);
  }

  get primary(): SshConnection | undefined {
    return this.members[0];
  }

  getStatus(): ConnectionStatus {
    return this.primary?.getStatus() ?? 'disconnected';
  }

  /**
   * Coba tiap koneksi yang ada; kalau semuanya kehabisan channel, buka satu
   * koneksi lagi. Error selain kehabisan channel dilempar apa adanya —
   * memperbesar pool tidak akan menolong kalau perintahnya sendiri salah.
   */
  private async withCapacity<T>(run: (connection: SshConnection) => Promise<T>): Promise<T> {
    for (const member of this.members) {
      try {
        return await run(member);
      } catch (error) {
        if (!isChannelExhaustion(error)) throw error;
      }
    }

    if (this.members.length >= MAX_POOL_SIZE) {
      throw new Error(
        `Server menolak channel baru dan batas ${MAX_POOL_SIZE} koneksi sudah tercapai. ` +
          'Tutup sebagian tab terminal, atau naikkan MaxSessions di sshd_config server.',
      );
    }

    const extra = await this.spawn();
    this.members.push(extra);
    return run(extra);
  }

  openShell(cols: number, rows: number): Promise<ClientChannel> {
    return this.withCapacity((connection) => connection.openShell(cols, rows));
  }

  exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return this.withCapacity((connection) => connection.exec(command));
  }

  getSftp(): Promise<SFTPWrapper> {
    return this.withCapacity((connection) => connection.getSftp());
  }

  disconnect(): void {
    for (const member of this.members) member.disconnect();
    this.members.length = 0;
  }
}

/** Registry semua pool aktif. Satu instance untuk seluruh aplikasi. */
export class ConnectionManager {
  private readonly pools = new Map<string, SessionPool>();

  /**
   * @param bind Dipanggil tepat setelah objek koneksi utama dibuat dan
   *   SEBELUM `connect()` dijalankan. Listener wajib terpasang di titik ini:
   *   event `hostKeyPrompt` terjadi di tengah proses connect, dan `status`
   *   berpindah ke `connected` sebelum `connect()` selesai. Memasangnya
   *   setelah `await` berarti kedua event itu terlewat — koneksi berhasil
   *   tapi antarmuka tidak pernah diberi tahu.
   */
  async open(
    config: SessionConfig,
    secret: Secret,
    resolveSession: (id: string) => Promise<{ config: SessionConfig; secret: Secret }>,
    bind?: (connection: SshConnection) => void,
  ): Promise<SessionPool> {
    const existing = this.pools.get(config.id);
    // Listener tidak dipasang ulang di sini; kalau tidak, setiap percobaan
    // connect berikutnya akan menggandakan pengiriman event ke renderer.
    if (existing) return existing;

    /** Dipakai untuk koneksi utama maupun koneksi luapan berikutnya. */
    const spawn = async (): Promise<SshConnection> => {
      let jumpChannel: ClientChannel | undefined;
      if (config.jumpHostId) {
        const jump = await resolveSession(config.jumpHostId);
        const jumpPool = await this.open(jump.config, jump.secret, resolveSession, bind);
        const jumpPrimary = jumpPool.primary;
        if (!jumpPrimary) throw new Error('Koneksi bastion tidak tersedia.');
        jumpChannel = await jumpPrimary.forwardOut(config.host, config.port);
      }
      return new SshConnection(config, secret, jumpChannel);
    };

    const pool = new SessionPool(config.id, async () => {
      const connection = await spawn();
      await connection.connect();
      return connection;
    });
    this.pools.set(config.id, pool);

    const primary = await spawn();
    pool.addMember(primary);
    bind?.(primary);

    try {
      await primary.connect();
    } catch (err) {
      // Koneksi gagal tidak boleh tertinggal di peta — percobaan berikutnya
      // akan mengembalikan objek mati ini alih-alih mencoba lagi.
      this.pools.delete(config.id);
      throw err;
    }

    return pool;
  }

  get(sessionId: string): SessionPool | undefined {
    return this.pools.get(sessionId);
  }

  require(sessionId: string): SessionPool {
    const pool = this.pools.get(sessionId);
    if (!pool) throw new Error(`Tidak ada koneksi aktif untuk session ${sessionId}.`);
    return pool;
  }

  close(sessionId: string): void {
    this.pools.get(sessionId)?.disconnect();
    this.pools.delete(sessionId);
  }

  closeAll(): void {
    for (const id of [...this.pools.keys()]) this.close(id);
  }
}

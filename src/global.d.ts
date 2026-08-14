import type { SshApi } from '../electron/preload';

declare global {
  interface Window {
    ssh: SshApi;
  }
}

export {};

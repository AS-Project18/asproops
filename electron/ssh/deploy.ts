import type { ClientChannel } from 'ssh2';
import type { SessionChannels } from './connection-manager';
import type { DeployStep } from '../../src/shared/types';

/**
 * Mesin eksekusi Deploy Template — jalankan langkah-langkahnya berurutan di
 * path milik sebuah Project, berhenti begitu satu langkah gagal (exit != 0),
 * persis semantik pipeline CI biasa: tidak ada gunanya lanjut build kalau
 * install dependencies-nya saja sudah gagal.
 */

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `export KEY='value' KEY2='value2'; ` di depan tiap langkah, kosong kalau project tidak punya env. */
function envPrefix(env: Record<string, string>): string {
  const assignments = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`);
  return assignments.length > 0 ? `export ${assignments.join(' ')}; ` : '';
}

export interface DeployRunHandle {
  cancel(): void;
}

export interface DeployCallbacks {
  onStepStart(index: number, label: string): void;
  onOutput(data: string): void;
  onStepEnd(index: number, exitCode: number): void;
  onDone(success: boolean, message?: string): void;
}

export function runDeploy(
  connection: SessionChannels,
  path: string,
  env: Record<string, string>,
  steps: DeployStep[],
  callbacks: DeployCallbacks,
): DeployRunHandle {
  let cancelled = false;
  let currentStream: ClientChannel | null = null;
  const prefix = envPrefix(env);

  void (async () => {
    for (let index = 0; index < steps.length; index += 1) {
      if (cancelled) return;
      const step = steps[index];
      callbacks.onStepStart(index, step.label);

      // Dibungkus subshell "(...)" supaya operator (&&, ||, ;) di dalam
      // command milik step tidak bertabrakan dengan "cd ... && " di depannya.
      const command = `cd -- ${shellQuote(path)} && ${prefix}(${step.command}) 2>&1`;

      let exitCode: number;
      try {
        const stream = await connection.execStream(command);
        if (cancelled) {
          stream.close();
          return;
        }
        currentStream = stream;

        exitCode = await new Promise<number>((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => callbacks.onOutput(chunk.toString('utf8')));
          stream.on('close', (code: number) => resolve(code ?? 0));
          stream.on('error', reject);
        });
        currentStream = null;
      } catch (err) {
        callbacks.onDone(false, (err as Error).message);
        return;
      }

      if (cancelled) return;
      callbacks.onStepEnd(index, exitCode);

      if (exitCode !== 0) {
        callbacks.onDone(false, `Langkah "${step.label}" gagal (exit ${exitCode}).`);
        return;
      }
    }

    if (!cancelled) callbacks.onDone(true);
  })();

  return {
    cancel() {
      cancelled = true;
      currentStream?.close();
    },
  };
}

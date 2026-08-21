import { app } from 'electron';

/**
 * Cek rilis terbaru di GitHub Releases — bukan auto-updater (tidak ada
 * infrastruktur code-signing/publish otomatis di build ini), cuma tanya
 * versi terbaru dan kasih link ke halaman rilis kalau ada yang lebih baru.
 * Pakai fetch bawaan Node (tersedia di proses main Electron sejak Node 18+),
 * tanpa dependency tambahan.
 */

const REPO = 'AS-Project18/asproops';

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  releaseUrl?: string;
  error?: string;
}

/** Bandingkan versi semver sederhana (mayor.minor.patch, tanpa pre-release/build metadata). */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const partsB = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    // 404 berarti belum ada rilis di GitHub sama sekali — bukan error,
    // cuma tidak ada apa-apa untuk dibandingkan.
    if (response.status === 404) {
      return { currentVersion, hasUpdate: false };
    }
    if (!response.ok) {
      return { currentVersion, hasUpdate: false, error: `GitHub API mengembalikan status ${response.status}.` };
    }

    const data = (await response.json()) as { tag_name?: string; html_url?: string };
    const latestVersion = (data.tag_name ?? '').replace(/^v/i, '').trim();
    if (!latestVersion) return { currentVersion, hasUpdate: false };

    return {
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      releaseUrl: data.html_url,
    };
  } catch (err) {
    return { currentVersion, hasUpdate: false, error: (err as Error).message };
  }
}

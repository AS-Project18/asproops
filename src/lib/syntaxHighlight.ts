import Prism from 'prismjs';

// Import essential language syntaxes in strict dependency order:
// 1. clike
// 2. markup & templating (REQUIRED by PHP, Twig, etc.)
// 3. other languages
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';

export interface SupportedLanguage {
  id: string;
  name: string;
  extensions: string[];
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { id: 'javascript', name: 'JavaScript', extensions: ['js', 'mjs', 'cjs'] },
  { id: 'typescript', name: 'TypeScript', extensions: ['ts', 'mts', 'cts'] },
  { id: 'jsx', name: 'JavaScript React', extensions: ['jsx'] },
  { id: 'tsx', name: 'TypeScript React', extensions: ['tsx'] },
  { id: 'json', name: 'JSON', extensions: ['json'] },
  { id: 'python', name: 'Python', extensions: ['py', 'pyw'] },
  { id: 'bash', name: 'Shell / Bash', extensions: ['sh', 'bash', 'zsh', 'env', 'service', 'conf'] },
  { id: 'yaml', name: 'YAML', extensions: ['yml', 'yaml'] },
  { id: 'sql', name: 'SQL', extensions: ['sql'] },
  { id: 'css', name: 'CSS', extensions: ['css', 'scss', 'less'] },
  { id: 'markup', name: 'HTML / XML', extensions: ['html', 'htm', 'xml', 'svg'] },
  { id: 'markdown', name: 'Markdown', extensions: ['md', 'markdown'] },
  { id: 'ini', name: 'INI / Config', extensions: ['ini', 'cfg', 'properties'] },
  { id: 'docker', name: 'Dockerfile', extensions: ['dockerfile'] },
  { id: 'go', name: 'Go', extensions: ['go'] },
  { id: 'rust', name: 'Rust', extensions: ['rs'] },
  { id: 'php', name: 'PHP', extensions: ['php', 'phtml'] },
  { id: 'plaintext', name: 'Plain Text', extensions: ['txt', 'log'] },
];

/** Mendeteksi bahasa pemrograman dari nama berkas atau ekstensi. */
export function detectLanguageFromFilename(filename: string): string {
  const lower = filename.toLowerCase();

  // Khusus nama berkas tanpa ekstensi
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'docker';
  if (lower === 'makefile' || lower.startsWith('makefile.')) return 'bash';
  if (lower.startsWith('.env')) return 'bash';
  if (lower === '.bashrc' || lower === '.zshrc' || lower === '.profile') return 'bash';

  const ext = lower.split('.').pop() || '';
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang.extensions.includes(ext)) {
      return lang.id;
    }
  }

  return 'plaintext';
}

/** Melakukan sintaks pewarnaan dan mengembalikan HTML berformat Prism dengan sanitasi aman. */
export function highlightCode(code: string, languageId: string): string {
  if (!code) return '&nbsp;';

  const grammar = Prism.languages[languageId];
  if (!grammar || languageId === 'plaintext') {
    // Escape HTML dasar untuk plain text
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  try {
    return Prism.highlight(code, grammar, languageId);
  } catch (err) {
    console.warn(`[Prism] Highlight error for language ${languageId}:`, err);
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

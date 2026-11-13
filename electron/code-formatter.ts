import * as path from 'node:path';
import * as prettier from 'prettier';

export async function formatCode(
  content: string,
  filename: string,
  languageId?: string,
): Promise<{ formatted: string; error?: string }> {
  if (!content || !content.trim()) {
    return { formatted: content };
  }

  const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
  const lowerName = path.basename(filename).toLowerCase();

  let parser: string | undefined;
  const plugins: string[] = [];

  if (['js', 'mjs', 'cjs'].includes(ext)) {
    parser = 'babel';
  } else if (['ts', 'mts', 'cts'].includes(ext)) {
    parser = 'typescript';
  } else if (ext === 'jsx') {
    parser = 'babel';
  } else if (ext === 'tsx') {
    parser = 'typescript';
  } else if (ext === 'json') {
    parser = 'json';
  } else if (['html', 'htm', 'xml', 'svg'].includes(ext)) {
    parser = 'html';
  } else if (['css', 'scss', 'less'].includes(ext)) {
    parser = 'css';
  } else if (['md', 'markdown'].includes(ext)) {
    parser = 'markdown';
  } else if (['yml', 'yaml'].includes(ext)) {
    parser = 'yaml';
  } else if (['php', 'phtml'].includes(ext) || languageId === 'php') {
    parser = 'php';
    plugins.push('@prettier/plugin-php');
  } else if (languageId === 'json') {
    parser = 'json';
  } else if (languageId === 'javascript') {
    parser = 'babel';
  } else if (languageId === 'typescript') {
    parser = 'typescript';
  } else if (languageId === 'html' || languageId === 'markup') {
    parser = 'html';
  } else if (languageId === 'css') {
    parser = 'css';
  } else if (languageId === 'markdown') {
    parser = 'markdown';
  } else if (languageId === 'yaml') {
    parser = 'yaml';
  }

  // Fallback untuk file JSON tanpa ekstensi standar
  if (!parser && (ext === 'json' || lowerName.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(content);
      return { formatted: JSON.stringify(parsed, null, 2) + '\n' };
    } catch (err) {
      return { formatted: content, error: `JSON tidak valid: ${(err as Error).message}` };
    }
  }

  if (!parser && plugins.length === 0) {
    return {
      formatted: content,
      error: `Auto-formatter tidak memiliki parser untuk berkas ini (.${ext || filename}).`,
    };
  }

  try {
    const formatted = await prettier.format(content, {
      parser,
      filepath: filename,
      plugins: plugins.length > 0 ? plugins : undefined,
      tabWidth: 2,
      useTabs: false,
      singleQuote: true,
      semi: true,
    });
    return { formatted };
  } catch (err) {
    return { formatted: content, error: (err as Error).message };
  }
}

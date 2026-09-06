// Read a committed doc from the repo and render its Markdown to HTML for the
// Settings › Definitions page (docs/phase-3.md task 3.8). Rendering the file
// straight from disk is the point: the page can never drift from the source of
// truth. A minimal renderer (headings, lists, tables, bold, inline code, hr,
// paragraphs) covers what docs/metrics.md uses — no Markdown dependency.
import 'server-only';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Walk up from cwd to the repo root (the dir that contains `docs/`). */
async function repoRoot(): Promise<string> {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    try {
      await readFile(join(dir, 'docs', 'metrics.md'));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

export async function readDoc(relativePath: string): Promise<string | null> {
  try {
    const root = await repoRoot();
    return await readFile(join(root, relativePath), 'utf8');
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Inline: `code`, **bold**, [text](href). Order matters — code first. */
function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function renderTable(rows: string[]): string {
  // rows are pipe lines; the second row is the |---|---| separator.
  const cells = (line: string): string[] =>
    line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  const header = cells(rows[0] ?? '');
  const bodyRows = rows.slice(2).map(cells);
  const head = header.map((h) => `<th>${inline(h)}</th>`).join('');
  const body = bodyRows
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Render a Markdown subset to HTML. */
export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = (): void => {
    if (para.length > 0) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const flushList = (): void => {
    if (list.length > 0) {
      out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
      list = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      flushPara();
      flushList();
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }
    if (trimmed === '---') {
      flushPara();
      flushList();
      out.push('<hr>');
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      list.push(trimmed.replace(/^[-*]\s+/, ''));
      i += 1;
      continue;
    }
    if (trimmed.startsWith('|')) {
      flushPara();
      flushList();
      const table: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        table.push((lines[i] ?? '').trim());
        i += 1;
      }
      out.push(renderTable(table));
      continue;
    }
    para.push(trimmed);
    i += 1;
  }
  flushPara();
  flushList();
  return out.join('\n');
}

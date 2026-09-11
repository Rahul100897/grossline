// Regenerates src/reports/report-assets.generated.ts from the canonical design
// sources so the monthly report renders identically offline (no Google Fonts,
// no cross-package @import at render time) while keeping a single source of
// truth for both fonts and colour tokens.
//
//   - Fonts: the self-hosted woff2 files (apps/admin/public/fonts) are embedded
//     as base64 data URIs. The report PDF is produced by Playwright from an HTML
//     string with no base URL, so every asset must be inline.
//   - Tokens: the :root{…} block of docs/design/design-tokens.css is copied
//     verbatim (comments stripped) so no colour hex is ever hand-authored in the
//     renderer. A parsed name→value map is also emitted for the one place that
//     needs a literal (Chromium's footer template renders outside the page and
//     cannot read CSS variables).
//
// Run: pnpm --filter @grossline/worker assets:gen
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const tokensCssPath = resolve(repoRoot, 'docs/design/design-tokens.css');
const fontsDir = resolve(repoRoot, 'apps/admin/public/fonts');
const outPath = resolve(here, '../src/reports/report-assets.generated.ts');

function base64(file: string): string {
  return readFileSync(resolve(fontsDir, file)).toString('base64');
}

// Extract the first :root{ … } block and strip comments.
const rawTokens = readFileSync(tokensCssPath, 'utf8');
const rootMatch = rawTokens.match(/:root\s*\{([\s\S]*?)\}/);
if (!rootMatch) throw new Error('no :root block in design-tokens.css');
const declarations = rootMatch[1]
  .replace(/\/\*[\s\S]*?\*\//g, '') // drop comments
  .split(';')
  .map((d) => d.trim())
  .filter(Boolean);

const rootCss = `:root{${declarations.join(';')};}`;

// name → value map, for the rare literal (footer template).
const tokenMap: Record<string, string> = {};
for (const d of declarations) {
  const idx = d.indexOf(':');
  if (idx === -1) continue;
  tokenMap[d.slice(0, idx).trim()] = d.slice(idx + 1).trim();
}

const inter = base64('inter.woff2');
const serif = base64('instrument-serif.woff2');

const banner = `// GENERATED FILE — do not edit by hand.
// Regenerate with: pnpm --filter @grossline/worker assets:gen
// Sources: docs/design/design-tokens.css, apps/admin/public/fonts/*.woff2
/* eslint-disable */
`;

const body = `${banner}
/** The :root token block copied verbatim from docs/design/design-tokens.css. */
export const DESIGN_TOKENS_CSS = ${JSON.stringify(rootCss)};

/** Parsed token values (name → value), for the few literals that can't use a var. */
export const GL: Readonly<Record<string, string>> = ${JSON.stringify(tokenMap, null, 2)};

/** Self-hosted fonts as base64 woff2, embedded so the PDF renders with no network. */
export const INTER_WOFF2_BASE64 = ${JSON.stringify(inter)};
export const INSTRUMENT_SERIF_WOFF2_BASE64 = ${JSON.stringify(serif)};
`;

writeFileSync(outPath, body);
console.log(
  `wrote ${outPath} (${declarations.length} tokens, inter ${inter.length}b64, serif ${serif.length}b64)`,
);

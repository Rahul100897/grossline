// HTML → PDF for the admin app (invoice download, task 3.6). Playwright is a
// native, server-only dependency: it is imported directly here (not through a
// transpiled workspace package) so Next leaves it external — see
// serverExternalPackages in next.config.ts — rather than trying to bundle its
// dynamic requires. The worker keeps its own copy (services/worker/src/pdf)
// for the Phase 5 report job, which runs in the worker's own Node runtime.
import 'server-only';
import { chromium, type Browser } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--no-sandbox'] });
  }
  return browserPromise;
}

export type PdfMargin = { top: string; bottom: string; left: string; right: string };
export type PdfOptions = { margin?: PdfMargin; footerHtml?: string; headerHtml?: string };

export async function htmlToPdf(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const displayHeaderFooter = Boolean(opts.footerHtml || opts.headerHtml);
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: opts.margin ?? { top: '0', bottom: '0', left: '0', right: '0' },
      displayHeaderFooter,
      headerTemplate: opts.headerHtml ?? '<span></span>',
      footerTemplate: opts.footerHtml ?? '<span></span>',
    });
  } finally {
    await page.close();
  }
}

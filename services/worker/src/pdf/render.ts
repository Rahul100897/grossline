// HTML → PDF via headless Chromium (Playwright). The one rendering path the
// admin console (invoices, task 3.6) and the Phase 5 monthly report (task B2)
// both use. A single browser is reused across calls in a process; callers
// stream the returned bytes.
import { chromium, type Browser } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--no-sandbox'] });
  }
  return browserPromise;
}

export type PdfMargin = { top: string; bottom: string; left: string; right: string };

export type PdfOptions = {
  /** Per-page margins. Reports use these (not body padding) so page 2+ also has
   *  margins, and so the footer sits in the bottom margin. Default: none. */
  margin?: PdfMargin;
  /** Chromium footer template (supports .pageNumber / .totalPages spans). */
  footerHtml?: string;
  /** Chromium header template. */
  headerHtml?: string;
};

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

/** Close the shared browser (tests, graceful shutdown). */
export async function closePdfBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

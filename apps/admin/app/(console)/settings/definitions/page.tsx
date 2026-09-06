// Metric definitions, rendered straight from the committed docs/metrics.md so
// the page can never drift from the source of truth (docs/phase-3.md task 3.8).
// A definition change lands here with no code change.
import Link from 'next/link';
import { requireSession } from '../../../../lib/auth';
import { readDoc, renderMarkdown } from '../../../../lib/doc-render';
import { ErrorState, PageHeader } from '../../../../components/ui';

export const dynamic = 'force-dynamic';

export default async function DefinitionsPage() {
  await requireSession();
  const md = await readDoc('docs/metrics.md');

  return (
    <>
      <PageHeader
        title="Metric definitions"
        sub={
          <span className="flex items-center gap-2">
            Rendered live from <code>docs/metrics.md</code>.
            <Link href="/settings" className="text-slate hover:text-ink">
              ← settings
            </Link>
          </span>
        }
      />
      {md === null ? (
        <ErrorState>Could not read docs/metrics.md from the repository.</ErrorState>
      ) : (
        <article
          className="doc max-w-3xl"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }}
        />
      )}
    </>
  );
}

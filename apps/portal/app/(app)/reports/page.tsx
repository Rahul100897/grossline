import { listReports } from '@grossline/db';
import { monthLabel } from '../../../lib/format';
import { scope } from '../scope';

export const dynamic = 'force-dynamic';

function sentLabel(sentAt: Date | null): string {
  if (!sentAt) return '';
  return new Date(sentAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function ReportsPage() {
  const { tenantId } = await scope();
  // A report exists for a merchant only once it has been sent — drafts are invisible.
  const reports = (await listReports(tenantId)).filter((r) => r.status === 'sent');

  return (
    <>
      <div className="mb-4">
        <h1 className="gl-h1">Reports</h1>
        <p className="gl-sub mt-1.5">Every monthly report we&rsquo;ve sent you.</p>
      </div>

      {reports.length === 0 ? (
        <div className="gl-empty">
          Your reports will appear here as we send them. The first arrives within about a week of
          connecting your accounts.
        </div>
      ) : (
        <div className="gl-panel">
          <div className="gl-tablewrap">
            <table className="gl-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Sent</th>
                  <th>Read</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const period = r.period.slice(0, 7); // YYYY-MM
                  return (
                    <tr key={r.id}>
                      <td className="gl-strong">{monthLabel(r.period)}</td>
                      <td className="gl-quiet">{sentLabel(r.sentAt)}</td>
                      <td>
                        <a
                          className="gl-link"
                          href={`/reports/${period}/view`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>{' '}
                        ·{' '}
                        <a className="gl-link" href={`/reports/${period}/pdf`}>
                          Download PDF
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

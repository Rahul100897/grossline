'use client';

// The in-app support widget (task 3.7): a floating button that opens a small
// form for the analyst's own bug log while building. Submissions land in the
// same inbox as marketing-site tickets, tagged in_app.
import { useState, useTransition } from 'react';
import { submitInAppTicket } from '../app/(console)/support-widget-action';

type State = 'idle' | 'done';

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await submitInAppTicket({
        type: String(formData.get('type') ?? 'bug'),
        subject: String(formData.get('subject') ?? ''),
        body: String(formData.get('body') ?? ''),
      });
      if (result.ok) {
        setState('done');
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {open ? (
        <div className="w-80 rounded border border-hairline bg-panel p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold">Report a bug / feedback</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setState('idle');
              }}
              className="text-slate hover:text-ink"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {state === 'done' ? (
            <div className="py-4 text-[13px] text-good">
              Logged. It&apos;s in the support inbox.
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setState('idle')}
                  className="rounded border border-hairline px-2.5 py-1 text-[13px] hover:bg-hover"
                >
                  Log another
                </button>
              </div>
            </div>
          ) : (
            <form action={onSubmit} className="flex flex-col gap-2">
              <select
                name="type"
                defaultValue="bug"
                className="rounded border border-hairline bg-panel px-2 py-1 text-[13px]"
              >
                {['bug', 'question', 'feedback', 'feature'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                name="subject"
                required
                placeholder="Subject"
                className="rounded border border-hairline bg-panel px-2 py-1 text-[13px]"
              />
              <textarea
                name="body"
                required
                rows={4}
                placeholder="What happened?"
                className="rounded border border-hairline bg-panel px-2 py-1 text-[13px]"
              />
              {error ? <p className="text-[12px] text-attn">{error}</p> : null}
              <button
                type="submit"
                disabled={pending}
                className="rounded border border-ink bg-ink px-3 py-1.5 text-[13px] text-paper hover:bg-slate disabled:opacity-50"
              >
                {pending ? 'Sending…' : 'Submit'}
              </button>
            </form>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-hairline bg-panel px-3 py-2 text-[13px] shadow hover:bg-hover"
        >
          Feedback
        </button>
      )}
    </div>
  );
}

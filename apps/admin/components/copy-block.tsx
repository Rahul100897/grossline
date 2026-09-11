'use client';

// A read-only text block with a copy button (task 5.B6, the WhatsApp summary).
// Plain text, ready to paste; the copy uses the clipboard API with a select
// fallback so it works even where clipboard permission is denied.
import { useRef, useState } from 'react';

export function CopyBlock({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ref.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        ref={ref}
        readOnly
        value={text}
        rows={Math.min(8, text.split('\n').length + 1)}
        className="w-full resize-none rounded border border-hairline bg-panel px-2 py-1.5 font-mono text-meta text-ink outline-none"
      />
      <div>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-hairline px-2.5 py-1 text-body hover:bg-hover"
        >
          {copied ? 'Copied' : label}
        </button>
      </div>
    </div>
  );
}

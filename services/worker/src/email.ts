// Worker-side email via Resend's REST API — dependency-free fetch, mirroring the
// admin email helper and the Anthropic commentary call. Used by the weekly
// digest (task 5.B5). No-ops gracefully when RESEND_API_KEY is unset (dev), and
// the caller learns whether it actually sent.
import { logger } from '@grossline/core';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type SendResult = { sent: boolean; reason?: string };

export function digestFromAddress(): string {
  return process.env.SUPPORT_FROM_EMAIL ?? process.env.ADMIN_EMAIL ?? 'reports@grossline.local';
}

export async function sendEmail(args: {
  to: string | string[];
  subject: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'RESEND_API_KEY not set' };
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: digestFromAddress(),
        to: Array.isArray(args.to) ? args.to : [args.to],
        subject: args.subject,
        text: args.text,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.warn('digest email failed', { status: response.status });
      return { sent: false, reason: `Resend ${response.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : 'send failed' };
  }
}

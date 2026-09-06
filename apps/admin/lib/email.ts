// Email via Resend's REST API — no SDK dependency, just fetch. Used for the
// support inbox (task 3.7): notify the analyst when a ticket arrives, and send
// a reply to the submitter. Graceful no-op when RESEND_API_KEY is unset so dev
// works without email configured; the caller learns whether it actually sent.
import 'server-only';

export type SendResult = { sent: boolean; reason?: string };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function supportFromAddress(): string {
  return process.env.SUPPORT_FROM_EMAIL ?? process.env.ADMIN_EMAIL ?? 'support@grossline.local';
}

export function adminNotifyAddress(): string | null {
  return process.env.ADMIN_EMAIL ?? null;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'RESEND_API_KEY not set' };
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: supportFromAddress(),
        to: [args.to],
        subject: args.subject,
        text: args.text,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { sent: false, reason: `Resend ${response.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : 'send failed' };
  }
}

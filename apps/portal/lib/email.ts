// Minimal transactional email for the portal (password-reset links). Mirrors
// services/worker/src/email.ts — a dependency-free Resend REST call. With no
// RESEND_API_KEY (local/dev) it does not send; it logs the link so the flow is
// still exercisable. Never throws into the request path.
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function portalBaseUrl(): string {
  return process.env.PORTAL_BASE_URL ?? 'http://localhost:3002';
}

function fromAddress(): string {
  return process.env.EMAIL_FROM ?? 'Grossline <no-reply@getgrossline.com>';
}

export async function sendPortalEmail(args: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[portal email — not sent, no RESEND_API_KEY]\nto: ${args.to}\n${args.text}`);
    return;
  }
  try {
    await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress(),
        to: args.to,
        subject: args.subject,
        text: args.text,
      }),
    });
  } catch {
    // Delivery failures must not reveal anything to the requester.
  }
}

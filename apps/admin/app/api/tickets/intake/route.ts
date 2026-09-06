// Public ticket intake for the marketing-site form (task 3.7). Unauthenticated
// — exempted from the admin middleware — so it validates strictly and carries a
// honeypot field against basic bots (no CAPTCHA, per the console's rules).
// CORS is opened for POST so the static marketing site can submit cross-origin.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { intakeTicket } from '../../../../lib/ticket-intake';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const intakeSchema = z.object({
  type: z.enum(['bug', 'question', 'feedback', 'feature']),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
  submitterName: z.string().max(200).optional(),
  submitterEmail: z.string().email().max(320).optional(),
  // Honeypot: real users never fill this hidden field.
  company: z.string().optional(),
});

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

export function OPTIONS(): Response {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: NextRequest): Promise<Response> {
  let parsed: z.infer<typeof intakeSchema>;
  try {
    parsed = intakeSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid submission' }, { status: 400, headers: corsHeaders() });
  }

  // Silently accept honeypot hits so bots get no signal, but store nothing.
  if (parsed.company && parsed.company.trim() !== '') {
    return NextResponse.json({ ok: true }, { headers: corsHeaders() });
  }

  try {
    await intakeTicket({
      type: parsed.type,
      source: 'marketing',
      subject: parsed.subject,
      body: parsed.body,
      submitterName: parsed.submitterName ?? null,
      submitterEmail: parsed.submitterEmail ?? null,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'could not save' }, { status: 500, headers: corsHeaders() });
  }
  return NextResponse.json({ ok: true }, { headers: corsHeaders() });
}

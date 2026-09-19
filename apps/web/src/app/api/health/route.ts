import { NextResponse } from 'next/server';

/**
 * Liveness: this process answers HTTP. Nothing else is asked, so a database
 * outage does not get every web container restarted in a loop — that is the
 * readiness probe's question.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}

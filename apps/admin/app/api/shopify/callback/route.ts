import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@grossline/core';
import { handleShopifyCallback } from '../../../../lib/shopify-install';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = await handleShopifyCallback(params);
  if (!result.ok) {
    logger.warn('shopify oauth callback rejected', { reason: result.reason });
    return new NextResponse(`Shopify install failed: ${result.reason}`, {
      status: result.status,
    }) as NextResponse;
  }
  logger.info('shopify oauth install completed', {
    connectionId: result.connectionId,
    scopeWarning: result.scopeWarning !== null,
  });
  return NextResponse.redirect(new URL('/connections', request.url), 303);
}

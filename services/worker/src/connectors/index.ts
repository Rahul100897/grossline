// Connector registrations. Providers land one task at a time in Phase 1.
import { registerConnector } from './registry';
import { shopifyConnector } from './shopify/connector';
import { metaConnector } from './meta/connector';
import { googleAdsConnector } from './google-ads/connector';

export function registerBuiltinConnectors(): void {
  registerConnector(shopifyConnector);
  registerConnector(metaConnector);
  registerConnector(googleAdsConnector);
}

// Connector registrations. Providers land one task at a time in Phase 1.
import { registerConnector } from './registry';
import { shopifyConnector } from './shopify/connector';

export function registerBuiltinConnectors(): void {
  registerConnector(shopifyConnector);
  // meta (1.3), google_ads (1.4) register here as they land.
}

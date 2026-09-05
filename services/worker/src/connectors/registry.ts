import type { Connector } from './types';

const registry = new Map<string, Connector>();

export function registerConnector(connector: Connector): void {
  registry.set(connector.provider, connector);
}

export function getConnector(provider: string): Connector {
  const connector = registry.get(provider);
  if (!connector) throw new Error(`no connector registered for provider "${provider}"`);
  return connector;
}

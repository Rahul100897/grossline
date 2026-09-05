export * as schema from './schema';
export { withTenant, type ScopedDb } from './tenant-scope';
export {
  createTenant,
  listTenants,
  listActiveTenants,
  type CreateTenantInput,
  type Tenant,
} from './admin';
export {
  putCredential,
  getCredential,
  type CredentialProvider,
  type CredentialPayload,
} from './credentials';
export { closeDbPools } from './client';
export { runMigrations } from './migrate';

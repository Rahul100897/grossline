-- RLS for sync_cursors: same tenant-isolation policy as every tenant table.
ALTER TABLE "sync_cursors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sync_cursors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sync_cursors"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

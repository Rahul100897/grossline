-- RLS for issue_log: same tenant-isolation policy as every tenant table.
ALTER TABLE "issue_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "issue_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "issue_log"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

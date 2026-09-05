-- RLS for raw_meta_insights: same tenant-isolation policy as every tenant table.
ALTER TABLE "raw_meta_insights" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "raw_meta_insights" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "raw_meta_insights"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

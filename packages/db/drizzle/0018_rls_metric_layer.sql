-- RLS for the metric layer: same tenant-isolation policy as every tenant table.
ALTER TABLE "metric_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "metric_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "metric_runs"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "metric_values" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "metric_values" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "metric_values"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

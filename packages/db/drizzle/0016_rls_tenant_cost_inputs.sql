-- RLS for tenant_cost_inputs: same tenant-isolation policy as every tenant table.
ALTER TABLE "tenant_cost_inputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_cost_inputs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_cost_inputs"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

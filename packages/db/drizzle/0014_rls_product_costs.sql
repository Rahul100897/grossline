-- RLS for product_costs: same tenant-isolation policy as every tenant table,
-- plus the shape guarantee that a cost row is keyed by sku, variant, or both.
ALTER TABLE "product_costs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_costs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "product_costs"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "product_costs" ADD CONSTRAINT product_costs_key_present
  CHECK (sku <> '' OR variant_id <> '');

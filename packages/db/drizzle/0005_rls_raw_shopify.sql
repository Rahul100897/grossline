-- RLS for the raw Shopify tables: same tenant-isolation policy as every
-- tenant table.
ALTER TABLE "raw_shopify_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "raw_shopify_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "raw_shopify_orders"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "raw_shopify_customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "raw_shopify_customers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "raw_shopify_customers"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "raw_shopify_products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "raw_shopify_products" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "raw_shopify_products"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

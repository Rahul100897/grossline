CREATE TABLE "raw_shopify_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"customer_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_shopify_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"order_created_at" timestamp with time zone NOT NULL,
	"order_updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_shopify_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"product_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raw_shopify_customers" ADD CONSTRAINT "raw_shopify_customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_shopify_customers" ADD CONSTRAINT "raw_shopify_customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_shopify_orders" ADD CONSTRAINT "raw_shopify_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_shopify_orders" ADD CONSTRAINT "raw_shopify_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_shopify_products" ADD CONSTRAINT "raw_shopify_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_shopify_products" ADD CONSTRAINT "raw_shopify_products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raw_shopify_customers_uniq" ON "raw_shopify_customers" USING btree ("tenant_id","store_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_shopify_orders_uniq" ON "raw_shopify_orders" USING btree ("tenant_id","store_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_shopify_products_uniq" ON "raw_shopify_products" USING btree ("tenant_id","store_id","product_id");
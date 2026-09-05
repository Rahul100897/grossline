CREATE TYPE "public"."product_cost_source" AS ENUM('shopify', 'upload');--> statement-breakpoint
CREATE TABLE "product_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"variant_id" text DEFAULT '' NOT NULL,
	"unit_cost_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"effective_from" date NOT NULL,
	"source" "product_cost_source" NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_costs_uniq" ON "product_costs" USING btree ("tenant_id","sku","variant_id","effective_from");
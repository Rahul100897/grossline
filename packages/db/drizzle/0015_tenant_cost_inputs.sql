CREATE TABLE "tenant_cost_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"currency" text NOT NULL,
	"payment_fee_bp" integer,
	"payment_fee_fixed_minor" integer,
	"shipping_cost_per_order_minor" integer,
	"fulfilment_cost_per_order_minor" integer,
	"packaging_cost_per_order_minor" integer,
	"monthly_revenue_target_minor" bigint,
	"monthly_spend_target_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_cost_inputs" ADD CONSTRAINT "tenant_cost_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_cost_inputs_uniq" ON "tenant_cost_inputs" USING btree ("tenant_id","effective_from");
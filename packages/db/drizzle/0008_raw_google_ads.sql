CREATE TABLE "raw_google_ads_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"date" date NOT NULL,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raw_google_ads_insights" ADD CONSTRAINT "raw_google_ads_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_google_ads_insights" ADD CONSTRAINT "raw_google_ads_insights_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raw_google_ads_insights_uniq" ON "raw_google_ads_insights" USING btree ("tenant_id","connection_id","campaign_id","date");
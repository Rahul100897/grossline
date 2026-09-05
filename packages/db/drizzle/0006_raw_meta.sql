CREATE TABLE "raw_meta_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"ad_account_id" text NOT NULL,
	"level" text NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raw_meta_insights" ADD CONSTRAINT "raw_meta_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_meta_insights" ADD CONSTRAINT "raw_meta_insights_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raw_meta_insights_uniq" ON "raw_meta_insights" USING btree ("tenant_id","connection_id","level","campaign_id","date");
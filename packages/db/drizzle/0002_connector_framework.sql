CREATE TABLE "sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"stream" text NOT NULL,
	"cursor" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "account_timezone" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "account_currency" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "backfill_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursors_conn_stream_idx" ON "sync_cursors" USING btree ("tenant_id","connection_id","stream");
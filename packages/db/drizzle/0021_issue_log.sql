CREATE TABLE "issue_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"issue_key" text NOT NULL,
	"severity" text NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"action" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "issue_log" ADD CONSTRAINT "issue_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_log_open_uniq" ON "issue_log" USING btree ("tenant_id","issue_key") WHERE "issue_log"."resolved_at" is null;
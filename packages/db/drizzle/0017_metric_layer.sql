CREATE TYPE "public"."metric_run_status" AS ENUM('running', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "metric_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "metric_run_status" DEFAULT 'running' NOT NULL,
	"error" text,
	"metrics_written" integer DEFAULT 0 NOT NULL,
	"raw_watermark" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metric_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"grain" text NOT NULL,
	"period" date NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"value" numeric(24, 8) NOT NULL,
	"currency" text,
	"meta" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "metric_runs" ADD CONSTRAINT "metric_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_values" ADD CONSTRAINT "metric_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_values" ADD CONSTRAINT "metric_values_run_id_metric_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."metric_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_values_uniq" ON "metric_values" USING btree ("tenant_id","metric","grain","period","scope");
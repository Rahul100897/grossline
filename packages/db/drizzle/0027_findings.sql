CREATE TYPE "public"."finding_status" AS ENUM('new', 'recurring', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" date NOT NULL,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"metric" text NOT NULL,
	"current_value" numeric(24, 8),
	"comparison_value" numeric(24, 8),
	"delta" numeric(24, 8),
	"entity" text NOT NULL,
	"entity_key" text NOT NULL,
	"entity_label" text NOT NULL,
	"money_impact_minor" integer NOT NULL,
	"currency" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "finding_status" NOT NULL,
	"first_seen_period" date NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"suppressed_reason" text,
	"check_metric" text,
	"check_baseline" numeric(24, 8),
	"approved_at" timestamp with time zone,
	"dismissed_reason" text,
	"dismissed_impact_minor" integer,
	"draft_text" text,
	"final_text" text,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_calibration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_calibration_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_calibration" ADD CONSTRAINT "tenant_calibration_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_uniq" ON "findings" USING btree ("tenant_id","period","rule_id","entity_key");
CREATE TYPE "public"."finding_family" AS ENUM('waste', 'growth', 'measurement');--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "opportunity_value_minor" integer;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "family" "finding_family" DEFAULT 'waste' NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_value_exclusive" CHECK ("findings"."opportunity_value_minor" is null or "findings"."money_impact_minor" = 0);--> statement-breakpoint
-- Existing rows backfill to 'waste' via the column default above; claim gap is
-- the one measurement-family rule (task 5.A1). Its money_impact is already 0.
UPDATE "findings" SET "family" = 'measurement' WHERE "rule_id" = 'claim_gap';
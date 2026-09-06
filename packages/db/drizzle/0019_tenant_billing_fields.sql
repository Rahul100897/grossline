ALTER TABLE "tenants" ADD COLUMN "monthly_fee_minor" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "fee_currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "partner_rate_until" date;
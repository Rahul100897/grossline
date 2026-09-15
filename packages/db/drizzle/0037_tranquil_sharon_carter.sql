ALTER TYPE "public"."merchant_token_purpose" ADD VALUE 'viewas';--> statement-breakpoint
ALTER TABLE "merchant_sessions" ADD COLUMN "view_as" boolean DEFAULT false NOT NULL;
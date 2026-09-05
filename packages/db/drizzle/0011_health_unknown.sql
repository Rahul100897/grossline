-- Add 'unknown' to connection_health. ALTER TYPE ... ADD VALUE cannot be used
-- inside the migration transaction (the new value may not be used before
-- commit), so recreate the type via a text cast — non-destructive.
ALTER TABLE "connections" ALTER COLUMN "health" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "health" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."connection_health";--> statement-breakpoint
CREATE TYPE "public"."connection_health" AS ENUM('healthy', 'degraded', 'broken', 'unknown');--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "health" SET DATA TYPE "public"."connection_health" USING "health"::"public"."connection_health";--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "health" SET DEFAULT 'unknown';

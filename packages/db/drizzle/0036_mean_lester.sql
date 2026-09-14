CREATE TYPE "public"."merchant_token_purpose" AS ENUM('invite', 'reset');--> statement-breakpoint
CREATE TABLE "merchant_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "merchant_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "merchant_tokens" ADD CONSTRAINT "merchant_tokens_user_id_merchant_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."merchant_users"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "llm_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task" text NOT NULL,
	"content_hash" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"result_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"base_url" text,
	"key_enc" text NOT NULL,
	"key_last4" text NOT NULL,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"key_source" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"cached" boolean DEFAULT false NOT NULL,
	"ok" boolean NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_cache" ADD CONSTRAINT "llm_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_keys" ADD CONSTRAINT "llm_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_cache_user_hash_uq" ON "llm_cache" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "llm_cache_expires_idx" ON "llm_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_keys_user_provider_uq" ON "llm_keys" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "llm_usage_user_created_idx" ON "llm_usage" USING btree ("user_id","created_at");--> statement-breakpoint
-- Existing installs: the first account is the owner, so it becomes admin (instance AI keys serve admins only).
UPDATE "users" SET "role" = 'admin' WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC, "id" ASC LIMIT 1);

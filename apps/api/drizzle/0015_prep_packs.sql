CREATE TABLE "prep_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"content_enc" text NOT NULL,
	"jd_hash" text,
	"resume_hash" text,
	"answers_hash" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"cost_usd" double precision,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prep_packs" ADD CONSTRAINT "prep_packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_packs" ADD CONSTRAINT "prep_packs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prep_packs_application_uq" ON "prep_packs" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "prep_packs_user_idx" ON "prep_packs" USING btree ("user_id");
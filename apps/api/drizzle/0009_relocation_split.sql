CREATE TABLE "data_migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "relocation_willing" boolean;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "relocation_preference" text;
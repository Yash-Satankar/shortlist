ALTER TABLE "email_cursors" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_cursors" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_cursors" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
UPDATE "email_cursors" SET "last_success_at" = "last_run_at" WHERE "last_error" IS NULL;
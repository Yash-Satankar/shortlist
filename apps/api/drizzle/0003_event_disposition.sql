CREATE TYPE "public"."event_disposition" AS ENUM('applied', 'ignored', 'pending_review', 'dismissed');--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "disposition" "event_disposition" DEFAULT 'applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "reason" text;--> statement-breakpoint
CREATE INDEX "status_events_pending_review_idx" ON "status_events" USING btree ("user_id") WHERE "status_events"."disposition" = 'pending_review';
ALTER TYPE "public"."event_source" ADD VALUE 'extension_auto' BEFORE 'portal';--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "confidence" text;
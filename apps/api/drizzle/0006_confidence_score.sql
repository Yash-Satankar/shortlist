ALTER TABLE "status_events" ADD COLUMN "confidence_score" double precision;--> statement-breakpoint
-- Carry existing labels over as scores (high → 0.9, low → 0.5). The old column is left as is.
UPDATE "status_events" SET "confidence_score" = CASE "confidence" WHEN 'high' THEN 0.9 WHEN 'low' THEN 0.5 END WHERE "confidence" IS NOT NULL AND "confidence_score" IS NULL;

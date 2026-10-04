ALTER TABLE "profiles" ADD COLUMN "resume_file_name" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "resume_file_size" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "resume_mime_type" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "resume_uploaded_at" timestamp with time zone;
CREATE TABLE "portal_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"site" text NOT NULL,
	"items_enc" text NOT NULL,
	"item_count" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sync_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"site" text NOT NULL,
	"snapshot_id" uuid,
	"kind" text NOT NULL,
	"application_id" uuid,
	"matched_by" text,
	"job_key" text NOT NULL,
	"job_url" text,
	"role_title" text NOT NULL,
	"company_name" text NOT NULL,
	"location" text,
	"raw_label" text NOT NULL,
	"proposed_status" "application_status" NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_snapshots" ADD CONSTRAINT "portal_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sync_items" ADD CONSTRAINT "portal_sync_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sync_items" ADD CONSTRAINT "portal_sync_items_snapshot_id_portal_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."portal_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sync_items" ADD CONSTRAINT "portal_sync_items_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_snapshots_user_idx" ON "portal_snapshots" USING btree ("user_id","captured_at");--> statement-breakpoint
CREATE INDEX "portal_snapshots_expires_idx" ON "portal_snapshots" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "portal_sync_items_user_decision_idx" ON "portal_sync_items" USING btree ("user_id","decision");--> statement-breakpoint
CREATE INDEX "portal_sync_items_job_idx" ON "portal_sync_items" USING btree ("user_id","site","job_key");
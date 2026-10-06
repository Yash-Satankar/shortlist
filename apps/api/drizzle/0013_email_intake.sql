CREATE TABLE "email_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mailbox_key" text NOT NULL,
	"uid_validity" text,
	"last_uid" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_inbound_addresses" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"local_part" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_inbound_addresses_local_part_unique" UNIQUE("local_part")
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"message_id" text NOT NULL,
	"from_domain" text NOT NULL,
	"from_enc" text NOT NULL,
	"subject_enc" text NOT NULL,
	"excerpt_enc" text,
	"received_at" timestamp with time zone NOT NULL,
	"category" text NOT NULL,
	"confidence" double precision NOT NULL,
	"classified_by" text NOT NULL,
	"outcome" text NOT NULL,
	"application_id" uuid,
	"matched_by" text,
	"event_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_cursors" ADD CONSTRAINT "email_cursors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_inbound_addresses" ADD CONSTRAINT "email_inbound_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_cursors_user_mailbox_uq" ON "email_cursors" USING btree ("user_id","mailbox_key");--> statement-breakpoint
CREATE UNIQUE INDEX "emails_user_message_uq" ON "emails" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX "emails_user_outcome_idx" ON "emails" USING btree ("user_id","outcome");--> statement-breakpoint
CREATE INDEX "emails_expires_idx" ON "emails" USING btree ("expires_at");
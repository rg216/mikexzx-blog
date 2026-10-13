CREATE TABLE "app_auth_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"code_challenge" text NOT NULL,
	"device_name" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_auth_codes" ADD CONSTRAINT "app_auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
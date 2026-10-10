CREATE TYPE "public"."comment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."commenter_trust" AS ENUM('default', 'trusted', 'blocked');--> statement-breakpoint
CREATE TABLE "commenter_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"commenter_id" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commenters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commenters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"avatar_url" text NOT NULL,
	"trust" "commenter_trust" DEFAULT 'default' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commenters_githubId_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"post_id" integer NOT NULL,
	"commenter_id" integer NOT NULL,
	"root_id" integer,
	"parent_id" integer,
	"body" text NOT NULL,
	"status" "comment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_root_has_no_parent" CHECK ("comments"."root_id" IS NOT NULL OR "comments"."parent_id" IS NULL),
	CONSTRAINT "comments_body_length" CHECK (char_length("comments"."body") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"code_verifier" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commenter_sessions" ADD CONSTRAINT "commenter_sessions_commenter_id_commenters_id_fk" FOREIGN KEY ("commenter_id") REFERENCES "public"."commenters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_commenter_id_commenters_id_fk" FOREIGN KEY ("commenter_id") REFERENCES "public"."commenters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_root_id_comments_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commenter_sessions_commenter_id_idx" ON "commenter_sessions" USING btree ("commenter_id");--> statement-breakpoint
CREATE INDEX "comments_post_idx" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_pending_idx" ON "comments" USING btree ("created_at") WHERE "comments"."status" = 'pending';
CREATE TYPE "public"."translation_origin" AS ENUM('machine', 'human');--> statement-breakpoint
CREATE TABLE "post_translations" (
	"post_id" integer NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"content_md" text NOT NULL,
	"excerpt" text NOT NULL,
	"source_hash" text NOT NULL,
	"origin" "translation_origin" NOT NULL,
	"model" text,
	"translated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector",
	CONSTRAINT "post_translations_post_id_locale_pk" PRIMARY KEY("post_id","locale"),
	CONSTRAINT "post_translations_locale_format" CHECK ("post_translations"."locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
	CONSTRAINT "post_translations_model_only_for_machine" CHECK ("post_translations"."origin" = 'machine' OR "post_translations"."model" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "source_locale" text DEFAULT 'zh' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_translations" ADD CONSTRAINT "post_translations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_translations_locale_idx" ON "post_translations" USING btree ("locale","post_id");--> statement-breakpoint
CREATE INDEX "post_translations_search_idx" ON "post_translations" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_source_locale_format" CHECK ("posts"."source_locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
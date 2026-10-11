CREATE TABLE "tag_translations" (
	"tag_id" integer NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tag_translations_tag_id_locale_pk" PRIMARY KEY("tag_id","locale"),
	CONSTRAINT "tag_translations_locale_format" CHECK ("tag_translations"."locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);
--> statement-breakpoint
ALTER TABLE "tag_translations" ADD CONSTRAINT "tag_translations_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_translations_locale_name_idx" ON "tag_translations" USING btree ("locale",lower("name"));
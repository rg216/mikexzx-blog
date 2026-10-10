CREATE TABLE "post_views" (
	"post_id" integer NOT NULL,
	"day" date NOT NULL,
	"views" integer NOT NULL,
	CONSTRAINT "post_views_post_id_day_pk" PRIMARY KEY("post_id","day")
);
--> statement-breakpoint
ALTER TABLE "post_views" ADD CONSTRAINT "post_views_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
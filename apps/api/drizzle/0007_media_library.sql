CREATE TABLE "media_folders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "media_folders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_folders_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "post_images" (
	"post_id" integer NOT NULL,
	"image_id" integer NOT NULL,
	CONSTRAINT "post_images_post_id_image_id_pk" PRIMARY KEY("post_id","image_id")
);
--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "filename" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "variants" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "folder_id" integer;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_images_image_id_idx" ON "post_images" USING btree ("image_id");--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_folder_id_media_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."media_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "images_folder_idx" ON "images" USING btree ("folder_id");
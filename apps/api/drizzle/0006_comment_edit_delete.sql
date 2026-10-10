ALTER TABLE "comments" DROP CONSTRAINT "comments_body_length";--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "edited_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "deleted_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_body_length" CHECK ("comments"."deleted_at" IS NOT NULL OR char_length("comments"."body") BETWEEN 1 AND 5000);
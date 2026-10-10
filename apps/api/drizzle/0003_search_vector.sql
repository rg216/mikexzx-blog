ALTER TABLE "posts" ADD COLUMN "search_vector" "tsvector";--> statement-breakpoint
CREATE INDEX "posts_search_idx" ON "posts" USING gin ("search_vector") WHERE "posts"."status" = 'published';
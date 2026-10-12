CREATE TABLE "job_runs" (
	"name" text PRIMARY KEY NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"finished_at" timestamp (3) with time zone NOT NULL,
	"ok" boolean NOT NULL,
	"detail" jsonb NOT NULL,
	"last_success_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);

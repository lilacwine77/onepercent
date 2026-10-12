CREATE TABLE "digest_runs" (
	"day" date PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"jobs" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "go_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"action" text NOT NULL,
	"edition" text,
	"n" smallint,
	"ref" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "go_sessions_id" CHECK ("go_sessions"."id" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "go_sessions_action" CHECK ("go_sessions"."action" IN ('feed','rip','cards')),
	CONSTRAINT "go_sessions_edition" CHECK ("go_sessions"."edition" IN ('original','blue_shift','signature','after_hours')),
	CONSTRAINT "go_sessions_n" CHECK ("go_sessions"."n" BETWEEN 1 AND 10),
	CONSTRAINT "go_sessions_ref" CHECK ("go_sessions"."ref" ~ '^([1-9A-HJ-NP-Za-km-z]{32,44}|[a-z0-9_]{3,16})$'),
	CONSTRAINT "go_sessions_rip_fields" CHECK ("go_sessions"."action" = 'rip' OR ("go_sessions"."edition" IS NULL AND "go_sessions"."n" IS NULL)),
	CONSTRAINT "go_sessions_n_edition" CHECK ("go_sessions"."n" IS NULL OR "go_sessions"."edition" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "link_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"bot_username" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "link_nonces_nonce" CHECK ("link_nonces"."nonce" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
CREATE TABLE "notify_cursors" (
	"name" text PRIMARY KEY NOT NULL,
	"slot" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notify_cursors_name" CHECK ("notify_cursors"."name" IN ('royalties','hits'))
);
--> statement-breakpoint
CREATE TABLE "notify_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notify_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dedupe_key" text NOT NULL,
	"chat_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"priority" smallint NOT NULL,
	"payload" jsonb NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "notify_jobs_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "notify_jobs_kind" CHECK ("notify_jobs"."kind" IN ('royalty','hit','digest')),
	CONSTRAINT "notify_jobs_status" CHECK ("notify_jobs"."status" IN ('queued','sending','sent','skipped','failed','expired'))
);
--> statement-breakpoint
CREATE TABLE "tg_chats" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"alerts" text DEFAULT 'off' NOT NULL,
	"hits" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tg_chats_kind" CHECK ("tg_chats"."kind" IN ('private','group')),
	CONSTRAINT "tg_chats_alerts" CHECK ("tg_chats"."alerts" IN ('off','live','daily')),
	CONSTRAINT "tg_chats_private_alerts" CHECK ("tg_chats"."kind" = 'private' OR "tg_chats"."alerts" = 'off'),
	CONSTRAINT "tg_chats_group_hits" CHECK ("tg_chats"."kind" = 'group' OR "tg_chats"."hits" = false)
);
--> statement-breakpoint
CREATE TABLE "tg_links" (
	"telegram_user_id" bigint PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tg_links_wallet_unique" UNIQUE("wallet"),
	CONSTRAINT "tg_links_wallet" CHECK ("tg_links"."wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
CREATE TABLE "tg_referrals" (
	"telegram_user_id" bigint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tg_referrals_code" CHECK ("tg_referrals"."code" ~ '^([1-9A-HJ-NP-Za-km-z]{32,44}|[a-z0-9_]{3,16})$')
);
--> statement-breakpoint
CREATE INDEX "go_sessions_user_idx" ON "go_sessions" USING btree ("telegram_user_id","created_at");--> statement-breakpoint
CREATE INDEX "go_sessions_expiry_idx" ON "go_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "link_nonces_open_user_idx" ON "link_nonces" USING btree ("telegram_user_id") WHERE "link_nonces"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notify_jobs_due_idx" ON "notify_jobs" USING btree ("priority","id") WHERE "notify_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "notify_jobs_chat_idx" ON "notify_jobs" USING btree ("chat_id","kind") WHERE "notify_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "tg_chats_hits_idx" ON "tg_chats" USING btree ("chat_id") WHERE "tg_chats"."hits" AND "tg_chats"."blocked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "royalties_settle_sig_idx" ON "royalties" USING btree ("settle_sig");
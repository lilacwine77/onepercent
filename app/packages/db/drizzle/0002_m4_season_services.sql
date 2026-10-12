CREATE TABLE "block0_buys" (
	"signature" text NOT NULL,
	"owner" text NOT NULL,
	"launch_signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"tokens" numeric(20,0) NOT NULL,
	"lamports_spent" numeric(20,0),
	"team" boolean NOT NULL,
	"role" text,
	CONSTRAINT "block0_buys_signature_owner_pk" PRIMARY KEY("signature","owner"),
	CONSTRAINT "tokens_u64" CHECK ("block0_buys"."tokens" >= 0 AND "block0_buys"."tokens" <= 18446744073709551615),
	CONSTRAINT "lamports_spent_u64" CHECK ("block0_buys"."lamports_spent" >= 0 AND "block0_buys"."lamports_spent" <= 18446744073709551615)
);
--> statement-breakpoint
CREATE TABLE "creator_fee_collections" (
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"tx_index" bigint NOT NULL,
	"ix_index" bigint NOT NULL,
	"event_index" bigint NOT NULL,
	"regime" text NOT NULL,
	"amount" numeric(20,0) NOT NULL,
	"from_fee_in" numeric(20,0) NOT NULL,
	"from_wsol" numeric(20,0) NOT NULL,
	"to_stock" numeric(20,0) NOT NULL,
	"to_burn" numeric(20,0) NOT NULL,
	"to_team" numeric(20,0) NOT NULL,
	"book" numeric(20,0) NOT NULL,
	"target" numeric(20,0) NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "creator_fee_collections_signature_event_index_pk" PRIMARY KEY("signature","event_index"),
	CONSTRAINT "amount_u64" CHECK ("creator_fee_collections"."amount" >= 0 AND "creator_fee_collections"."amount" <= 18446744073709551615),
	CONSTRAINT "from_fee_in_u64" CHECK ("creator_fee_collections"."from_fee_in" >= 0 AND "creator_fee_collections"."from_fee_in" <= 18446744073709551615),
	CONSTRAINT "from_wsol_u64" CHECK ("creator_fee_collections"."from_wsol" >= 0 AND "creator_fee_collections"."from_wsol" <= 18446744073709551615),
	CONSTRAINT "to_stock_u64" CHECK ("creator_fee_collections"."to_stock" >= 0 AND "creator_fee_collections"."to_stock" <= 18446744073709551615),
	CONSTRAINT "to_burn_u64" CHECK ("creator_fee_collections"."to_burn" >= 0 AND "creator_fee_collections"."to_burn" <= 18446744073709551615),
	CONSTRAINT "to_team_u64" CHECK ("creator_fee_collections"."to_team" >= 0 AND "creator_fee_collections"."to_team" <= 18446744073709551615),
	CONSTRAINT "book_u64" CHECK ("creator_fee_collections"."book" >= 0 AND "creator_fee_collections"."book" <= 18446744073709551615),
	CONSTRAINT "target_u64" CHECK ("creator_fee_collections"."target" >= 0 AND "creator_fee_collections"."target" <= 18446744073709551615),
	CONSTRAINT "creator_fee_regime_valid" CHECK ("creator_fee_collections"."regime" IN ('belowFloor','season','afterEnd'))
);
--> statement-breakpoint
CREATE TABLE "executor_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executor_job_attempts_nonnegative" CHECK ("executor_jobs"."attempts" >= 0),
	CONSTRAINT "executor_job_status_valid" CHECK ("executor_jobs"."status" IN ('pending','sent','confirmed','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "executor_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature" text,
	"kind" text NOT NULL,
	"amount" numeric(20,0) NOT NULL,
	"min_out" numeric(20,0) NOT NULL,
	"jupiter_out" numeric(20,0),
	"delta" numeric(20,0),
	"slippage_bps" integer,
	"status" text NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "amount_u64" CHECK ("executor_trades"."amount" >= 0 AND "executor_trades"."amount" <= 18446744073709551615),
	CONSTRAINT "min_out_u64" CHECK ("executor_trades"."min_out" >= 0 AND "executor_trades"."min_out" <= 18446744073709551615),
	CONSTRAINT "jupiter_out_u64" CHECK ("executor_trades"."jupiter_out" >= 0 AND "executor_trades"."jupiter_out" <= 18446744073709551615),
	CONSTRAINT "delta_u64" CHECK ("executor_trades"."delta" >= 0 AND "executor_trades"."delta" <= 18446744073709551615),
	CONSTRAINT "executor_trade_status_valid" CHECK ("executor_trades"."status" IN ('planned','simulated','sent','confirmed','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "season_launches" (
	"signature" text PRIMARY KEY NOT NULL,
	"slot" bigint NOT NULL,
	"mint" text NOT NULL,
	"launch_pool" text NOT NULL,
	"dev_buy_tokens" numeric(20,0) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"as_of_slot" bigint NOT NULL,
	CONSTRAINT "dev_buy_tokens_u64" CHECK ("season_launches"."dev_buy_tokens" >= 0 AND "season_launches"."dev_buy_tokens" <= 18446744073709551615),
	CONSTRAINT "season_launch_status_valid" CHECK ("season_launches"."status" IN ('pending','ready'))
);
--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "live_flags" integer;--> statement-breakpoint
ALTER TABLE "block0_buys" ADD CONSTRAINT "block0_buys_launch_signature_season_launches_signature_fk" FOREIGN KEY ("launch_signature") REFERENCES "public"."season_launches"("signature") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_fee_collections" ADD CONSTRAINT "creator_fee_collections_signature_chain_txs_signature_fk" FOREIGN KEY ("signature") REFERENCES "public"."chain_txs"("signature") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_launches" ADD CONSTRAINT "season_launches_signature_chain_txs_signature_fk" FOREIGN KEY ("signature") REFERENCES "public"."chain_txs"("signature") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "block0_buys_launch_idx" ON "block0_buys" USING btree ("launch_signature","slot");--> statement-breakpoint
CREATE INDEX "creator_fee_collections_order_idx" ON "creator_fee_collections" USING btree ("slot","tx_index","ix_index","event_index");--> statement-breakpoint
CREATE INDEX "executor_jobs_status_idx" ON "executor_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "executor_trades_signature_idx" ON "executor_trades" USING btree ("signature");--> statement-breakpoint
CREATE INDEX "executor_trades_created_idx" ON "executor_trades" USING btree ("created_at");
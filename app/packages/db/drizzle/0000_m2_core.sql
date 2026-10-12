CREATE TABLE "alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"severity" text NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"count" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "alert_severity_valid" CHECK ("alerts"."severity" IN ('info', 'warning', 'critical')),
	CONSTRAINT "alert_count_positive" CHECK ("alerts"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "attestation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_sha256" text NOT NULL,
	"kind" text NOT NULL,
	"wallet" text NOT NULL,
	"nonce" bigint NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"bags" jsonb NOT NULL,
	"signer" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attestation_kind_valid" CHECK ("attestation_log"."kind" = 'FEED')
);
--> statement-breakpoint
CREATE TABLE "buckets" (
	"index" integer PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"class" text NOT NULL,
	"enabled" boolean NOT NULL,
	"amount" numeric(20,0) NOT NULL,
	"cost" numeric(20,0) NOT NULL,
	"reserved" numeric(20,0) NOT NULL,
	"cap" numeric(20,0) NOT NULL,
	"listed_slot" bigint NOT NULL,
	"failing" boolean DEFAULT false NOT NULL,
	CONSTRAINT "amount_u64" CHECK ("buckets"."amount" >= 0 AND "buckets"."amount" <= 18446744073709551615),
	CONSTRAINT "cost_u64" CHECK ("buckets"."cost" >= 0 AND "buckets"."cost" <= 18446744073709551615),
	CONSTRAINT "reserved_u64" CHECK ("buckets"."reserved" >= 0 AND "buckets"."reserved" <= 18446744073709551615),
	CONSTRAINT "cap_u64" CHECK ("buckets"."cap" >= 0 AND "buckets"."cap" <= 18446744073709551615),
	CONSTRAINT "bucket_class_valid" CHECK ("buckets"."class" IN ('major', 'trending'))
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"tx_index" bigint NOT NULL,
	"ix_index" bigint NOT NULL,
	"event_index" bigint NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "chain_events_signature_ix_index_event_index_pk" PRIMARY KEY("signature","ix_index","event_index")
);
--> statement-breakpoint
CREATE TABLE "chain_txs" (
	"signature" text PRIMARY KEY NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" timestamp with time zone,
	"tx_index" bigint NOT NULL,
	"commitment" text NOT NULL,
	"err" jsonb,
	"truncated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "commitment_valid" CHECK ("chain_txs"."commitment" IN ('confirmed', 'finalized'))
);
--> statement-breakpoint
CREATE TABLE "cursors" (
	"name" text PRIMARY KEY NOT NULL,
	"last_signature" text,
	"last_slot" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck_entries" (
	"deck_index" bigint PRIMARY KEY NOT NULL,
	"depositor" text NOT NULL,
	"mint" text NOT NULL,
	"amount" numeric(20,0) NOT NULL,
	"deposit" numeric(20,0) NOT NULL,
	"flags" integer NOT NULL,
	"slot" bigint NOT NULL,
	"tx_index" bigint NOT NULL,
	"ix_index" bigint NOT NULL,
	"event_index" bigint NOT NULL,
	CONSTRAINT "amount_u64" CHECK ("deck_entries"."amount" >= 0 AND "deck_entries"."amount" <= 18446744073709551615),
	CONSTRAINT "deposit_u64" CHECK ("deck_entries"."deposit" >= 0 AND "deck_entries"."deposit" <= 18446744073709551615)
);
--> statement-breakpoint
CREATE TABLE "dust_picks" (
	"seq" numeric(20,0) NOT NULL,
	"pack" integer NOT NULL,
	"k" integer NOT NULL,
	"deck_len_before" bigint NOT NULL,
	"deck_index" bigint NOT NULL,
	"moved_from" bigint NOT NULL,
	"mint" text NOT NULL,
	"amount" numeric(20,0) NOT NULL,
	"depositor" text NOT NULL,
	"royalty" numeric(20,0) NOT NULL,
	"refund" numeric(20,0) NOT NULL,
	"paid" numeric(20,0) NOT NULL,
	"redirected" boolean NOT NULL,
	"settle_sig" text,
	CONSTRAINT "dust_picks_seq_pack_k_pk" PRIMARY KEY("seq","pack","k"),
	CONSTRAINT "seq_u64" CHECK ("dust_picks"."seq" >= 0 AND "dust_picks"."seq" <= 18446744073709551615),
	CONSTRAINT "amount_u64" CHECK ("dust_picks"."amount" >= 0 AND "dust_picks"."amount" <= 18446744073709551615),
	CONSTRAINT "royalty_u64" CHECK ("dust_picks"."royalty" >= 0 AND "dust_picks"."royalty" <= 18446744073709551615),
	CONSTRAINT "refund_u64" CHECK ("dust_picks"."refund" >= 0 AND "dust_picks"."refund" <= 18446744073709551615),
	CONSTRAINT "paid_u64" CHECK ("dust_picks"."paid" >= 0 AND "dust_picks"."paid" <= 18446744073709551615)
);
--> statement-breakpoint
CREATE TABLE "exec_trades" (
	"signature" text PRIMARY KEY NOT NULL,
	"slot" bigint NOT NULL,
	"tx_index" bigint NOT NULL,
	"ix_index" bigint NOT NULL,
	"event_index" bigint NOT NULL,
	"kind" integer NOT NULL,
	"bucket" integer NOT NULL,
	"mint" text NOT NULL,
	"signer" text NOT NULL,
	"amount" numeric(20,0) NOT NULL,
	"min_out" numeric(20,0) NOT NULL,
	"v0" numeric(20,0) NOT NULL,
	"book" numeric(20,0) NOT NULL,
	"expected" numeric(20,0) NOT NULL,
	"delta" numeric(20,0) NOT NULL,
	"tracked_after" numeric(20,0) NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "amount_u64" CHECK ("exec_trades"."amount" >= 0 AND "exec_trades"."amount" <= 18446744073709551615),
	CONSTRAINT "min_out_u64" CHECK ("exec_trades"."min_out" >= 0 AND "exec_trades"."min_out" <= 18446744073709551615),
	CONSTRAINT "v0_u64" CHECK ("exec_trades"."v0" >= 0 AND "exec_trades"."v0" <= 18446744073709551615),
	CONSTRAINT "book_u64" CHECK ("exec_trades"."book" >= 0 AND "exec_trades"."book" <= 18446744073709551615),
	CONSTRAINT "expected_u64" CHECK ("exec_trades"."expected" >= 0 AND "exec_trades"."expected" <= 18446744073709551615),
	CONSTRAINT "delta_u64" CHECK ("exec_trades"."delta" >= 0 AND "exec_trades"."delta" <= 18446744073709551615),
	CONSTRAINT "tracked_after_u64" CHECK ("exec_trades"."tracked_after" >= 0 AND "exec_trades"."tracked_after" <= 18446744073709551615)
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"signature" text NOT NULL,
	"event_index" bigint NOT NULL,
	"depositor" text NOT NULL,
	"mint" text NOT NULL,
	"amount" numeric(20,0) NOT NULL,
	"deck_index" bigint NOT NULL,
	"deposit" numeric(20,0) NOT NULL,
	"fresh_in_deck" integer NOT NULL,
	"attestation_sha256" text,
	CONSTRAINT "feeds_signature_event_index_pk" PRIMARY KEY("signature","event_index"),
	CONSTRAINT "amount_u64" CHECK ("feeds"."amount" >= 0 AND "feeds"."amount" <= 18446744073709551615),
	CONSTRAINT "deposit_u64" CHECK ("feeds"."deposit" >= 0 AND "feeds"."deposit" <= 18446744073709551615)
);
--> statement-breakpoint
CREATE TABLE "hitlist_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mint" text NOT NULL,
	"class" text NOT NULL,
	"passed" boolean NOT NULL,
	"slot" bigint NOT NULL,
	"cap_lamports" numeric(20,0),
	"oracle" text,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cap_lamports_u64" CHECK ("hitlist_reports"."cap_lamports" >= 0 AND "hitlist_reports"."cap_lamports" <= 18446744073709551615),
	CONSTRAINT "hitlist_class_valid" CHECK ("hitlist_reports"."class" IN ('major', 'trending'))
);
--> statement-breakpoint
CREATE TABLE "intake_consumption" (
	"holder" text NOT NULL,
	"mint" text NOT NULL,
	"used_by" text NOT NULL,
	"path" text NOT NULL,
	"first_feed_sig" text NOT NULL,
	"slot" bigint NOT NULL,
	CONSTRAINT "intake_consumption_holder_mint_pk" PRIMARY KEY("holder","mint"),
	CONSTRAINT "consumption_path_valid" CHECK ("intake_consumption"."path" IN ('self', 'hop', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "keeper_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"signature" text,
	CONSTRAINT "job_status_valid" CHECK ("keeper_jobs"."status" IN ('pending', 'sent', 'confirmed', 'failed', 'skipped')),
	CONSTRAINT "attempts_nonnegative" CHECK ("keeper_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "machine_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"slot" bigint NOT NULL,
	"machine" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"deck_len" bigint NOT NULL,
	CONSTRAINT "machine_singleton" CHECK ("machine_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "mint_ledgers" (
	"mint" text PRIMARY KEY NOT NULL,
	"ledger" text NOT NULL,
	"payer" text NOT NULL,
	"accounted" numeric(20,0) NOT NULL,
	"vault" text NOT NULL,
	"token_program" text NOT NULL,
	"vault_exists" boolean NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "accounted_u64" CHECK ("mint_ledgers"."accounted" >= 0 AND "mint_ledgers"."accounted" <= 18446744073709551615)
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"seq" numeric(20,0) NOT NULL,
	"pack" integer NOT NULL,
	"t" bigint NOT NULL,
	"widths" integer[] NOT NULL,
	"tier" integer NOT NULL,
	"hit_bucket" integer NOT NULL,
	"hit_mint" text NOT NULL,
	"hit_amount" numeric(20,0) NOT NULL,
	"hit_value" numeric(20,0) NOT NULL,
	"house_mask" integer NOT NULL,
	"fresh_mask" integer NOT NULL,
	CONSTRAINT "packs_seq_pack_pk" PRIMARY KEY("seq","pack"),
	CONSTRAINT "seq_u64" CHECK ("packs"."seq" >= 0 AND "packs"."seq" <= 18446744073709551615),
	CONSTRAINT "hit_amount_u64" CHECK ("packs"."hit_amount" >= 0 AND "packs"."hit_amount" <= 18446744073709551615),
	CONSTRAINT "hit_value_u64" CHECK ("packs"."hit_value" >= 0 AND "packs"."hit_value" <= 18446744073709551615),
	CONSTRAINT "widths_six" CHECK (cardinality("packs"."widths") = 6)
);
--> statement-breakpoint
CREATE TABLE "pulls" (
	"seq" numeric(20,0) PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"buyer" text NOT NULL,
	"buyer_nonce" bigint NOT NULL,
	"edition" integer NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(20,0) NOT NULL,
	"referrer" text,
	"holder" boolean NOT NULL,
	"status" text NOT NULL,
	"created_ts" timestamp with time zone NOT NULL,
	"opened_sig" text NOT NULL,
	"revealed_sig" text,
	"revealed_slot" bigint,
	"reveal_order" bigint,
	"live_flags" integer NOT NULL,
	"randomness" text,
	"settled_mask" integer NOT NULL,
	CONSTRAINT "seq_u64" CHECK ("pulls"."seq" >= 0 AND "pulls"."seq" <= 18446744073709551615),
	CONSTRAINT "price_u64" CHECK ("pulls"."price" >= 0 AND "pulls"."price" <= 18446744073709551615),
	CONSTRAINT "pull_status_valid" CHECK ("pulls"."status" IN ('pending', 'revealed', 'closed', 'refunded'))
);
--> statement-breakpoint
CREATE TABLE "quote_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_sha256" text NOT NULL,
	"owner" text NOT NULL,
	"mint" text NOT NULL,
	"card_indices" integer[] NOT NULL,
	"amounts" numeric(20,0)[] NOT NULL,
	"total_amount" numeric(20,0) NOT NULL,
	"quote_lamports" numeric(20,0) NOT NULL,
	"value_lamports" numeric(20,0) NOT NULL,
	"payout_lamports" numeric(20,0) NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"nonce" bigint NOT NULL,
	"router" text NOT NULL,
	"request_id" text NOT NULL,
	"signer" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amounts_u64" CHECK (0 <= ALL("quote_log"."amounts") AND 18446744073709551615 >= ALL("quote_log"."amounts")),
	CONSTRAINT "total_amount_u64" CHECK ("quote_log"."total_amount" >= 0 AND "quote_log"."total_amount" <= 18446744073709551615),
	CONSTRAINT "quote_lamports_u64" CHECK ("quote_log"."quote_lamports" >= 0 AND "quote_log"."quote_lamports" <= 18446744073709551615),
	CONSTRAINT "value_lamports_u64" CHECK ("quote_log"."value_lamports" >= 0 AND "quote_log"."value_lamports" <= 18446744073709551615),
	CONSTRAINT "payout_lamports_u64" CHECK ("quote_log"."payout_lamports" >= 0 AND "quote_log"."payout_lamports" <= 18446744073709551615),
	CONSTRAINT "quote_card_lengths" CHECK (cardinality("quote_log"."card_indices") = cardinality("quote_log"."amounts"))
);
--> statement-breakpoint
CREATE TABLE "royalties" (
	"seq" numeric(20,0) NOT NULL,
	"pack" integer NOT NULL,
	"k" integer NOT NULL,
	"depositor" text NOT NULL,
	"amount" numeric(20,0) NOT NULL,
	"refund" numeric(20,0) NOT NULL,
	"paid" numeric(20,0) NOT NULL,
	"redirected" boolean NOT NULL,
	"settle_sig" text,
	CONSTRAINT "royalties_seq_pack_k_pk" PRIMARY KEY("seq","pack","k"),
	CONSTRAINT "seq_u64" CHECK ("royalties"."seq" >= 0 AND "royalties"."seq" <= 18446744073709551615),
	CONSTRAINT "amount_u64" CHECK ("royalties"."amount" >= 0 AND "royalties"."amount" <= 18446744073709551615),
	CONSTRAINT "refund_u64" CHECK ("royalties"."refund" >= 0 AND "royalties"."refund" <= 18446744073709551615),
	CONSTRAINT "paid_u64" CHECK ("royalties"."paid" >= 0 AND "royalties"."paid" <= 18446744073709551615)
);
--> statement-breakpoint
CREATE TABLE "sell_backs" (
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"tx_index" bigint NOT NULL,
	"ix_index" bigint NOT NULL,
	"event_index" bigint NOT NULL,
	"owner" text NOT NULL,
	"mint" text NOT NULL,
	"bucket" integer NOT NULL,
	"n" integer NOT NULL,
	"total_amount" numeric(20,0) NOT NULL,
	"stocked_value" numeric(20,0) NOT NULL,
	"quote_lamports" numeric(20,0) NOT NULL,
	"value" numeric(20,0) NOT NULL,
	"payout" numeric(20,0) NOT NULL,
	"to_team" numeric(20,0) NOT NULL,
	"nonce" bigint NOT NULL,
	"sb_paid_hour" numeric(20,0) NOT NULL,
	"slot_refund" numeric(20,0) NOT NULL,
	CONSTRAINT "sell_backs_signature_event_index_pk" PRIMARY KEY("signature","event_index"),
	CONSTRAINT "total_amount_u64" CHECK ("sell_backs"."total_amount" >= 0 AND "sell_backs"."total_amount" <= 18446744073709551615),
	CONSTRAINT "stocked_value_u64" CHECK ("sell_backs"."stocked_value" >= 0 AND "sell_backs"."stocked_value" <= 18446744073709551615),
	CONSTRAINT "quote_lamports_u64" CHECK ("sell_backs"."quote_lamports" >= 0 AND "sell_backs"."quote_lamports" <= 18446744073709551615),
	CONSTRAINT "value_u64" CHECK ("sell_backs"."value" >= 0 AND "sell_backs"."value" <= 18446744073709551615),
	CONSTRAINT "payout_u64" CHECK ("sell_backs"."payout" >= 0 AND "sell_backs"."payout" <= 18446744073709551615),
	CONSTRAINT "to_team_u64" CHECK ("sell_backs"."to_team" >= 0 AND "sell_backs"."to_team" <= 18446744073709551615),
	CONSTRAINT "sb_paid_hour_u64" CHECK ("sell_backs"."sb_paid_hour" >= 0 AND "sell_backs"."sb_paid_hour" <= 18446744073709551615),
	CONSTRAINT "slot_refund_u64" CHECK ("sell_backs"."slot_refund" >= 0 AND "sell_backs"."slot_refund" <= 18446744073709551615)
);
--> statement-breakpoint
CREATE TABLE "stock_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" bigint NOT NULL,
	"chain_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"live" boolean NOT NULL,
	"state" jsonb NOT NULL,
	"plan" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"signature" text,
	"kind" integer NOT NULL,
	"bucket" integer NOT NULL,
	"mint" text NOT NULL,
	"amount" numeric(20,0) NOT NULL,
	"min_out" numeric(20,0) NOT NULL,
	"out_amount" numeric(20,0) NOT NULL,
	"delta" numeric(20,0),
	"slippage_bps" integer,
	"live" boolean NOT NULL,
	"status" text NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "amount_u64" CHECK ("stock_trades"."amount" >= 0 AND "stock_trades"."amount" <= 18446744073709551615),
	CONSTRAINT "min_out_u64" CHECK ("stock_trades"."min_out" >= 0 AND "stock_trades"."min_out" <= 18446744073709551615),
	CONSTRAINT "out_amount_u64" CHECK ("stock_trades"."out_amount" >= 0 AND "stock_trades"."out_amount" <= 18446744073709551615),
	CONSTRAINT "delta_u64" CHECK ("stock_trades"."delta" >= 0 AND "stock_trades"."delta" <= 18446744073709551615),
	CONSTRAINT "stock_trade_status_valid" CHECK ("stock_trades"."status" IN ('planned', 'simulated', 'sent', 'confirmed', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "chain_events" ADD CONSTRAINT "chain_events_signature_chain_txs_signature_fk" FOREIGN KEY ("signature") REFERENCES "public"."chain_txs"("signature") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dust_picks" ADD CONSTRAINT "dust_picks_seq_pulls_seq_fk" FOREIGN KEY ("seq") REFERENCES "public"."pulls"("seq") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exec_trades" ADD CONSTRAINT "exec_trades_signature_chain_txs_signature_fk" FOREIGN KEY ("signature") REFERENCES "public"."chain_txs"("signature") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_signature_chain_txs_signature_fk" FOREIGN KEY ("signature") REFERENCES "public"."chain_txs"("signature") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_seq_pulls_seq_fk" FOREIGN KEY ("seq") REFERENCES "public"."pulls"("seq") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalties" ADD CONSTRAINT "royalties_seq_pulls_seq_fk" FOREIGN KEY ("seq") REFERENCES "public"."pulls"("seq") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sell_backs" ADD CONSTRAINT "sell_backs_signature_chain_txs_signature_fk" FOREIGN KEY ("signature") REFERENCES "public"."chain_txs"("signature") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_trades" ADD CONSTRAINT "stock_trades_plan_id_stock_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."stock_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_recent_idx" ON "alerts" USING btree ("last_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attestation_log_message_idx" ON "attestation_log" USING btree ("message_sha256");--> statement-breakpoint
CREATE INDEX "attestation_log_wallet_idx" ON "attestation_log" USING btree ("wallet","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buckets_mint_idx" ON "buckets" USING btree ("mint");--> statement-breakpoint
CREATE INDEX "chain_events_order_idx" ON "chain_events" USING btree ("slot","tx_index","ix_index","event_index");--> statement-breakpoint
CREATE INDEX "chain_events_name_idx" ON "chain_events" USING btree ("name","slot");--> statement-breakpoint
CREATE INDEX "chain_txs_order_idx" ON "chain_txs" USING btree ("slot","tx_index");--> statement-breakpoint
CREATE INDEX "chain_txs_finality_idx" ON "chain_txs" USING btree ("commitment","slot");--> statement-breakpoint
CREATE INDEX "deck_entries_order_idx" ON "deck_entries" USING btree ("slot","tx_index","ix_index","event_index");--> statement-breakpoint
CREATE INDEX "deck_entries_depositor_idx" ON "deck_entries" USING btree ("depositor","mint");--> statement-breakpoint
CREATE INDEX "dust_picks_depositor_idx" ON "dust_picks" USING btree ("depositor","seq");--> statement-breakpoint
CREATE INDEX "exec_trades_order_idx" ON "exec_trades" USING btree ("slot","tx_index","ix_index","event_index");--> statement-breakpoint
CREATE INDEX "exec_trades_mint_idx" ON "exec_trades" USING btree ("mint","ts");--> statement-breakpoint
CREATE INDEX "feeds_depositor_idx" ON "feeds" USING btree ("depositor","mint");--> statement-breakpoint
CREATE INDEX "feeds_attestation_idx" ON "feeds" USING btree ("attestation_sha256");--> statement-breakpoint
CREATE INDEX "hitlist_reports_mint_idx" ON "hitlist_reports" USING btree ("mint","created_at");--> statement-breakpoint
CREATE INDEX "intake_consumption_feed_idx" ON "intake_consumption" USING btree ("first_feed_sig");--> statement-breakpoint
CREATE INDEX "keeper_jobs_due_idx" ON "keeper_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "keeper_jobs_signature_idx" ON "keeper_jobs" USING btree ("signature");--> statement-breakpoint
CREATE INDEX "pulls_address_idx" ON "pulls" USING btree ("address");--> statement-breakpoint
CREATE INDEX "pulls_buyer_idx" ON "pulls" USING btree ("buyer","seq");--> statement-breakpoint
CREATE INDEX "pulls_status_idx" ON "pulls" USING btree ("status","created_ts");--> statement-breakpoint
CREATE INDEX "pulls_reveal_idx" ON "pulls" USING btree ("revealed_slot","reveal_order");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_log_message_idx" ON "quote_log" USING btree ("message_sha256");--> statement-breakpoint
CREATE INDEX "quote_log_owner_idx" ON "quote_log" USING btree ("owner","created_at");--> statement-breakpoint
CREATE INDEX "royalties_depositor_idx" ON "royalties" USING btree ("depositor","seq");--> statement-breakpoint
CREATE INDEX "sell_backs_order_idx" ON "sell_backs" USING btree ("slot","tx_index","ix_index","event_index");--> statement-breakpoint
CREATE INDEX "sell_backs_owner_idx" ON "sell_backs" USING btree ("owner","slot");--> statement-breakpoint
CREATE INDEX "stock_plans_created_idx" ON "stock_plans" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_trades_signature_idx" ON "stock_trades" USING btree ("signature");--> statement-breakpoint
CREATE INDEX "stock_trades_plan_idx" ON "stock_trades" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "stock_trades_mint_idx" ON "stock_trades" USING btree ("mint","created_at");
--> statement-breakpoint
-- Drizzle does not model trigger definitions. These guards are part of migration 0000.
CREATE FUNCTION "reject_signer_log_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Signer logs are insert-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "attestation_log_insert_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "attestation_log"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_signer_log_mutation"();
--> statement-breakpoint
CREATE TRIGGER "quote_log_insert_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "quote_log"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_signer_log_mutation"();

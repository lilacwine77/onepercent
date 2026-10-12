import { createHash } from "node:crypto";
import {
  BLINKS,
  BLINKS_OPS,
  CARDS_PER_PACK,
  COVERAGE,
  PACK_EDITIONS,
  PAUSE_BITS,
} from "@onepercent/config";
import { referralCode, sol } from "@onepercent/copy";
import { PHASE } from "@onepercent/sdk/constants";
import { ConfigResponse, MachineResponse } from "@onepercent/sdk/api";
import { type JsonRpcClient, warnCause } from "@onepercent/service-kit";
import { PublicKey } from "@solana/web3.js";
import type { ActionGetResponse } from "@solana/actions-spec";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { joinDescription } from "./format.js";
import { RIP_COPY } from "./rip-copy.js";
import {
  ActionPostRequestSchema,
  ActionGetResponseSchema,
  TransactionResponseSchema,
} from "./spec.js";
import { buildRipTransaction, RipSimulationError } from "./rip-transaction.js";

export type RipState =
  | "off"
  | "beforeOnAir"
  | "seasonOver"
  | "paused"
  | "busy"
  | "hungry"
  | "refilling"
  | "covered";
export interface RipSnapshot {
  config: ConfigResponse;
  machine: MachineResponse | null;
  nowTs: number;
  asOfMs: number;
}
export interface RipDependencies {
  webOrigin: string;
  publicApiOrigin: string;
  cluster: ConfigResponse["cluster"];
  snapshot(options?: { fresh?: boolean }): Promise<RipSnapshot>;
  rpc: Pick<JsonRpcClient, "request">;
  limiter: {
    consume(
      key: string,
      rule: { limit: number; windowMs: number },
    ):
      | { ok: boolean; retryAfterS?: number }
      | Promise<{ ok: boolean; retryAfterS?: number }>;
  };
  clientIp(context: Context): string;
  clock(): number;
  onResult?(route: string, outcome: string, latencyMs: number): void;
}
export function ripState(
  snapshot: RipSnapshot,
  edition: number,
  qty = 1,
): RipState {
  const { config, machine, nowTs } = snapshot;
  if (!config.flags.BLINKS_RIP || !config.flags.PACKS) return "off";
  if (config.phase === null || config.phase < PHASE.onAir) return "beforeOnAir";
  if (
    config.phase === PHASE.onAir &&
    (config.season === null || config.paused === null)
  )
    throw new Error("rip_config_unavailable");
  if (
    config.phase > PHASE.onAir ||
    (config.season !== null && nowTs >= config.season.endTs)
  )
    return "seasonOver";
  if (((config.paused ?? 0) & PAUSE_BITS.rip) !== 0) return "paused";
  if (!machine) throw new Error("machine_unavailable");
  if (machine.vrf.busy) return "busy";
  if (machine.deck.free < CARDS_PER_PACK.dust * qty + COVERAGE.dustBuffer)
    return "hungry";
  if ((machine.coverage.maxQty[edition] ?? 0) < qty) return "refilling";
  return "covered";
}
export function ripStateMessage(
  state: Exclude<RipState, "covered">,
  snapshot: RipSnapshot,
  edition: number,
): string {
  if (state === "refilling")
    return RIP_COPY.refilling(edition, snapshot.machine);
  const value = RIP_COPY[state];
  return typeof value === "function" ? value() : value;
}
export function publicKey(value: string | undefined): PublicKey | undefined {
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return undefined;
  try {
    const key = new PublicKey(value);
    return key.toBase58() === value ? key : undefined;
  } catch (error) {
    warnCause("rip_account_invalid", error);
    return undefined;
  }
}
function validateSnapshot(input: RipSnapshot): RipSnapshot {
  return {
    config: ConfigResponse.parse(input.config),
    machine:
      input.machine === null ? null : MachineResponse.parse(input.machine),
    nowTs: z.number().int().safe().parse(input.nowTs),
    asOfMs: z.number().int().nonnegative().safe().parse(input.asOfMs),
  };
}
export function createRipService(deps: RipDependencies) {
  const snapshot = async (options?: { fresh?: boolean }) =>
    validateSnapshot(await deps.snapshot(options));
  return {
    snapshot,
    state: ripState,
    async get(
      editionIndex: number | null,
      ref?: string,
      supplied?: RipSnapshot,
    ): Promise<z.infer<typeof ActionGetResponseSchema>> {
      const current = supplied ?? (await snapshot());
      const edition =
        editionIndex === null ? null : PACK_EDITIONS[editionIndex]!;
      const states = PACK_EDITIONS.map((item) => ripState(current, item.index));
      const state = edition
        ? states[edition.index]!
        : states.includes("covered")
          ? "covered"
          : states[0]!;
      const iconPath = edition
        ? `/api/og/blink/rip/${edition.id}.png`
        : "/api/og/blink/rip.png";
      const icon = new URL(iconPath, deps.publicApiOrigin);
      icon.searchParams.set("m", String(Math.floor(current.asOfMs / 60_000)));
      const base: ActionGetResponse = {
        type: "action",
        icon: icon.href,
        title: edition
          ? RIP_COPY.title(edition.name, sol(edition.priceLamports))
          : RIP_COPY.genericTitle,
        description: joinDescription([
          ...(edition && state === "covered"
            ? [RIP_COPY.upTo(current.machine!.coverage.maxQty[edition.index]!)]
            : []),
          RIP_COPY.contents(CARDS_PER_PACK.dust, CARDS_PER_PACK.hit),
          RIP_COPY.verifiable,
        ]),
        label: RIP_COPY.label(1),
      };
      if (state !== "covered")
        return ActionGetResponseSchema.parse({
          ...base,
          disabled: true,
          error: {
            message: ripStateMessage(state, current, editionIndex ?? 0),
          },
        });
      // M5 §1.3: M1 exposes no live specials. M4 owns their SDK math and snapshot fields.
      const liveFlags = 0;
      const keptRef = referralCode(ref);
      const action = (index: number, n: number, generic: boolean) => {
        const item = PACK_EDITIONS[index]!;
        const query = new URLSearchParams({
          n: String(n),
          lf: String(liveFlags),
        });
        if (keptRef) query.set("ref", keptRef);
        return {
          type: "transaction" as const,
          label: generic ? RIP_COPY.edition(item.name) : RIP_COPY.label(n),
          href: `/api/actions/rip/${item.id}?${query}`,
        };
      };
      const actions = edition
        ? BLINKS.ripQuantities
            .filter(
              (n) =>
                n <= edition.maxPerRip &&
                n <= current.machine!.coverage.maxQty[edition.index]!,
            )
            .map((n) => action(edition.index, n, false))
        : PACK_EDITIONS.filter((item) => states[item.index] === "covered").map(
            (item) => action(item.index, 1, true),
          );
      return ActionGetResponseSchema.parse({ ...base, links: { actions } });
    },
  };
}
const countQuery = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().safe().nonnegative());

export function ripOutcome(context: Context): string | undefined {
  return context.get("ripOutcome");
}
export function setRipOutcome(context: Context, reason: string): void {
  context.set("ripOutcome", reason);
}
function failure(
  context: Context,
  status: 400 | 403 | 404 | 422 | 429 | 503,
  message: string,
  reason: string,
): Response {
  setRipOutcome(context, reason);
  return context.json({ message }, status);
}

// Valid account limits run before the shared IP limit, including behind proxies.
export async function limitRipAccount(
  context: Context,
  deps: RipDependencies,
): Promise<Response | undefined> {
  const parsed = ActionPostRequestSchema.safeParse(
    await context.req.json().catch((error) => {
      warnCause("rip_body_invalid", error);
      return null;
    }),
  );
  const account = parsed.success ? publicKey(parsed.data.account) : undefined;
  const n = countQuery.safeParse(context.req.query("n"));
  const lf = context.req.query("lf");
  let edition;
  try {
    const id = decodeURIComponent(context.req.path.split("/").at(-1)!);
    edition = PACK_EDITIONS.find((item) => item.id === id);
  } catch (error) {
    warnCause("rip_path_invalid", error);
    return;
  }
  if (
    !account ||
    !parsed.success ||
    !edition ||
    (parsed.data.type !== undefined && parsed.data.type !== "transaction") ||
    !n.success ||
    !BLINKS.ripQuantities.some((qty) => qty === n.data) ||
    n.data > edition.maxPerRip ||
    (lf !== undefined &&
      !countQuery.pipe(z.number().max(255)).safeParse(lf).success)
  )
    return;
  try {
    const hashed = createHash("sha256")
      .update(`account:${account.toBase58()}`)
      .digest("hex");
    const result = await deps.limiter.consume(`blink:rip:${hashed}`, {
      limit: BLINKS_OPS.ripPostPerMinutePerAccount,
      windowMs: 60_000,
    });
    if (!result.ok) {
      const seconds = Math.max(1, result.retryAfterS ?? 1);
      context.header("Retry-After", String(seconds));
      return failure(context, 429, RIP_COPY.limited(seconds), "account_limit");
    }
  } catch (error) {
    warnCause("rip_account_limit_unavailable", error);
    return failure(
      context,
      503,
      RIP_COPY.unavailable(),
      "account_limit_unavailable",
    );
  }
}

export function registerRip(
  app: Hono,
  deps: RipDependencies,
  service = createRipService(deps),
): void {
  const editionFrom = (context: Context) => {
    const id = context.req.param("edition") ?? context.req.query("edition");
    return id === undefined
      ? null
      : PACK_EDITIONS.find((item) => item.id === id)?.index;
  };
  const get = async (context: Context) => {
    context.header(
      "Cache-Control",
      `public, max-age=${BLINKS.liveNumbersMaxAgeSeconds}`,
    );
    const edition = editionFrom(context);
    if (edition === undefined)
      return failure(context, 404, RIP_COPY.notFound(), "unknown_edition");
    try {
      return context.json(await service.get(edition, context.req.query("ref")));
    } catch (error) {
      warnCause("rip_snapshot_unavailable", error);
      context.header("Cache-Control", "no-store");
      return failure(
        context,
        503,
        RIP_COPY.unavailable(),
        "snapshot_unavailable",
      );
    }
  };
  const post = async (context: Context) => {
    context.header("Cache-Control", "no-store");
    const editionIndex = editionFrom(context);
    if (editionIndex === undefined)
      return failure(context, 404, RIP_COPY.notFound(), "unknown_edition");
    if (context.req.path === "/api/actions/rip" || editionIndex === null)
      return failure(context, 400, RIP_COPY.badRequest, "generic_post");
    const input: unknown = await context.req.json().catch((error) => {
      warnCause("rip_body_invalid", error);
      return null;
    });
    const parsed = ActionPostRequestSchema.safeParse(input);
    if (
      input !== null &&
      typeof input === "object" &&
      "type" in input &&
      input.type !== undefined &&
      input.type !== "transaction"
    )
      return failure(context, 400, RIP_COPY.badRequest, "invalid_type");
    const account = parsed.success ? publicKey(parsed.data.account) : undefined;
    if (!account)
      return failure(
        context,
        400,
        RIP_COPY.invalidAddress(),
        "invalid_account",
      );
    const n = countQuery.safeParse(context.req.query("n"));
    const lfInput = context.req.query("lf");
    const lf =
      lfInput === undefined
        ? undefined
        : countQuery.pipe(z.number().max(255)).safeParse(lfInput);
    const edition = PACK_EDITIONS[editionIndex]!;
    if (
      !n.success ||
      !BLINKS.ripQuantities.some((qty) => qty === n.data) ||
      n.data > edition.maxPerRip ||
      (lf !== undefined && !lf.success)
    )
      return failure(context, 400, RIP_COPY.badRequest, "invalid_parameters");
    let reason = "snapshot_unavailable";
    try {
      const current = await service.snapshot({ fresh: true });
      const state = ripState(current, editionIndex, n.data);
      if (state !== "covered") {
        const max = current.machine?.coverage.maxQty[editionIndex] ?? 0;
        const message =
          state === "refilling" && max > 0
            ? RIP_COPY.upTo(max)
            : ripStateMessage(state, current, editionIndex);
        return failure(
          context,
          ["off", "beforeOnAir", "seasonOver", "paused"].includes(state)
            ? 403
            : 422,
          message,
          `state_${state}`,
        );
      }
      reason = "transaction_unavailable";
      const transaction = await buildRipTransaction(deps.rpc, current, {
        account,
        edition: editionIndex,
        qty: n.data,
        minLiveFlags: lf?.success ? lf.data : 0,
        ref: context.req.query("ref"),
      });
      return context.json(
        TransactionResponseSchema.parse({
          type: "transaction",
          transaction,
          message: RIP_COPY.done(new URL(deps.webOrigin).host),
        }),
      );
    } catch (error) {
      warnCause("rip_request_failed", error);
      if (error instanceof RipSimulationError)
        return failure(context, 422, error.message, "simulation_failed");
      return failure(context, 503, RIP_COPY.unavailable(), reason);
    }
  };
  const track =
    (route: string, handler: (context: Context) => Promise<Response>) =>
    async (context: Context) => {
      const started = deps.clock();
      const result = await handler(context);
      deps.onResult?.(
        route,
        context.get("ripOutcome") ?? "ok",
        Math.max(0, deps.clock() - started),
      );
      return result;
    };
  app.get("/api/actions/rip", track("rip", get));
  app.get("/api/actions/rip/:edition", track("rip-edition", get));
  app.post("/api/actions/rip", track("rip", post));
  app.post("/api/actions/rip/:edition", track("rip-edition", post));
}

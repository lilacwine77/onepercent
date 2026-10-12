import { ConfigResponse as PublishedConfig } from "@onepercent/sdk/api";
import { ConfigResponse, Phase } from "@onepercent/web-api";
import { z } from "zod";
import { ApiError } from "./api";

/** S4 is authoritative; retain the typed D19 fixture shape during migration. */
export function decodeMachineConfig(body: unknown) {
  const parsed = z.union([PublishedConfig, ConfigResponse]).safeParse(body);
  if (!parsed.success) throw new ApiError("invalid_response");
  const value = parsed.data;
  return {
    ...value,
    cluster:
      value.cluster === "mainnet-beta" ? ("mainnet" as const) : value.cluster,
    phase:
      typeof value.phase === "number"
        ? (Phase.options[value.phase] ?? null)
        : value.phase,
  };
}

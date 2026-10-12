import { WEB } from "@onepercent/config/web";
import { WebConfigResponse } from "@onepercent/web-api";
import { z } from "zod";
import { api, ApiError } from "./api";
import { HTTP } from "./http-status";
import { resource, useResource } from "./resource";
// S4 owns the wire contract. Load its decoder outside the shell entry.
export async function loadMachineConfig(signal?: AbortSignal) {
  try {
    // A missing machine must not wait for the optional live SDK chunk to load.
    const body = await api("/api/config", z.unknown(), { signal });
    return (await import("./machine-config")).decodeMachineConfig(body);
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === HTTP.notFound ||
        (error.status === HTTP.unavailable && error.code === "not_configured"))
    )
      return null;
    throw error;
  }
}
export const configResource = resource(
  "/api/config",
  loadMachineConfig,
  WEB.configRefreshMs,
);
export const webConfigResource = resource(
  "/api/web/config",
  (signal) => api("/api/web/config", WebConfigResponse, { signal }),
  WEB.configRefreshMs,
);
export const useConfig = () => useResource(configResource);
export const useWebConfig = () => useResource(webConfigResource);

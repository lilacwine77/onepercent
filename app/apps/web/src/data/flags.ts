import { useConfig, useWebConfig } from "./config";
export type Flag =
  | "XRAY"
  | "FEED"
  | "PACKS"
  | "SELL_BACK"
  | "HOLDER_BOOST"
  | "TV_LIVE"
  | "BOARDS"
  | "SOUND";
export function flagEnabled(
  config: { data?: { flags: Record<string, boolean> } | null; error?: unknown },
  flag: Flag,
): boolean {
  return !config.error && config.data?.flags[flag] === true;
}
export function useFlag(flag: Flag) {
  const machine = useConfig();
  const web = useWebConfig();
  return flagEnabled(flag === "XRAY" ? web : machine, flag);
}

import type { ActionsJson } from "@solana/actions-spec";
export const ACTIONS_JSON = {
  rules: [
    { pathPattern: "/x/*", apiPath: "/api/actions/xray/*" },
    { pathPattern: "/rip", apiPath: "/api/actions/rip" },
    { pathPattern: "/packs", apiPath: "/api/actions/rip" },
    { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
  ],
} satisfies ActionsJson;

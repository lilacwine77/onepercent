import type { CopyKey } from "@onepercent/copy/initial";
export const routes = {
  home: { path: "/", title: "title.home" },
  xray: { path: "/x", title: "title.xray" },
  feed: { path: "/feed", title: "title.feed" },
  rip: { path: "/rip", title: "title.rip" },
  cards: { path: "/cards", title: "title.cards" },
  verify: { path: "/verify", title: "title.verify" },
  fairness: { path: "/fairness", title: "title.fairness" },
  live: { path: "/live", title: "title.live" },
  token: { path: "/token", title: "title.token" },
  docs: { path: "/docs", title: "title.docs" },
  go: { path: "/go", title: "title.home" },
  link: { path: "/link", title: "title.home" },
  notFound: { path: "", title: "title.notFound" },
} as const satisfies Record<string, { path: string; title: CopyKey }>;
export type RouteId = keyof typeof routes;
export interface RouteMatch {
  route: RouteId | "experience";
  params: Record<string, string>;
  alias?: string;
}

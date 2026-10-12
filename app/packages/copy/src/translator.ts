import type { en } from "./en.js";

type ConcreteKey = keyof typeof en;
type PluralKey = {
  [K in ConcreteKey]: K extends `${infer Base}.one` ? Base : never;
}[ConcreteKey];
export type CopyKey = ConcreteKey | PluralKey;
type Placeholders<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never;
type TextFor<K extends CopyKey> = K extends ConcreteKey
  ? (typeof en)[K]
  : K extends PluralKey
    ? (typeof en)[`${K}.one`] | (typeof en)[`${K}.other`]
    : never;
export type CopyVars<K extends CopyKey> = Record<
  Placeholders<TextFor<K>> | (K extends PluralKey ? "n" : never),
  string
>;
export type Args<K extends CopyKey> = keyof CopyVars<K> extends never
  ? [vars?: CopyVars<K>]
  : [vars: CopyVars<K>];

/** Numbers arrive preformatted; this map is also audited by the parity test. */
export const placeholderFormatters = {
  sol: "sol/solCost/solExact/depositCost/ripTotal",
  min: "sol/solCost",
  max: "sol/solCost",
  each: "sol/solCost/packPrice",
  rent: "sol",
  deposit: "sol/solCost",
  deposits: "solCost",
  value: "sol",
  net: "solSigned",
  pct: "pct",
  n: "count",
  d: "count",
  e: "count",
  ok: "count",
  t: "count",
  c: "count",
  cap: "count",
  limit: "count",
  deck: "count",
  pulls: "count",
  s: "count",
  seq: "countUngrouped",
  who: "short",
  short: "short",
  ticker: "ticker",
  amount: "amount",
  date: "dateUtc",
  time: "timeUtc",
  program: "base58/short",
  cluster: "cluster",
  bags: "count.bags",
  transactions: "count.transactions",
  approvals: "count.approvals",
  cards: "count.cards",
  accounts: "count.newTokenAccounts",
  segments: "copy",
  title: "copy",
  condition: "copy",
  edition: "PACK_EDITIONS.name",
  mode: "copy",
  name: "copy",
  mult: "mult",
} as const;

export interface TranslatorOptions {
  production?: boolean;
  reportMissing?: (key: CopyKey) => void;
}

export type Translator<Keys extends CopyKey = CopyKey> = <K extends Keys>(
  key: K,
  ...args: Args<K>
) => string;

export function createCatalogTranslator(
  catalog: Partial<Record<ConcreteKey, string>>,
  {
    production = false,
    reportMissing = (key) => console.error(`Missing copy variables: ${key}`),
  }: TranslatorOptions = {},
): Translator {
  const reported = new Set<CopyKey>();
  return function translate<K extends CopyKey>(
    key: K,
    ...args: Args<K>
  ): string {
    const vars = args[0] as Record<string, string> | undefined;
    const plural = `${key}.one` in catalog;
    const resolved = (
      plural ? `${key}.${vars?.n === "1" ? "one" : "other"}` : key
    ) as ConcreteKey;
    const template = catalog[resolved];
    const missing =
      !template ||
      (plural && typeof vars?.n !== "string") ||
      [...template.matchAll(/\{([^}]+)\}/g)].some(
        (match) => typeof vars?.[match[1]!] !== "string",
      );
    if (missing) {
      if (!production) throw new Error(`Missing copy variables: ${key}`);
      if (!reported.has(key)) {
        reported.add(key);
        reportMissing(key);
      }
      return key;
    }
    return template.replace(
      /\{([^}]+)\}/g,
      (_match, name: string) => vars![name]!,
    );
  };
}

export const productionOptions = {
  production:
    (import.meta as ImportMeta & { env?: { PROD: boolean } }).env?.PROD ===
      true ||
    (typeof process !== "undefined" && process.env.NODE_ENV === "production"),
};

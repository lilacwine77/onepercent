import { readFileSync } from "node:fs";
export function vectors<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/vectors/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
export function decimalJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}

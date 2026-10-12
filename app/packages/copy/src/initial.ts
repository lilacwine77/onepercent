import { initial } from "./catalog-initial.js";
import {
  createCatalogTranslator,
  productionOptions,
  type Translator,
} from "./translator.js";
export type { CopyVars } from "./translator.js";
export * from "./format.js";
export { initial as en } from "./catalog-initial.js";
type ConcreteKey = keyof typeof initial;
export type CopyKey =
  | ConcreteKey
  | {
      [K in ConcreteKey]: K extends `${infer Base}.one` ? Base : never;
    }[ConcreteKey];
/** Shell, home and X-ray only. Route copy travels with lazy route chunks. */
export const t: Translator<CopyKey> = createCatalogTranslator(
  initial,
  productionOptions,
);

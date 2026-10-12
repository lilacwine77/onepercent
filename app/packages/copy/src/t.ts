import { en } from "./en.js";
import {
  createCatalogTranslator,
  productionOptions,
  type TranslatorOptions,
  type Translator,
} from "./translator.js";
export { placeholderFormatters } from "./translator.js";
export type { CopyKey, CopyVars, TranslatorOptions } from "./translator.js";
export const createTranslator = (options: TranslatorOptions = {}): Translator =>
  createCatalogTranslator(en, options);
export const t: Translator = createTranslator(productionOptions);

// Browser entry: constants only, with no validation or service configuration.
export {
  CARDS_PER_PACK,
  HIT_TIERS,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  SELL_BACK,
  TOKEN_1PCT,
  WEB,
  MILLISECONDS_PER_MINUTE,
} from "./constants.js";
export type { EditionId } from "./constants.js";

// Feed background reads reserve the rest of the proxy quota for exits and other readers.
export const FEED_BACKGROUND_RPC_SHARE = 0.25;

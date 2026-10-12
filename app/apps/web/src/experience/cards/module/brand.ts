/* eslint-disable */
// Synced from experience/cards-lab/src/cards/brand.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Visual identity per card kind and edition (da-direction.md §4.1, §7). Names are copy keys;
 * multipliers mirror `HIT_TIERS[].valueBps` (PARAMS §3.1) and are shown, never used in a computation.
 */
import type { CardKind, EditionId } from "./types";

export interface KindInfo {
  /** Copy key of the name ("Holo Foil"). */
  name: string;
  /** "4×" (display only), or '' for specials. */
  mult: string;
  /** Foil texture in assets/foil/, or null (paper / pearl faces). */
  foil: "silver" | "blue" | "holo" | "black" | "gold" | null;
  /** Rank for "Tier" sort and the All order (higher first). */
  rank: number;
  /** A hit (kinds 1–4) or a special (5–8). */
  hit: boolean;
}

export const KINDS: Record<CardKind, KindInfo> = {
  dust: { name: "cards.kind.dust", mult: "", foil: null, rank: 0, hit: false },
  silver: {
    name: "cards.kind.silver",
    mult: "0.5×",
    foil: "silver",
    rank: 2,
    hit: true,
  },
  blue: {
    name: "cards.kind.blue",
    mult: "1.5×",
    foil: "blue",
    rank: 3,
    hit: true,
  },
  holo: {
    name: "cards.kind.holo",
    mult: "4×",
    foil: "holo",
    rank: 4,
    hit: true,
  },
  black: {
    name: "cards.kind.black",
    mult: "15×",
    foil: "black",
    rank: 5,
    hit: true,
  },
  jackpot: {
    name: "cards.kind.jackpot",
    mult: "",
    foil: "gold",
    rank: 7,
    hit: true,
  },
  one_pct: {
    name: "cards.kind.one_pct",
    mult: "",
    foil: null,
    rank: 8,
    hit: true,
  },
  spotlight: {
    name: "cards.kind.spotlight",
    mult: "",
    foil: null,
    rank: 1,
    hit: false,
  },
  final: {
    name: "cards.kind.final",
    mult: "",
    foil: "black",
    rank: 6,
    hit: true,
  },
};

/** Kinds the machine buys back (Sell, the `sell_back` instruction, PARAMS §3.3). Gates say whether Sell is open now. */
export const SELL_BACK_KINDS: CardKind[] = ["silver", "blue", "holo", "black"];

/** `PACK_EDITIONS[].name` (PARAMS §2.1), mirrored from config. */
export const EDITIONS: Record<EditionId, { name: string; edge: string }> = {
  original: { name: "The Original", edge: "#b9bdc6" },
  blue_shift: { name: "Blue Shift", edge: "#1340c8" },
  signature: { name: "Signature", edge: "#c9a2ee" },
  after_hours: { name: "After Hours", edge: "#1a1a1d" },
};

/** Static files the module loads from `assetsBase`, only when a card needs them. */
export const CARDS_ASSET_FILES = [
  "foil/silver.webp",
  "foil/blue.webp",
  "foil/holo.webp",
  "foil/black.webp",
  "foil/gold.webp",
  "packs/original.webp",
  "packs/blue_shift.webp",
  "packs/signature.webp",
  "packs/after_hours.webp",
  "pepe-white.webp",
] as const;

/** The $1PCT coin shows the "1%" mark instead of a logo. */
export const isOnePctMint = (ticker: string) => /^\$?1PCT$/i.test(ticker);

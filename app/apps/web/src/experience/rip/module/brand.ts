/* eslint-disable */
// Synced from experience/lab/src/rip/brand.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import type { Edition, HitTier } from "./types";

/** Tokens from da-direction.md §4.1. */
export const C = {
  cream: "#fff1e7",
  ink: "#26062e",
  lilac: "#d5a2f1",
  plum: "#2c1235",
  mauve: "#773e83",
  orchid: "#4c2459",
  blush: "#efddee",
  paper: "#fff9ee",
  paperEdge: "#f1dfd5",
  xrayDeep: "#120d30",
  xrayMid: "#243969",
  xrayCyan: "#94f5ed",
  xrayRim: "#92ebf0",
  xrayGlint: "#efffff",
  xrayScan: "#b3fbff",
  goldHi: "#f6d272",
  gold: "#d9a441",
  goldLo: "#a8701f",
  goldInk: "#3a2208",
  silverHi: "#fcfcfc",
  silver: "#c9ccd2",
  silverLo: "#545454",
  blueDeep: "#0b1d5e",
  blue: "#1340c8",
  blueGlint: "#3fe6ff",
  anthracite: "#0e0e10",
  graphite: "#3c3c3c",
} as const;

/** Iridescence palette shared with pack-foil.css. */
export const IRIDESCENCE = [
  "#a8e7ff",
  "#e4c3ff",
  "#ffbfd9",
  "#ffe5a4",
  "#c7ffe9",
] as const;

export interface EditionInfo {
  id: Edition;
  name: string;
  finish: string;
  /** Pack art in assetsBase. */
  image: string;
  /** Pack price label, display only (MODEL §2). */
  priceSol: string;
  /** Tear line under the crimp, in source pixels of the 1254 px artwork: [x0, y0, x1, y1]. */
  tear: [number, number, number, number];
  /** Physical edge colour of the Dust Cards from this edition. */
  edge: string;
  edgeMetal: number;
  /** Tint of the torn foil flakes. */
  flake: string;
}

export const EDITIONS: Record<Edition, EditionInfo> = {
  original: {
    id: "original",
    name: "The Original",
    finish: "Polished silver × gold",
    image: "pack-silver-hq.webp",
    priceSol: "0.1",
    tear: [235, 64, 1095, 132],
    edge: "#c9ccd2",
    edgeMetal: 0.9,
    flake: "#eef0f6",
  },
  blue_shift: {
    id: "blue_shift",
    name: "Blue Shift",
    finish: "Electric blue × gold",
    image: "pack-first-light-hq.webp",
    priceSol: "0.25",
    tear: [215, 90, 1085, 94],
    edge: "#1340c8",
    edgeMetal: 0.75,
    flake: "#7fa8ff",
  },
  signature: {
    id: "signature",
    name: "Signature",
    finish: "Holographic foil × gold",
    image: "pack-closed-hq.webp",
    priceSol: "0.5",
    tear: [235, 68, 1090, 126],
    edge: "#e4c3ff",
    edgeMetal: 0.6,
    flake: "#f3e6ff",
  },
  after_hours: {
    id: "after_hours",
    name: "After Hours",
    finish: "Black anthracite × gold",
    image: "pack-anthracite-hq.webp",
    priceSol: "1",
    tear: [225, 82, 1060, 88],
    edge: "#1a1a1d",
    edgeMetal: 0.7,
    flake: "#f6d272",
  },
};

export interface TierInfo {
  id: HitTier;
  /** Label strip text (DM Sans 700 capitals). */
  label: string;
  /** Spoken / announced name. */
  name: string;
  /** Multiplier mark, or '' for Jackpot / The 1%. */
  mult: string;
  /** Pack art used as the foil crop of the card face. */
  foil: string;
  edge: string;
  edgeMetal: number;
  /** How long the tier effect lasts after the flip (DA §8.2). */
  effectMs: number;
  /** Holo strength of the face shader. */
  holo: number;
}

export const TIERS: Record<HitTier, TierInfo> = {
  silver: {
    id: "silver",
    label: "SILVER FOIL",
    name: "Silver Foil",
    mult: "0.5×",
    foil: "pack-silver-hq.webp",
    edge: "#d7dae0",
    edgeMetal: 1,
    effectMs: 700,
    holo: 0.08,
  },
  blue: {
    id: "blue",
    label: "BLUE FOIL",
    name: "Blue Foil",
    mult: "1.5×",
    foil: "pack-first-light-hq.webp",
    edge: "#1f4fe0",
    edgeMetal: 0.9,
    effectMs: 900,
    holo: 0.22,
  },
  holo: {
    id: "holo",
    label: "HOLO FOIL",
    name: "Holo Foil",
    mult: "4×",
    foil: "pack-closed-hq.webp",
    edge: "#e9d2ff",
    edgeMetal: 0.8,
    effectMs: 1200,
    holo: 1,
  },
  black: {
    id: "black",
    label: "BLACK FOIL",
    name: "Black Foil",
    mult: "15×",
    foil: "pack-anthracite-hq.webp",
    edge: "#d9a441",
    edgeMetal: 1,
    effectMs: 1800,
    holo: 0.05,
  },
  jackpot: {
    id: "jackpot",
    label: "JACKPOT",
    name: "Jackpot",
    mult: "",
    foil: "pack-anthracite-hq.webp",
    edge: "#e2b04c",
    edgeMetal: 1,
    effectMs: 3200,
    holo: 0.12,
  },
  one_pct: {
    id: "one_pct",
    label: "THE 1%",
    name: "The 1%",
    mult: "",
    foil: "pack-closed-hq.webp",
    edge: "#f4ecff",
    edgeMetal: 0.7,
    effectMs: 4500,
    holo: 0.9,
  },
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

/** Groups numbers with en-US separators; strings are shown verbatim. */
export function fmtAmount(v: number | string): string {
  if (typeof v === "number") return Number.isFinite(v) ? nf.format(v) : "n/a";
  return v;
}

/** A pending quote (null / undefined / empty) renders as an em dash, never "≈ n/a SOL". */
export const quotePending = (v: unknown) =>
  v === null || v === undefined || v === "";

export function fmtSol(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "n/a";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "n/a";
    const digits = v >= 100 ? 1 : v >= 1 ? 2 : v >= 0.01 ? 2 : 4;
    return v.toLocaleString("en-US", {
      minimumFractionDigits: Math.min(2, digits),
      maximumFractionDigits: digits,
    });
  }
  return v;
}

export function ticker(symbol: string): string {
  const s = symbol.trim();
  return s.startsWith("$") ? s : `$${s}`;
}

/** 4+4 wallet address form ("7xKp…d2Qa") used on card strips, the CRT and tickers (DECISIONS D9: wallet addresses only, no `.sol` names). */
export function shortAddress(a: string): string {
  const s = a.trim();
  if (s.length <= 11) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

import { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS } from "@onepercent/config";

// External addresses: pump-public-docs 2293f9a6, M4 brief §4.2.
export const PUMP_PROGRAM_ID = new PublicKey(PROGRAM_IDS.pumpFun);
export const PUMP_AMM_PROGRAM_ID = new PublicKey(PROGRAM_IDS.pumpSwap);
export const PUMP_FEE_PROGRAM_ID = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
);
export const MAYHEM_PROGRAM_ID = new PublicKey(
  "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e",
);
export const PUMP_GLOBAL = new PublicKey(
  "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
);
export const PUMP_AMM_GLOBAL = new PublicKey(
  "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw",
);
export const PUMP_FEE_CONFIG = new PublicKey(
  "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt",
);
export const PUMP_DISCRIMINATORS = {
  createV2: "d6904cec5f8b31b4",
  buyV3: "07051dc4f5176550",
  curveCollectStep: "20f6bf3408c949ba",
  poolCollectStep: "20f6bf3408c949ba",
  transferCreatorFeesToPump: "8b348655e4e56cf1",
  collectCreatorFeeV2: "cf118af204221338",
  collectCoinCreatorFee: "a039592ab58b2b42",
  bondingCurve: "17b7f83760d8ac60",
  pool: "f19a6d0411b16dbc",
} as const;
export const PUMP_METADATA_LIMITS = { name: 32, symbol: 13, uri: 200 } as const;

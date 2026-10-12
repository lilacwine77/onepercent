import { StreamEvent } from "@onepercent/sdk/api";
import { publicKey, signature } from "./responses.js";

export function feedEvent(id = "1-0-0", amount = "1", sig = signature) {
  return StreamEvent.parse({
    id,
    event: "feed",
    data: {
      name: "BagFed",
      signature: sig,
      asOfSlot: id.split("-")[0],
      depositor: publicKey,
      mint: publicKey,
      amount,
      deck_index: 0,
      deposit: "0",
      fresh_in_deck: 1,
    },
  });
}
export function settleEvent(id = "1-0-0", seq = "1", sig = signature) {
  return StreamEvent.parse({
    id,
    event: "settle",
    data: {
      name: "PackSettled",
      signature: sig,
      asOfSlot: id.split("-")[0],
      pull: publicKey,
      seq,
      pack: 0,
      paid: ["0", "0", "0", "0"],
      redirected_mask: 0,
      referral_paid: "0",
      referral_to_team: "0",
    },
  });
}
export function revealEvent(id = "1-0-0", seq = "1", sig = signature) {
  return StreamEvent.parse({
    id,
    event: "reveal",
    data: {
      name: "PackRevealed",
      signature: sig,
      asOfSlot: id.split("-")[0],
      seq,
      pack: 0,
      edition: 0,
      live_flags: 0,
      holder: false,
      t: 0,
      widths: [0, 0, 0, 0, 0, 0],
      tier: 1,
      hit_bucket: 0,
      house_mask: 0,
      hit_mint: publicKey,
      hit_amount: "18446744073709551615",
      hit_value: "0",
      dust: Array.from({ length: 4 }, () => ({
        deck_len_before: 1,
        index: 0,
        moved_from: 0,
        mint: publicKey,
        amount: "0",
        depositor: publicKey,
        refund: "0",
      })),
    },
  });
}

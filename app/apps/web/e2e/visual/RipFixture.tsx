import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id";
/** Local screenshot fixture only. Amounts below are display examples, never chain evidence. */
import { Suspense } from "react";
import { ACCOUNT_SIZES, PACK_EDITIONS, VRF } from "@onepercent/config";

import { ripPreview } from "../../src/adapters/rip-preview";
import RipView, { type RipViewProps } from "../../src/experience/rip/RipView";
import { type RipResult } from "../../src/experience/rip/module/types";
import { decodeImage } from "../../src/app/decode-image";
import { machinePoster } from "../../src/experience/shapes/Shapes";

export const ready = () => decodeImage(machinePoster("/experience/rip/"));
const result = (): RipResult => ({
  dust: Array.from({ length: 4 }, () => ({
    house: true,
    symbol: "1%",
    amountUi: "0",
    logoUrl: "",
    fedBy: "",
    actions: [],
  })),
  hit: {
    tier: "silver",
    symbol: "$BONK",
    amountUi: "42,000",
    logoUrl: "",
    valueSolUi: null,
    actions: ["my_cards"],
  },
});
const props: RipViewProps = {
  edition: "original",
  quantity: 5,
  available: true,
  balanceUi: "2.50",
  soundOn: false,
  reducedMotion: true,
  maxQty: (edition) =>
    PACK_EDITIONS.find((item) => item.id === edition)!.maxPerRip,
  gate: () => ({ open: true, reason: null }),
  onQty: () => {},
  onEdition: () => {},
  onPrepare: async (edition, quantity) => {
    const price = PACK_EDITIONS.find(
      (item) => item.id === edition,
    )!.priceLamports;
    const fixtureRent = (size: number) => BigInt(1000 + size);
    const pullDeposit = fixtureRent(
      ACCOUNT_SIZES.pullHeader + ACCOUNT_SIZES.pullPerPack * quantity,
    );
    const binder = fixtureRent(ACCOUNT_SIZES.binderHeader);
    const slots =
      fixtureRent(
        ACCOUNT_SIZES.binderHeader + ACCOUNT_SIZES.cardSlot * 5 * quantity,
      ) - binder;
    const fee = 5000n;
    return {
      ...ripPreview({
        quantity,
        priceEach: price,
        costs: {
          price: price * BigInt(quantity),
          drawFee: VRF.feeLamports,
          pullDeposit,
          binderDeposit: binder + slots,
          binderHeader: binder,
          cardSlots: slots,
        },
        networkFee: fee,
        program: PROGRAM_ID.toBase58(),
      }),
      pullId: "visual-only",
    };
  },
  onRip: async (_edition, quantity) => ({
    pullId: "visual-only",
    result: result(),
    results: Array.from({ length: quantity }, result),
  }),
  onAction: async () => ({}),
  onMyCards: () => {},
  onShare: () => {},
  onVerify: () => {},
};
export default function RipFixture() {
  return (
    <Suspense fallback={null}>
      <RipView {...props} />
    </Suspense>
  );
}

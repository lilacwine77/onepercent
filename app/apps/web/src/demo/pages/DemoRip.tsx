/** PREVIEW builds only: the Rip stage on the demo store (a pack price leaves, five cards land). */
import { useRef } from "react";
import { PACK_EDITIONS } from "@onepercent/config/web";
import { sol, solCost, t } from "@onepercent/copy";
import { ExperienceSlot } from "../../bridge/ExperienceSlot";
import { preloadModule } from "../../app/lazy-module";
import { decodeImage } from "../../app/decode-image";
import {
  RipShape,
  loadRip,
  machinePoster,
  type RipResult,
  type RipViewProps,
} from "../../experience/index";
import { motionPref, soundPref, useStore } from "../../app/prefs";
import { navigate } from "../../routes/router";
import {
  NETWORK_FEE,
  canRip,
  demo,
  rip,
  sellBack,
  type DemoCard,
  type EditionId,
} from "../store";
import { formatUi, sleep, useDemo, useDemoWallet } from "./shared";

const editionOf = (value: string | null): EditionId =>
  (PACK_EDITIONS.find((e) => e.id === value)?.id ?? "original") as EditionId;

/** The Rip stage's chunk, preloaded by the route (1% transition, router.ts). */
export const ready = () =>
  Promise.all([
    preloadModule(loadRip),
    decodeImage(machinePoster("/experience/rip/")),
  ]);

export default function DemoRip() {
  useDemoWallet();
  const state = useDemo();
  const pull = useRef<{ seq: string; cards: DemoCard[] } | null>(null);
  const initial = editionOf(
    new URLSearchParams(window.location.search).get("edition"),
  );
  const props: RipViewProps = {
    edition: initial,
    balanceUi: sol(state.lamports),
    soundOn: useStore(soundPref),
    reducedMotion: useStore(motionPref),
    gate: (edition) => {
      if (canRip(edition)) return { open: true, reason: null };
      const price = PACK_EDITIONS.find((e) => e.id === edition)!.priceLamports;
      return {
        open: false,
        reason: t("errors.insufficientSol", {
          sol: solCost(price + NETWORK_FEE - demo.get().lamports),
        }),
      };
    },
    onRip: async (edition) => {
      const drawn = rip(edition);
      pull.current = { seq: drawn.seq, cards: [...drawn.dust, drawn.hit] };
      await sleep(1100 + Math.random() * 500);
      const hit = drawn.hit;
      const result: RipResult = {
        dust: drawn.dust.map((card) => ({
          symbol: card.symbol,
          amountUi: formatUi(card.amountUi),
          logoUrl: card.logo ?? "",
          fedBy: card.fedBy ?? "",
          valueSolUi: sol(card.valueLamports),
        })),
        hit: {
          tier: drawn.tier,
          symbol: hit.symbol,
          amountUi: formatUi(hit.amountUi),
          logoUrl: hit.logo ?? "",
          valueSolUi: sol(hit.valueLamports),
          ...(hit.sellBackLamports
            ? { sellBackSolUi: sol(hit.sellBackLamports) }
            : {}),
        },
      };
      return { pullId: `demo-pull-${drawn.seq}`, result };
    },
    // The end screen offers a hit two choices: Sell (the machine buys it now)
    // and Go to My cards; Dust Cards land in My cards.
    onAction: async (index) => {
      const card = pull.current?.cards[index];
      await sleep(750);
      if (!card) return {};
      return { solUi: sol(sellBack([card.cardId])) };
    },
    onMyCards: (index) => {
      const card = pull.current?.cards[index];
      navigate(
        card ? `/cards?card=${encodeURIComponent(card.cardId)}` : "/cards",
      );
    },
    onShare: (text) => {
      if (navigator.share)
        void navigator.share({ text }).catch(() => undefined);
      else void navigator.clipboard?.writeText(text).catch(() => undefined);
    },
    onVerify: () => {
      if (pull.current) navigate(`/verify/${pull.current.seq}`);
    },
    onEdition: (edition) =>
      window.history.replaceState(null, "", `/rip?edition=${edition}`),
  };
  return (
    <ExperienceSlot
      component="rip"
      load={loadRip}
      props={props}
      poster={<RipShape assets="/experience/rip/" />}
      placeholder={null}
    />
  );
}

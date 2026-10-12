import { useEffect, useLayoutEffect, useRef } from "react";
import { t, type CopyKey, type CopyVars } from "@onepercent/copy";
import type { Progress } from "../../tx/engine/progress";
import {
  cardsAssets,
  mountCards,
  type ActionInfo,
  type ActionPreview,
  type CardsAction,
  type CardsController,
  type CardsData,
  type Msg,
} from "./module/index";
import { playCue, unlockAudio } from "../rip/sound";
import "./cards.css";

export interface CardsViewProps {
  data: CardsData;
  soundOn: boolean;
  reducedMotion: boolean;
  /** A card to bring into view and light (the Rip end's "Go to My cards", `/cards?card=`). */
  highlight?: string | null;
  /** Pre-sign summary for an action on these cards (03-M3 §13). */
  onPreview(action: CardsAction, ids: string[]): Promise<ActionPreview | null>;
  /**
   * Signs and sends the action. Resolves once it landed (with what reached the
   * wallet); rejects with a copy message when it did not.
   */
  onAction(
    action: CardsAction,
    ids: string[],
    progress?: (state: Progress) => void,
  ): Promise<ActionInfo>;
  onRip(): void;
  onVerify(seq: string): void;
  onRefresh(): void;
}

const SOUND: Record<string, Parameters<typeof playCue>[0]> = {
  "coin.pop": "coin.pop",
  "slot.drop": "slot.drop",
  "crank.turn": "crank.turn",
  "token.stream": "tokens.flow",
  "card.lift": "card.slide",
  "card.settle": "card.keep",
  select: "card.flip",
};

/**
 * My cards: mounts the inventory module and runs each action's signing states. Each card offers at
 * most two actions (hits Sell or Redeem, Dust Cards Feed back or Redeem, specials Redeem); the bulk
 * bar acts on every card at once; "Rip again" opens Packs.
 */
export default function CardsView(props: CardsViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<CardsController | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useLayoutEffect(() => {
    const container = host.current;
    if (!container) return;
    const header = () =>
      document.querySelector(".app-header")?.getBoundingClientRect().height ??
      0;
    const cards = mountCards(container, {
      ...cardsAssets("/experience/cards/"),
      data: latest.current.data,
      t: (key, vars) => t(key as CopyKey, (vars ?? {}) as CopyVars<CopyKey>),
      reducedMotion: latest.current.reducedMotion || undefined,
      headingLevel: 1,
      insets: { top: header() },
      onSound: ({ cue, index }) => {
        const mapped = SOUND[cue];
        if (latest.current.soundOn && mapped) playCue(mapped, index ?? 0);
      },
    });
    controller.current = cards;
    const resize = () => cards.setInsets({ top: header() });
    window.addEventListener("resize", resize);
    const offs = [
      cards.on("preview", async ({ action, ids }) => {
        const preview = await latest.current.onPreview(action, ids);
        cards.setPreview(action, ids, preview);
      }),
      cards.on("action", async ({ action, ids }) => {
        if (latest.current.soundOn) unlockAudio();
        cards.setActionState(ids, action, "signing");
        try {
          const info = await latest.current.onAction(action, ids, (state) => {
            cards.setActionState(
              ids,
              action,
              state.phase === "sending" || state.phase === "done"
                ? "sending"
                : "signing",
              {
                progress: { confirmed: state.confirmed, total: state.total },
              },
            );
          });
          cards.setActionState(ids, action, "done", info);
        } catch (error) {
          cards.setActionState(ids, action, "failed", {
            message: (error as { message?: Msg }).message ?? {
              key: "errors.generic",
            },
          });
        }
      }),
      cards.on("rip", () => latest.current.onRip()),
      cards.on("verify", ({ seq }) => latest.current.onVerify(seq)),
      cards.on("refresh", () => latest.current.onRefresh()),
    ];
    return () => {
      window.removeEventListener("resize", resize);
      offs.forEach((off) => off());
      cards.destroy();
      controller.current = null;
    };
  }, []);
  useEffect(() => controller.current?.setData(props.data), [props.data]);
  useEffect(() => {
    if (props.highlight) controller.current?.highlight(props.highlight);
  }, [props.highlight]);
  useEffect(
    () => controller.current?.setReducedMotion(props.reducedMotion),
    [props.reducedMotion],
  );
  return <div ref={host} className="cards-host" />;
}

import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  mountRip,
  ripAssets,
  type CardAction,
  type RipController,
  type RipResult,
} from "./module/index";
import { pressable, pulse } from "./module/ui-motion";
import { playCue, unlockAudio } from "./sound";
import { count, packPrice, short, t } from "@onepercent/copy";
import { THUMBS, copy, editions, type EditionId } from "./copy";
import { decodeImage } from "../../app/decode-image";
import { withDeadline } from "../../data/deadline";
import { watchFrameBudget } from "./frame-budget";
import { machinePoster, RipShape } from "../shapes/Shapes";
import "./rip.css";

export interface RipPreview {
  pullId?: string;
  lines: { label: string; note?: string }[];
  total: string;
  approvals?: string;
  details?: { label: string; note?: string }[];
  program?: string;
  warning?: string;
}

export interface RipViewProps {
  edition: EditionId;
  quantity?: number;
  available?: boolean;
  maxQty?(edition: EditionId): number;
  onQty?(quantity: number): void;
  onPrepare?(
    edition: EditionId,
    quantity: number,
    signal?: AbortSignal,
  ): Promise<RipPreview>;
  /** Formatted wallet balance ("3.20"), or null when unknown. */
  balanceUi: string | null;
  soundOn: boolean;
  reducedMotion: boolean;
  /** Whether a Rip of this edition can be signed now; `reason` is shown when not. */
  gate(edition: EditionId): { open: boolean; reason: string | null };
  /** Buys the selected quantity and returns verified results in chain order. */
  onRip(
    edition: EditionId,
    quantity: number,
  ): Promise<{ pullId: string; result: RipResult; results?: RipResult[] }>;
  /** Live adapters can distinguish an unresolved signed Pull from an unsent buy. */
  failureMessage?(error: unknown): string;
  /** Sells the hit to the machine (`sell_back`); resolves when it landed, with the SOL received (formatted). */
  onAction(
    index: number,
    action: "sell_back",
    packIndex?: number,
  ): Promise<{ solUi?: string }>;
  /** "Go to My cards": opens My cards with this pulled card highlighted. */
  onMyCards(index: number, packIndex?: number): void;
  onShare(text: string): void;
  onVerify(): void;
  onEdition(edition: EditionId): void;
}

const ASSETS = "/experience/rip/";
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* Preference only. */
    }
  },
};
/** The header's My cards entry and wallet chip that is visible at this width. */
function target(selectors: string[]) {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element && element.offsetParent !== null) return element;
  }
  return null;
}

/**
 * The stage's framing insets: under the shell header, clear of the dock. The
 * dock's layout box is read (offsetTop), not its rect: it is still sliding in when
 * the end shot frames.
 */
function stageInsets(host: HTMLElement, box: HTMLElement) {
  const header =
    document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
  return {
    top: Math.max(0, header - host.getBoundingClientRect().top),
    bottom: Math.max(0, host.clientHeight - box.offsetTop + 14),
  };
}

export default function RipView(props: RipViewProps) {
  // The stage mounts once the machine poster it shows first is decoded (until then
  // the loading shape stays), so the poster never paints half-downloaded.
  use(decodeImage(machinePoster(ASSETS)));
  const stage = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const ripButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<RipController | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [quantity, setQuantity] = useState(props.quantity ?? 1);
  const quantityRef = useRef(quantity);
  quantityRef.current = quantity;
  const [preview, setPreview] = useState<RipPreview | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => setCopyStatus(""), [preview]);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [results, setResults] = useState<RipResult[]>([]);
  const [packIndex, setPackIndex] = useState(0);
  const packIndexRef = useRef(0);
  const playing = useRef(false);
  const batch = useRef<{ pullId: string; results: RipResult[] } | null>(null);
  const turboRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (preview) dialog.current?.showModal();
  }, [preview]);
  const [edition, setEdition] = useState<EditionId>(props.edition);
  const [mode, setMode] = useState<"tap" | "auto">(() =>
    store.get("onepercent.rip.reveal") === "auto" ? "auto" : "tap",
  );
  const [turbo, setTurbo] = useState(
    () => store.get("onepercent.rip.turbo") === "on",
  );
  turboRef.current = turbo;
  const maximum = props.maxQty?.(edition) ?? 1;
  useEffect(() => {
    if (maximum < 1) return;
    const next = Math.max(1, Math.min(quantity, maximum));
    if (next !== quantity) {
      setQuantity(next);
      props.onQty?.(next);
    }
  }, [maximum, quantity, props.onQty]);
  const [phase, setPhase] = useState<"pick" | "playing" | "end">("pick");
  // The dock's end layout (Rip again, Change pack). It is applied while the
  // dock is hidden during a Rip, so the stage already has the end inset when
  // the end beat frames the cards (the beat frames them at once).
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (phase !== "playing") return setCompact(phase === "end");
    const timer = setTimeout(() => setCompact(true), 320);
    return () => clearTimeout(timer);
  }, [phase]);
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => {
    setPreview(null);
    setPrepareError(null);
  }, [edition, quantity]);
  const editionRef = useRef(edition);
  editionRef.current = edition;

  useLayoutEffect(() => {
    const container = stage.current;
    if (!container) return;
    let rip: RipController;
    const fallback = () => {
      container.removeEventListener("rip-render-error", fallback);
      stopBudget();
      rip.destroy();
      controller.current = null;
      setUnsupported(true);
      if (batch.current) {
        playing.current = false;
        setPhase("end");
      }
    };
    const stopBudget = watchFrameBudget(fallback);
    container.addEventListener("rip-render-error", fallback);
    try {
      rip = mountRip(container, {
        ...ripAssets(ASSETS),
        // The first framing already clears the header and the dock, so the
        // machine's poster never moves when the insets arrive (layout shift).
        insets: dock.current ? stageInsets(container, dock.current) : undefined,
        reducedMotion: latest.current.reducedMotion || undefined,
        revealMode: mode,
        turbo,
        autoActionAnimations: false,
        autoSellBackAnimation: false,
        jackpotLevel: 0.86,
        targets: {
          myCards: target([".app-header .cards-chip"]),
          wallet: target([".wallet-control > button"]),
        },
      });
    } catch {
      container.removeEventListener("rip-render-error", fallback);
      stopBudget();
      setUnsupported(true);
      return;
    }
    controller.current = rip;
    const offs = [
      rip.on("sound", ({ cue, index }) => {
        if (latest.current.soundOn) playCue(cue, index ?? 0);
      }),
      rip.on("beat", (beat) => {
        if (beat === "end") setPhase("end");
      }),
      rip.on("cardAction", async (index, action: CardAction) => {
        // Go to My cards signs nothing: the card flies into the header's My
        // cards entry, then My cards opens with it highlighted.
        if (action === "my_cards") {
          await rip.animateAction(index, action);
          latest.current.onMyCards(index, packIndexRef.current);
          return;
        }
        rip.setActionState(index, action, "pending");
        try {
          const outcome = await latest.current.onAction(
            index,
            action,
            packIndexRef.current,
          );
          rip.setActionState(index, action, "done");
          await rip.animateSellBack(index, outcome.solUi);
        } catch {
          rip.setActionState(index, action, "failed");
        }
      }),
      rip.on("share", ({ tier }) => {
        const names: Record<string, string> = {
          silver: "Silver Foil",
          blue: "Blue Foil",
          holo: "Holo Foil",
          black: "Black Foil",
          jackpot: "the Jackpot",
          one_pct: "The 1%",
        };
        latest.current.onShare(
          copy("rip.share", { title: names[tier] ?? tier }),
        );
      }),
      rip.on("verify", () => latest.current.onVerify()),
      rip.on("retry", () => setPhase("pick")),
    ];
    return () => {
      stopBudget();
      container.removeEventListener("rip-render-error", fallback);
      offs.forEach((off) => off());
      rip.destroy();
      controller.current = null;
    };
    // Mount once; later preference changes go through the controller.
  }, []);

  useEffect(
    () => controller.current?.setReducedMotion(props.reducedMotion),
    [props.reducedMotion],
  );
  useEffect(() => {
    controller.current?.setRevealMode(mode);
    store.set("onepercent.rip.reveal", mode);
  }, [mode]);
  useEffect(() => {
    controller.current?.setTurbo(turbo);
    store.set("onepercent.rip.turbo", turbo ? "on" : "off");
  }, [turbo]);
  // Keep the stage's framing clear of the dock as it changes (stageInsets).
  useEffect(() => {
    const update = () => {
      const rip = controller.current;
      const box = dock.current;
      const host = stage.current;
      if (!rip || !box || !host) return;
      rip.setInsets(stageInsets(host, box));
    };
    const frame = requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    if (dock.current) observer.observe(dock.current);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [phase]);
  useEffect(() => {
    const button = ripButton.current;
    if (!button) return;
    return pressable(button, { magnetic: 7, nudge: button.querySelector("b") });
  }, []);

  async function finishPack(done: Promise<void>) {
    try {
      await done;
      if (!mounted.current) return;
      playing.current = false;
      const next = packIndexRef.current + 1;
      if (
        turboRef.current &&
        batch.current &&
        next < batch.current.results.length
      )
        void nextPack(next);
      else ripButton.current?.focus({ preventScroll: true });
    } catch (error) {
      playing.current = false;
      if (!mounted.current) return;
      if ((error as Error).name === "RipFailedError") setPhase("pick");
    }
  }
  async function nextPack(index: number) {
    const control = controller.current;
    const saved = batch.current;
    if (!saved || !saved.results[index] || playing.current) return;
    playing.current = true;
    packIndexRef.current = index;
    setPackIndex(index);
    setPhase("playing");
    if (!control) {
      playing.current = false;
      setPhase("end");
      return;
    }
    const done = control.play({
      edition: editionRef.current,
      pullId: `${saved.pullId}:${index}`,
    });
    control.setResult(saved.results[index]!);
    await finishPack(done);
  }
  async function startRip() {
    const control = controller.current;
    const chosen = editionRef.current;
    if (!latest.current.gate(chosen).open || playing.current) return;
    playing.current = true;
    setPreview(null);
    setPrepareError(null);
    if (latest.current.soundOn) unlockAudio();
    control?.enableMotion();
    if (ripButton.current) pulse(ripButton.current, "#f6d272");
    batch.current = null;
    packIndexRef.current = 0;
    setPackIndex(0);
    setResults([]);
    setPhase("playing");
    const done = control?.play({
      edition: chosen,
      ...(preview?.pullId ? { pullId: `${preview.pullId}:0` } : {}),
    });
    latest.current.onRip(chosen, quantity).then(
      ({ pullId, result, results: all }) => {
        if (!mounted.current) return;
        const ordered = all ?? [result];
        batch.current = { pullId, results: ordered };
        setResults(ordered);
        controller.current?.setResult(ordered[0]!);
        if (!controller.current) {
          playing.current = false;
          setPhase("end");
        }
      },
      (error) => {
        if (!mounted.current) return;
        const message = failureText(error);
        controller.current?.fail(message);
        setPrepareError(message);
        if (!controller.current) {
          playing.current = false;
          setPhase("pick");
        }
      },
    );
    if (done) await finishPack(done);
  }
  async function rip() {
    if (!latest.current.gate(editionRef.current).open || preparing) return;
    if (!latest.current.onPrepare) {
      await startRip();
      return;
    }
    setPreparing(true);
    setPrepareError(null);
    try {
      const chosen = editionRef.current;
      const selectedQty = quantityRef.current;
      const prepare = latest.current.onPrepare;
      const next = await withDeadline((signal) =>
        prepare(chosen, selectedQty, signal),
      );
      if (
        mounted.current &&
        chosen === editionRef.current &&
        selectedQty === quantityRef.current
      )
        setPreview(next);
    } catch (error) {
      if (mounted.current) setPrepareError(failureText(error));
    } finally {
      if (mounted.current) setPreparing(false);
    }
  }
  function failureText(error: unknown) {
    try {
      const message = latest.current.failureMessage?.(error)?.trim();
      if (message) return message;
    } catch {
      // A formatter failure must not leave the user without an explanation.
    }
    return t(
      error instanceof Error && error.name === "TimeoutError"
        ? "common.networkError"
        : "errors.generic",
    );
  }
  function change() {
    controller.current?.reset();
    playing.current = false;
    setPhase("pick");
    setResults([]);
    batch.current = null;
  }
  function select(id: EditionId) {
    setEdition(id);
    props.onEdition(id);
  }

  const current = editions.find((e) => e.id === edition) ?? editions[0]!;
  const gate = props.gate(edition);
  const hasNext = packIndex + 1 < results.length;
  const nextQty = (value: number) => {
    setQuantity(value);
    props.onQty?.(value);
  };
  return (
    <section className="rip-page" aria-labelledby="rip-title">
      <h1 id="rip-title" className="sr-only" tabIndex={-1}>
        {copy("rip.title")}
      </h1>
      <div ref={stage} className="rip-stage">
        {unsupported && <RipShape assets={ASSETS} dock={false} />}
      </div>
      {unsupported && !results.length && (
        <p className="sr-only">{copy("rip.unsupported")}</p>
      )}
      {unsupported && results[packIndex] && (
        <section
          className="rip-preview rip-static"
          aria-label={t("rip.progress", {
            n: count(packIndex + 1),
            t: count(results.length),
          })}
        >
          <h2>{results[packIndex]!.hit.symbol}</h2>
          <p>{results[packIndex]!.hit.amountUi}</p>
          <ul>
            {results[packIndex]!.dust.map((card, index) => (
              <li key={index}>
                {card.symbol} {card.amountUi}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => props.onMyCards(4, packIndex)}>
            {t("rip.myCards")}
          </button>
        </section>
      )}
      {preview && (
        <dialog
          ref={dialog}
          className="rip-preview"
          aria-labelledby="rip-preview-title"
          onCancel={() => setPreview(null)}
        >
          <h2 id="rip-preview-title">{t("rip.preview.title")}</h2>
          <ul>
            {preview.lines.map((line, index) => (
              <li key={index}>
                <b>{line.label}</b>
                {line.note && <small>{line.note}</small>}
              </li>
            ))}
          </ul>
          <p className="rip-preview-total">{preview.total}</p>
          {preview.approvals && <p>{preview.approvals}</p>}
          {preview.details && (
            <details className="rip-preview-details">
              <summary>{t("rip.preview.details")}</summary>
              <ul>
                {preview.details.map((line, index) => (
                  <li key={index}>
                    <b>{line.label}</b>
                    {line.note && <small>{line.note}</small>}
                  </li>
                ))}
              </ul>
              {preview.program && (
                <div className="rip-preview-program">
                  <span>
                    {t("rip.preview.program", {
                      program: short(preview.program),
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(preview.program!);
                        setCopyStatus(t("rip.preview.programCopied"));
                      } catch {
                        setCopyStatus(t("rip.preview.copyFailed"));
                      }
                    }}
                  >
                    {t("rip.preview.copyProgram")}
                  </button>
                </div>
              )}
              <small role="status">{copyStatus}</small>
            </details>
          )}
          {preview.warning && <p role="status">{preview.warning}</p>}
          <div className="rip-preview-actions">
            <button type="button" onClick={() => setPreview(null)}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => void startRip()}>
              {t("rip.preview.confirm")}
            </button>
          </div>
        </dialog>
      )}
      <div
        ref={dock}
        inert={phase === "playing"}
        className={`rip-dock${compact ? " is-compact" : ""}${phase === "playing" ? " is-hidden" : ""}`}
      >
        {!compact && props.available !== false && (
          <div
            className="rip-editions"
            role="radiogroup"
            aria-label={copy("rip.editions")}
          >
            {editions.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === edition}
                tabIndex={item.id === edition ? 0 : -1}
                className="rip-edition"
                disabled={preparing}
                onClick={() => select(item.id)}
                onKeyDown={(event) => {
                  const step =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  if (!step) return;
                  event.preventDefault();
                  const next =
                    editions[
                      (index + step + editions.length) % editions.length
                    ]!;
                  select(next.id);
                  (
                    event.currentTarget.parentElement?.children[
                      editions.indexOf(next)
                    ] as HTMLElement | undefined
                  )?.focus();
                }}
              >
                <img
                  src={`${ASSETS}${THUMBS[item.id]}`}
                  alt=""
                  width={52}
                  height={52}
                />
                <span>
                  <b>{item.name}</b>
                  <small>{t("common.sol", { sol: item.price })}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        {props.available === false ? (
          <p className="rip-trust" role="status">
            {gate.reason}
          </p>
        ) : (
          <div className="rip-cta">
            {!compact && props.maxQty && (
              <div
                className="rip-seg"
                role="radiogroup"
                aria-label={t("rip.quantity")}
              >
                {[...new Set([1, 5, 10, quantity])]
                  .sort((a, b) => a - b)
                  .map((value) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={quantity === value}
                      disabled={preparing || value > maximum}
                      key={value}
                      onClick={() => nextQty(value)}
                    >
                      {t("rip.quantity.option", { n: count(value) })}
                    </button>
                  ))}
              </div>
            )}
            {results.length > 1 && (
              <p className="rip-trust">
                {t("rip.progress", {
                  n: count(packIndex + 1),
                  t: count(results.length),
                })}
              </p>
            )}
            <button
              ref={ripButton}
              type="button"
              className="rip-oval"
              disabled={
                phase === "playing" ||
                (hasNext ? false : !gate.open || preparing)
              }
              onClick={() => void (hasNext ? nextPack(packIndex + 1) : rip())}
            >
              <span className="rip-oval-face">
                <em>
                  {hasNext
                    ? t("rip.next")
                    : preparing
                      ? t("common.loading")
                      : prepareError
                        ? t("common.retry")
                        : copy(compact ? "rip.again" : "rip.button", {
                            n: count(quantity),
                            sol: packPrice(
                              current.priceLamports * BigInt(quantity),
                            ),
                          })}
                </em>
                <b aria-hidden="true">→</b>
              </span>
            </button>
            {compact && (
              <button type="button" className="rip-pill" onClick={change}>
                {copy("rip.change")}
              </button>
            )}
            {!compact && (
              <div className="rip-modes">
                <div
                  className="rip-seg"
                  role="radiogroup"
                  aria-label={copy("rip.reveal")}
                >
                  {(["tap", "auto"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={mode === value}
                      onClick={() => setMode(value)}
                    >
                      {copy(
                        value === "tap" ? "rip.reveal.tap" : "rip.reveal.auto",
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="rip-toggle"
                  aria-pressed={turbo}
                  onClick={() => setTurbo(!turbo)}
                >
                  {copy("rip.turbo")}
                </button>
              </div>
            )}
            {phase === "end" && !hasNext && results.length > 1 && (
              <ol className="rip-line" aria-label={t("rip.line")}>
                {results.map((result, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="rip-pill"
                      onClick={() => void nextPack(index)}
                    >
                      <small>
                        {t("rip.progress", {
                          n: count(index + 1),
                          t: count(results.length),
                        })}
                      </small>
                      <b>{result.hit.symbol}</b>
                      <span>{result.hit.amountUi}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {prepareError && (
              <p className="rip-trust" role="alert">
                {prepareError}
              </p>
            )}
            {/* Under the dock: why ripping is closed, if it is, and the balance.
                Verifying a draw is offered where it means something: at the end. */}
            <p className="rip-trust">
              {!gate.open && gate.reason}
              {props.balanceUi !== null && (
                <span>{copy("rip.balance", { sol: props.balanceUi })}</span>
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

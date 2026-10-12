import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { matchXrayPath } from "./route";
import { incomingReferral, rememberReferral, xrayPageUrl } from "./referral";
import { strings } from "./strings";
import { useXray } from "./use-xray";
import { XrayField } from "./xray-field";
import { WEB } from "@onepercent/config/web";
import { t, dateUtc } from "@onepercent/copy/initial";
import { shortAddress } from "@onepercent/eligibility/format";
import { ExperienceSlot } from "../bridge/ExperienceSlot";
import { preloadModule } from "../app/lazy-module";
import { useFeedBackEstimate } from "../data/feed-back";
import { useWallet } from "../wallet/WalletProvider";
import { useConfig } from "../data/config";
import { flagEnabled } from "../data/flags";
import { beacon } from "../analytics/client";
import { navigate } from "../routes/router";
const loadView = () =>
  import("./XrayView").then((module) => ({ default: module.XrayView }));
import "./xray.css";
// The challenge widget's loader comes only with a challenge (an X-ray answered 403).
const Turnstile = lazy(() =>
  import("./Turnstile").then((module) => ({ default: module.Turnstile })),
);

export function navigateXray(input: string) {
  const ref = incomingReferral(window.location.search);
  const search = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  navigate(`/x/${encodeURIComponent(input.trim())}${search}`);
}

export function XrayPage({
  input = matchXrayPath(window.location.pathname)?.input || "",
  search = window.location.search,
}: {
  input?: string;
  search?: string;
}) {
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    document
      .querySelector<HTMLElement>("main h1")
      ?.focus({ preventScroll: true });
  }, []);
  // The result's view loads alongside the scan, so the result renders in one
  // pass and nothing under it moves when the view arrives (layout shift).
  useEffect(() => {
    void preloadModule(loadView).catch(() => undefined);
  }, []);
  const ref = incomingReferral(search);
  const { state, submitToken, challengeError } = useXray(input, ref);
  const feedBackEstimate = useFeedBackEstimate();
  useEffect(() => rememberReferral(ref), [ref]);
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state]);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => setAnnouncement(""), [input]);
  function share() {
    if (state.status === "done") {
      beacon({ event: "xray_share", channel: "x" });
      window.open(state.result.share.xIntentUrl, "_blank", "noopener");
    }
  }
  async function copy() {
    if (state.status !== "done") return;
    try {
      await navigator.clipboard.writeText(
        xrayPageUrl(state.result.address, ref),
      );
      beacon({ event: "xray_share", channel: "copy" });
      setAnnouncement(strings.copied);
    } catch {
      setAnnouncement(strings.copyFailed);
    }
  }
  return (
    <section className="xray">
      <a className="xray-brand" href="/">
        {strings.brand}
      </a>
      {/* A result's title is its wallet (the header already says X-ray); the
          field stays above it, compact, for the next wallet. */}
      {input ? (
        <>
          <XrayField
            input={input}
            onSubmit={navigateXray}
            busy={state.status === "loading"}
          />
          <h1 tabIndex={-1} className="xray-who">
            {shortAddress(input)}
          </h1>
        </>
      ) : (
        <>
          <h1 tabIndex={-1}>{strings.title}</h1>
          <XrayField input={input} onSubmit={navigateXray} />
        </>
      )}
      {state.status === "loading" && (
        <XrayShape>
          <p role="status" className="sr-only">
            {strings.loading}
          </p>
        </XrayShape>
      )}
      {state.status === "challenge" && (
        <div className="experience-loading">
          <Suspense fallback={null}>
            <Turnstile onToken={submitToken} onError={challengeError} />
          </Suspense>
        </div>
      )}
      {state.status === "error" && (
        <p className="xray-error" role="alert" ref={errorRef} tabIndex={-1}>
          {state.message}
        </p>
      )}
      {state.status === "done" && (
        <>
          {state.result.valuesPartial && (
            <p role="status">{strings.valuesPartial}</p>
          )}
          <ExperienceSlot
            component="xray"
            load={loadView}
            props={{
              result: state.result,
              onShareX: share,
              onCopyLink: () => void copy(),
              feedBackEstimate,
              next: <AfterScan address={state.result.address} />,
            }}
            placeholder={<p>{t("xray.error.unavailable")}</p>}
            poster={<XrayShape />}
          />
        </>
      )}
      <p className="xray-announcement" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

/** The result's shape while the scan runs or its view loads (styles.css .xray-sk). */
function XrayShape({ children }: { children?: ReactNode }) {
  return (
    <div className="experience-loading xray-sk">
      {children}
      <span className="sk sk-stats" />
      <span className="sk sk-outlook" />
      <span className="sk sk-list" />
    </div>
  );
}

export function XrayRoute({ fallback }: { fallback: ReactNode }) {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  useEffect(() => {
    const update = () =>
      setLocation({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const route = matchXrayPath(location.pathname);
  return route ? (
    <XrayPage input={route.input} search={location.search} />
  ) : (
    fallback
  );
}

function AfterScan({ address }: { address: string }) {
  const wallet = useWallet();
  const config = useConfig();
  if (wallet.account && wallet.account.address !== address)
    return (
      <a className="xray-next" href={`/x/${wallet.account.address}`}>
        {t("xray.cta.yours")}
      </a>
    );
  if (!flagEnabled(config, "FEED"))
    return (
      <p>
        {config.data?.season?.stockUpTs
          ? t("xray.cta.feedOpens", {
              date: dateUtc(
                config.data.season.stockUpTs * WEB.millisecondsPerSecond,
              ),
            })
          : t("xray.cta.feedOpensUndated")}
      </p>
    );
  // "Feed my bags →": the label, and its arrow as the oval's chip (decoration).
  const feed = t("xray.cta.feedMine");
  const arrow = feed.lastIndexOf(" ");
  return wallet.account ? (
    <a className="oval xray-next" href="/feed">
      <span>{feed.slice(0, arrow)}</span>
      <b aria-hidden="true">{feed.slice(arrow + 1)}</b>
    </a>
  ) : (
    <button className="xray-next" onClick={wallet.open}>
      {t("xray.cta.connect")}
    </button>
  );
}

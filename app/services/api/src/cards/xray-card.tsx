/** @jsxRuntime automatic */
/** @jsxImportSource satori/jsx */
import type { CSSProperties } from "satori/jsx";
import {
  CARD_COPY,
  cardBagCount,
  cardBreakdown,
  cardOneLiner,
  cardWorst,
} from "@onepercent/eligibility/copy";
import {
  cardTicker,
  formatPct,
  shortAddress,
} from "@onepercent/eligibility/format";
import type { XrayResult } from "@onepercent/eligibility/xray-result";

export type CardFormat = "landscape" | "square";
export interface CardModel {
  result: XrayResult;
  coins: readonly { ticker: string; drawdownPct: number | null }[];
}
export const CARD_SIZE = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
} as const;
export const COLORS = {
  cream: "#fff1e7",
  ink: "#26062e",
  lilac: "#d5a2f1",
  plum: "#2c1235",
  mauve: "#773e83",
  paper: "#fff9ee",
  paperEdge: "#f1dfd5",
  deep: "#120d30",
  mid: "#243969",
  rim: "#92ebf0",
  cyan: "#94f5ed",
  glint: "#efffff",
  goldHi: "#f6d272",
  gold: "#d9a441",
} as const;
const flex: CSSProperties = { display: "flex" };
const serif: CSSProperties = { fontFamily: "Fraunces", fontWeight: 600 };

export function Sep({
  color = COLORS.ink,
  size = 22,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 2v20M2 12h20M5 5l14 14M5 19L19 5"
        fill="none"
        stroke={color}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function Approx({
  color = COLORS.ink,
  size = 24,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M2 9c6-7 14 7 20 0M2 16c6-7 14 7 20 0"
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Keep the two unsupported glyphs out of font text nodes, including supplied copy.
export function CardText({
  text,
  color = COLORS.ink,
  size = 24,
}: {
  text: string;
  color?: string;
  size?: number;
}) {
  return (
    <span style={{ ...flex, alignItems: "center", flexWrap: "wrap" }}>
      {text
        .split(/([✳≈])/u)
        .map((part) =>
          part === "✳" ? (
            <Sep color={color} size={size * 0.65} />
          ) : part === "≈" ? (
            <Approx color={color} size={size * 0.8} />
          ) : (
            <span>{part}</span>
          ),
        )}
    </span>
  );
}

function Header({ width, square }: { width: number; square: boolean }) {
  const height = square ? 130 : 104;
  return (
    <div
      style={{
        ...flex,
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height: height + 16,
      }}
    >
      <svg
        style={{ position: "absolute" }}
        width={width}
        height={height + 16}
        viewBox={`0 0 ${width} ${height + 16}`}
      >
        <path
          d={`M0 0H${width}V${height}Q${width / 2} ${height + 32} 0 ${height}Z`}
          fill={COLORS.lilac}
        />
      </svg>
      <div
        style={{
          ...flex,
          position: "absolute",
          left: 64,
          right: 64,
          top: 22,
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "Fraunces",
          fontWeight: 700,
        }}
      >
        <span style={{ fontSize: square ? 76 : 64, letterSpacing: "-0.06em" }}>
          {CARD_COPY.brandMark}
        </span>
        <span style={{ fontSize: square ? 52 : 42, letterSpacing: "-0.04em" }}>
          {CARD_COPY.brand}
        </span>
      </div>
    </div>
  );
}

function Headline({ result, square }: { result: XrayResult; square: boolean }) {
  const worst = cardWorst(result.worst);
  const width = square ? 936 : 636;
  return (
    <div
      style={{
        ...flex,
        position: "absolute",
        flexDirection: "column",
        left: square ? 72 : 64,
        top: square ? 164 : 133,
        width,
      }}
    >
      <div
        style={{
          ...flex,
          gap: 12,
          alignItems: "center",
          fontSize: 30,
          fontWeight: 500,
          height: square ? 38 : 30,
        }}
      >
        <span>{CARD_COPY.xray}</span>
        <Sep />
        <span>{shortAddress(result.address)}</span>
      </div>
      <div
        style={{
          ...flex,
          ...serif,
          fontSize: 112,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          height: 112,
          lineHeight: 1,
        }}
      >
        {cardBagCount(result.counts.bags)}
      </div>
      {result.worst !== null && (
        <div
          style={{
            ...flex,
            ...serif,
            fontSize: worst.length > 24 ? 36 : 44,
            letterSpacing: square ? "-0.02em" : "-0.055em",
            height: square ? 52 : 76,
            lineHeight: 1.02,
            alignItems: "center",
            width,
          }}
        >
          <CardText text={worst} size={36} />
        </div>
      )}
      <div
        style={{
          ...flex,
          flexDirection: square ? "row" : "column",
          alignItems: square ? "center" : "flex-start",
          gap: square ? 22 : 0,
        }}
      >
        <div
          style={{
            ...flex,
            marginTop: square ? 5 : 0,
            alignSelf: "flex-start",
            background: COLORS.ink,
            color: COLORS.cream,
            padding: "6px 20px",
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 500,
          }}
        >
          <CardText text={result.card.title} color={COLORS.cream} size={30} />
        </div>
      </div>
      <div
        style={{
          ...flex,
          ...serif,
          marginTop: square ? 12 : 8,
          fontStyle: "italic",
          fontSize: 34,
          lineHeight: 1.14,
          maxHeight: 80,
          overflow: "hidden",
        }}
      >
        <CardText text={cardOneLiner(result.card.oneLiner)} size={34} />
      </div>
    </div>
  );
}

function Coin({
  ticker,
  drawdownPct,
  square,
}: CardModel["coins"][number] & { square: boolean }) {
  const size = square ? 118 : 94;
  return (
    <div
      style={{
        ...flex,
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        style={{
          ...flex,
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          padding: 5,
          backgroundImage: `linear-gradient(135deg, ${COLORS.rim}, ${COLORS.mid})`,
        }}
      >
        <div
          style={{
            ...flex,
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            border: `2px solid ${COLORS.cyan}`,
            backgroundImage: `radial-gradient(circle at 30% 25%, ${COLORS.mid}, ${COLORS.deep})`,
            color: COLORS.glint,
            fontFamily: "Fraunces",
            fontSize: square ? 64 : 54,
            fontWeight: 700,
          }}
        >
          {cardTicker(ticker, "").slice(0, 1)}
        </div>
      </div>
      <span style={{ fontSize: 28, fontWeight: 500, color: COLORS.cream }}>
        {drawdownPct === null ? CARD_COPY.missing : formatPct(drawdownPct)}
      </span>
    </div>
  );
}

function Breakdown({ result }: { result: XrayResult }) {
  return (
    <div
      style={{
        ...flex,
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "10px 14px",
        fontSize: 28,
        lineHeight: 1.3,
        fontWeight: 500,
        color: COLORS.cream,
        padding: "0 26px",
      }}
    >
      {cardBreakdown(result).map((segment, index) => {
        const money = /^(.*?)≈([\d.]+ SOL)(.*)$/.exec(segment);
        return (
          <div style={{ ...flex, alignItems: "center", gap: 7 }}>
            {index > 0 && <Sep color={COLORS.cream} size={18} />}
            {money ? (
              <>
                <span>{money[1]}</span>
                <span
                  style={{
                    ...flex,
                    alignItems: "center",
                    color: COLORS.goldHi,
                    margin: "0 5px",
                  }}
                >
                  <Approx color={COLORS.goldHi} size={24} />
                  {money[2]}
                </span>
                <span>{money[3]}</span>
              </>
            ) : (
              <CardText text={segment} color={COLORS.cream} size={28} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Panel({ model, square }: { model: CardModel; square: boolean }) {
  const height = square ? 340 : 350;
  const width = square ? 936 : 396;
  return (
    <div
      style={{
        ...flex,
        position: "absolute",
        left: square ? 72 : 740,
        top: square ? 560 : 150,
        width,
        height,
        borderRadius: "18px 18px 48px 18px",
        overflow: "hidden",
        backgroundImage: `radial-gradient(circle at 45% 35%, ${COLORS.mid}, ${COLORS.deep})`,
      }}
    >
      <svg
        style={{ position: "absolute", top: 0, left: 0 }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <pattern
            id="scanlines"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <rect width={width} height="2" fill="#ffffff" fillOpacity="0.078" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#scanlines)" />
      </svg>
      <div
        style={{
          ...flex,
          flexDirection: "column",
          width: "100%",
          justifyContent: "center",
          gap: square ? 30 : 0,
        }}
      >
        <div
          style={{
            ...flex,
            alignItems: "center",
            justifyContent: "center",
            gap: square ? 56 : 20,
            minHeight: 154,
          }}
        >
          {model.coins.slice(0, 3).map((coin) => (
            <Coin {...coin} square={square} />
          ))}
        </div>
        {square && <Breakdown result={model.result} />}
      </div>
    </div>
  );
}

export function XrayCard({
  model,
  format,
}: {
  model: CardModel;
  format: CardFormat;
}) {
  const square = format === "square";
  const { width, height } = CARD_SIZE[format];
  return (
    <div
      style={{
        ...flex,
        position: "relative",
        width,
        height,
        color: COLORS.ink,
        fontFamily: "DM Sans",
        fontWeight: 400,
        backgroundImage: `radial-gradient(circle at 40% 30%, ${COLORS.paper}, ${COLORS.paperEdge})`,
      }}
    >
      <Header width={width} square={square} />
      <Headline result={model.result} square={square} />
      <Panel model={model} square={square} />
      <div
        style={{
          ...flex,
          position: "absolute",
          left: 0,
          right: 0,
          top: square ? 950 : 540,
          bottom: 0,
          justifyContent: "center",
          alignItems: "center",
          gap: 18,
          paddingBottom: square ? 10 : 0,
          background: COLORS.lilac,
          fontSize: 30,
          fontWeight: 500,
        }}
      >
        <span>{CARD_COPY.bottom}</span>
        <Sep />
        <span>{CARD_COPY.domain}</span>
      </div>
    </div>
  );
}

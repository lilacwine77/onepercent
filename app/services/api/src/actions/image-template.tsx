/** @jsxRuntime automatic */
/** @jsxImportSource satori/jsx */
import { BLINKS } from "@onepercent/config";

// The existing fonts omit these two copy marks. Use the X-ray mark paths so
// placeholders never print missing-glyph boxes.
function textMarks(line: string) {
  return line.split(/([✳≈])/u).map((part) =>
    part === "✳" || part === "≈" ? (
      <svg width={24} height={32} viewBox="0 0 24 24">
        <path
          d={
            part === "✳"
              ? "M12 2v20M2 12h20M5 5l14 14M5 19L19 5"
              : "M2 9c6-7 14 7 20 0M2 16c6-7 14 7 20 0"
          }
          fill="none"
          stroke="#26062e"
          strokeWidth={part === "✳" ? 3.4 : 2.2}
          strokeLinecap="round"
        />
      </svg>
    ) : (
      <span style={{ whiteSpace: "pre-wrap" }}>{part}</span>
    ),
  );
}

// Existing X-ray cream/ink tokens and DM Sans; plain text awaiting the architect.
export function BlinkPlaceholder({ lines }: { lines: readonly string[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: BLINKS.imagePx,
        height: BLINKS.imagePx,
        padding: 64,
        backgroundColor: "#fff1e7",
        color: "#26062e",
        fontFamily: "DM Sans",
        fontSize: 32,
        gap: 24,
      }}
    >
      {lines.filter(Boolean).map((line) => (
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {textMarks(line)}
        </div>
      ))}
    </div>
  );
}

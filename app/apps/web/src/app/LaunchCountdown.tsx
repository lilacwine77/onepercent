import { Fragment } from "react";
import { t, countUngrouped } from "@onepercent/copy/initial";
import "./launch-countdown.css";
const separator = ":";

export function LaunchCountdown({ seconds }: { seconds: number }) {
  const parts = [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ].map((part) => countUngrouped(part).padStart(2, "0"));
  return (
    <div className="launch-countdown">
      <span className="launch-countdown-label">{t("launch.label")}</span>
      <span
        className="launch-countdown-digits"
        role="timer"
        aria-live="off"
        aria-label={t("launch.time", {
          hours: parts[0]!,
          minutes: parts[1]!,
          seconds: parts[2]!,
        })}
      >
        {parts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 && (
              <span className="launch-countdown-colon" aria-hidden="true">
                {separator}
              </span>
            )}
            <span className="launch-countdown-part" key={part}>
              {part}
            </span>
          </Fragment>
        ))}
      </span>
    </div>
  );
}

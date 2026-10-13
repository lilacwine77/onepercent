import fraunces400 from "@fontsource/fraunces/files/fraunces-latin-400-normal.woff2?url";
import { Hero } from "./Hero";
import { Sections } from "./Sections";
import type { HomeProps } from "./types";
import "./home.css";
// The landing's Fraunces 400 (its buttons, the story's copy and, on the home, the
// footer's links) as a family of its own, registered with the home: no other route
// downloads it, and no other text changes weight.
if (typeof FontFace !== "undefined")
  document.fonts.add(
    new FontFace("Fraunces Text", `url(${fraunces400}) format("woff2")`, {
      weight: "400",
      display: "swap",
    }),
  );
/**
 * The home experience (D19): the landing (onepercent.fun) as the app's `/`, with
 * the app's own packs (the boosters) and the app's header and flows.
 */
export default function Home(props: HomeProps) {
  return (
    <>
      <Hero props={props} />
      <Sections
        reducedMotion={props.reducedMotion}
        flowsLocked={props.flowsLocked}
      />
    </>
  );
}

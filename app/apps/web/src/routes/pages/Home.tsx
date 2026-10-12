import { ExperienceSlot } from "../../bridge/ExperienceSlot";
import { HomePoster, loadHome, type HomeProps } from "../../experience/index";
import { useConfig } from "../../data/config";
import { flagEnabled } from "../../data/flags";
import { serverTime } from "../../data/server-time";
import { motionPref, soundPref, useStore } from "../../app/prefs";
const now = () => serverTime.nowMs() ?? Date.now();
// D19: the landing is the home route. Config → props; no fabricated machine data.
export default function Home() {
  const machine = useConfig();
  const config = machine.error ? null : machine.data;
  const props: HomeProps = {
    phase:
      machine.data === undefined && !machine.error
        ? undefined
        : (config?.phase ?? null),
    season: config?.season ?? null,
    flags: {
      feed: flagEnabled(machine, "FEED"),
      packs: flagEnabled(machine, "PACKS"),
    },
    now,
    reducedMotion: useStore(motionPref),
    soundOn: useStore(soundPref),
  };
  const poster = <HomePoster />;
  return (
    <ExperienceSlot
      component="hero"
      load={loadHome}
      props={props}
      poster={poster}
      placeholder={poster}
    />
  );
}

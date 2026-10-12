// The "experience-3d" chunk (three.js and the CRT): loaded on / after LCP only
// (03-M3 §15.1). Its file name is the chunk name the budget script exempts.
import { CRTTelevision } from "./crt";
export function createTelevision(
  container: HTMLElement,
  reducedMotion: boolean,
) {
  return new CRTTelevision(container, {
    modelUrl: "/landing/onepercent-crt.glb",
    reducedMotion,
  });
}

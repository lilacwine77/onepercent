#!/usr/bin/env node
/**
 * Builds a cut of the film end to end: frames → mix → encode → faststart → probe.
 *
 *   node scripts/film/make.mjs --layout 16x9 --cap <captures> --audio <film-audio> \
 *        --work <scratch dir> --out public/media/onepercent-explained.mp4 \
 *        [--poster public/media/onepercent-explained.webp --poster-frame 1296] \
 *        [--crf 21] [--maxrate 4200] [--keep-frames]
 *
 * Needs python3 (numpy, Pillow) and Blender (its bundled FFmpeg encodes H.264
 * High + AAC; set BLENDER if it is not /Applications/Blender.app).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { repo } from "./lib/kit.mjs";

const { values } = parseArgs({
  options: {
    layout: { type: "string", default: "16x9" },
    cap: { type: "string" },
    audio: { type: "string" },
    work: { type: "string" },
    out: { type: "string" },
    poster: { type: "string" },
    "poster-frame": { type: "string", default: "1476" },
    crf: { type: "string", default: "23" },
    maxrate: { type: "string", default: "0" },
    "keep-frames": { type: "boolean", default: false },
    "skip-render": { type: "boolean", default: false },
  },
});
for (const key of ["cap", "audio", "work", "out"]) if (!values[key]) throw new Error(`--${key} is required`);
const [width, height] = values.layout === "9x16" ? [1080, 1920] : [1280, 720];
const work = resolve(values.work);
const frames = join(work, `frames-${values.layout}`);
const blender = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const run = (cmd, args, opts = {}) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: repo, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status})`);
};
mkdirSync(work, { recursive: true });

if (!values["skip-render"]) {
  rmSync(frames, { recursive: true, force: true });
  run("node", ["scripts/film/render.mjs", "--layout", values.layout, "--cap", values.cap, "--out", frames]);
}
const mix = join(work, "mix.wav");
run("python3", ["scripts/film/mix.py", "--audio", values.audio, "--cues", "scripts/film/sfx.json", "--out", mix, "--report", join(work, "mix-report.json")]);
const raw = join(work, `raw-${values.layout}.mp4`);
run(blender, [
  "--background", "--factory-startup", "--python", "scripts/film/encode.py", "--",
  "--frames", frames, "--audio", mix, "--out", raw,
  "--width", String(width), "--height", String(height), "--fps", "60",
  "--crf", values.crf, "--maxrate", values.maxrate,
]);
mkdirSync(dirname(resolve(values.out)), { recursive: true });
run("python3", ["scripts/film/mp4tool.py", "faststart", raw, resolve(values.out)]);
const probe = spawnSync("python3", ["scripts/film/mp4tool.py", "probe", resolve(values.out)], { cwd: repo, encoding: "utf8" });
writeFileSync(join(work, `probe-${values.layout}.json`), probe.stdout);
console.log(probe.stdout);
if (values.poster) {
  const still = join(work, "poster");
  run("node", ["scripts/film/render.mjs", "--layout", values.layout, "--cap", values.cap, "--out", still, "--frames", values["poster-frame"]]);
  const src = join(still, `${String(values["poster-frame"]).padStart(5, "0")}.png`);
  run("python3", ["-c", `from PIL import Image; Image.open(${JSON.stringify(src)}).convert("RGB").save(${JSON.stringify(resolve(values.poster))}, "WEBP", quality=90, method=6)`]);
  console.log(`poster ${values.poster} ${statSync(resolve(values.poster)).size} bytes`);
}
if (!values["keep-frames"]) rmSync(frames, { recursive: true, force: true });
console.log(`done: ${values.out} ${statSync(resolve(values.out)).size} bytes`);

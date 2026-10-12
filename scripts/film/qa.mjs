#!/usr/bin/env node
/**
 * Checks an encoded cut the way the players will see it: Chrome decodes the
 * MP4, frames at the given times are compared with the rendered PNG frames
 * (PSNR), and the audio track is decoded and measured.
 *
 *   node scripts/film/qa.mjs --mp4 film.mp4 --frames <png dir> --times 0.5,2.1,8.0 --out <dir>
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { playwright } from "./lib/kit.mjs";

const { values } = parseArgs({
  options: {
    mp4: { type: "string" },
    frames: { type: "string" },
    times: { type: "string", default: "0.5,2.6,4.2,6.6,7.4,8.15,10.05,12.0,14.25,16.6,18.6,20.5,21.5,24.6" },
    out: { type: "string" },
    fps: { type: "string", default: "60" },
  },
});
mkdirSync(values.out, { recursive: true });
const data = readFileSync(values.mp4);
const server = createServer((req, res) => {
  if (!req.url.startsWith("/film.mp4")) return res.writeHead(200, { "Content-Type": "text/html" }), res.end("<!doctype html><body></body>");
  const range = req.headers.range;
  if (range) {
    const [a, b] = range.replace("bytes=", "").split("-");
    const start = Number(a), end = b ? Number(b) : data.length - 1;
    res.writeHead(206, { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${data.length}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    res.end(data.subarray(start, end + 1));
  } else {
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": data.length, "Accept-Ranges": "bytes" });
    res.end(data);
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}`;
const { chromium } = playwright();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.goto(`${url}/`);
const fps = Number(values.fps);
const times = values.times.split(",").map(Number);
const report = await page.evaluate(
  async ([src, times]) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = src;
    document.body.append(v);
    await new Promise((ok, ko) => {
      v.onloadeddata = ok;
      v.onerror = () => ko(new Error(String(v.error && v.error.message)));
    });
    const shots = [];
    for (const t of times) {
      v.currentTime = t;
      await new Promise((ok) => (v.onseeked = ok));
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d").drawImage(v, 0, 0);
      shots.push({ t, png: c.toDataURL("image/png") });
    }
    const buf = await (await fetch(src)).arrayBuffer();
    const audio = await new AudioContext().decodeAudioData(buf);
    let peak = 0, sum = 0, n = 0;
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const d = audio.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
        sum += d[i] * d[i];
        n++;
      }
    }
    return {
      width: v.videoWidth,
      height: v.videoHeight,
      duration: v.duration,
      audio: { channels: audio.numberOfChannels, rate: audio.sampleRate, seconds: audio.duration, peakDb: 20 * Math.log10(peak), rmsDb: 10 * Math.log10(sum / n) },
      shots,
    };
  },
  [`${url}/film.mp4`, times],
);
for (const shot of report.shots) {
  const file = join(values.out, `decoded-${shot.t.toFixed(2)}.png`);
  writeFileSync(file, Buffer.from(shot.png.split(",")[1], "base64"));
  shot.file = file;
  shot.sourceFrame = Math.floor(shot.t * fps + 1e-6);
  delete shot.png;
}
await browser.close();
server.close();
report.bytes = statSync(values.mp4).size;
writeFileSync(join(values.out, "qa.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));

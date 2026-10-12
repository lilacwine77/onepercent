import { appendFile, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { LAMPORTS_PER_SOL, SERVICES } from "@onepercent/config";
const sampleSchema = z.object({
  time: z.string().datetime({ offset: true }),
  landed_tips_25th_percentile: z.number().finite().nonnegative(),
  landed_tips_50th_percentile: z.number().finite().nonnegative(),
  landed_tips_75th_percentile: z.number().finite().nonnegative(),
  landed_tips_95th_percentile: z.number().finite().nonnegative(),
  landed_tips_99th_percentile: z.number().finite().nonnegative(),
});
export type TipSample = z.infer<typeof sampleSchema>;
// PARAMS §26.3 measurement procedure; these are sampling units, not trade policy.
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export function measuredTip(samples: readonly TipSample[]) {
  const ordered = samples
    .map((s) => sampleSchema.parse(s))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (
    ordered.length < 1441 ||
    Date.parse(ordered.at(-1)!.time) - Date.parse(ordered[0]!.time) < WINDOW_MS
  )
    throw new Error("tip_window_incomplete");
  for (let i = 1; i < ordered.length; i++) {
    const gap = Date.parse(ordered[i]!.time) - Date.parse(ordered[i - 1]!.time);
    if (gap <= 0 || gap > 120_000) throw new Error("tip_window_gap");
  }
  const values = ordered
    .map((s) => s.landed_tips_50th_percentile)
    .sort((a, b) => a - b);
  const median = values[Math.ceil(values.length / 2) - 1]!;
  const floor = SERVICES.landing.tipLamports;
  const lamports =
    Math.ceil(Math.max(floor, median * Number(LAMPORTS_PER_SOL)) / 10_000) *
    10_000;
  if (!Number.isSafeInteger(lamports)) throw new Error("tip_value_invalid");
  return {
    from: ordered[0]!.time,
    to: ordered.at(-1)!.time,
    samples: ordered.length,
    medianSol: median,
    tipLamports: lamports,
  };
}
export async function measureTip(
  file: string,
  configPath?: string,
  signal?: AbortSignal,
) {
  let samples: TipSample[] = [];
  try {
    samples = (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => sampleSchema.parse(JSON.parse(s)));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  while (true) {
    signal?.throwIfAborted();
    const response = await fetch(
      "https://bundles.jito.wtf/api/v1/bundles/tip_floor",
      {
        signal: AbortSignal.any([
          ...(signal ? [signal] : []),
          AbortSignal.timeout(SERVICES.transport.rpcTimeoutMs),
        ]),
      },
    );
    if (!response.ok) throw new Error("tip_provider_unavailable");
    const sample = z
      .array(sampleSchema)
      .min(1)
      .parse(await response.json())
      .at(-1)!;
    if (Math.abs(Date.now() - Date.parse(sample.time)) > 120_000)
      throw new Error("tip_provider_stale");
    if (!samples.some((s) => s.time === sample.time)) {
      samples.push(sample);
      await appendFile(file, JSON.stringify(sample) + "\n");
    }
    if (
      samples.length >= 1441 &&
      Date.parse(samples.at(-1)!.time) - Date.parse(samples[0]!.time) >=
        WINDOW_MS
    ) {
      const result = measuredTip(samples);
      await writeFile(
        `${file}.result.json`,
        JSON.stringify(result, null, 2) + "\n",
      );
      if (configPath) {
        const text = await readFile(configPath, "utf8");
        const pattern =
          /tipLamports: [\d_]+, \/\/ Provisional floor; PENDING K1 24-hour measurement, PARAMS §26\.3/;
        if (!pattern.test(text)) throw new Error("tip_config_changed");
        await writeFile(
          configPath,
          text.replace(
            pattern,
            `tipLamports: ${result.tipLamports.toLocaleString("en-US").replaceAll(",", "_")}, // K1 measured ${result.from} to ${result.to}, PARAMS §26.3`,
          ),
        );
      }
      return result;
    }
    await delay(60_000, undefined, { signal });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [file, flag, path] = process.argv.slice(2);
  if (!file || (flag !== undefined && (flag !== "--write-config" || !path)))
    throw new Error(
      "Usage: tip-measurement <samples.jsonl> [--write-config <services.ts>]",
    );
  console.log(JSON.stringify(await measureTip(file, path)));
}

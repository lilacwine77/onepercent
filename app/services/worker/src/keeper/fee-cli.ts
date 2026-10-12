import { warnCause } from "@onepercent/service-kit";
import { appendFile, open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  JsonRpcClient,
  RpcUnavailable,
  RpcError,
  serviceParams,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { z } from "zod";
import {
  createFeeMeasurementCollector,
  FEE_SAMPLE_INTERVAL_MS,
  readFeeMeasurementJsonl,
  summarizeFeeMeasurement,
} from "./fee-measurement.js";

export function parseFeeCliOptions(argv: readonly string[]) {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      groups: { type: "string" },
      output: { type: "string" },
      once: { type: "boolean" },
      report: { type: "boolean" },
    },
  });
  if (
    !values.output ||
    (!values.report && !values.groups) ||
    (values.report && values.once)
  )
    throw new Error("fee_measurement_usage");
  return {
    output: resolve(values.output),
    groups: values.groups ? resolve(values.groups) : undefined,
    once: values.once ?? false,
    report: values.report ?? false,
  };
}

/** No key loader or transaction sender is reachable from this read-only command. */
export async function runFeeMeasurementCli(
  argv: readonly string[],
  dependencies: {
    rpc?: Pick<ServiceRuntime["rpc"], "request">;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    write?: (text: string) => void;
    now?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  } = {},
) {
  const options = parseFeeCliOptions(argv);
  const read = async () => {
    try {
      return readFeeMeasurementJsonl(await readFile(options.output, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        warnCause("fee_measurement_file_missing", error);
        return [];
      }
      throw error;
    }
  };
  const write =
    dependencies.write ?? ((text: string) => process.stdout.write(text));
  if (options.report) {
    const report = summarizeFeeMeasurement(await read());
    write(`${JSON.stringify(report)}\n`);
    return report;
  }
  const lockPath = `${options.output}.lock`;
  const lock = await open(lockPath, "wx", 0o600);
  try {
    const groups = z
      .array(
        z.object({ name: z.string(), accounts: z.array(z.string()) }).strict(),
      )
      .parse(JSON.parse(await readFile(options.groups!, "utf8")));
    const transport = serviceParams.transport;
    const rpc =
      dependencies.rpc ??
      new JsonRpcClient({
        url: z
          .string()
          .min(1)
          .parse((dependencies.env ?? process.env).RPC_URL),
        timeoutMs: transport.rpcTimeoutMs,
        failureThreshold: transport.breakerFailureThreshold,
        recoverMs: transport.breakerOpenSeconds * 1000,
      });
    const now = dependencies.now ?? Date.now;
    const collector = createFeeMeasurementCollector({
      rpc,
      groups,
      previous: await read(),
      now,
      appendJsonl: (line) =>
        appendFile(options.output, line, { encoding: "utf8", mode: 0o600 }),
    });
    while (!dependencies.signal?.aborted) {
      const previous = collector.records().at(-1);
      if (previous?.kind === "sample") {
        const waitMs =
          (Math.floor(previous.timestampMs / FEE_SAMPLE_INTERVAL_MS) + 1) *
            FEE_SAMPLE_INTERVAL_MS -
          now();
        if (waitMs > 0)
          await (
            dependencies.sleep ??
            ((ms, signal) => delay(ms, undefined, { signal }))
          )(waitMs, dependencies.signal);
      }
      try {
        await collector.sample(dependencies.signal);
      } catch (error) {
        dependencies.signal?.throwIfAborted();
        // Retry transport failures within this minute; only successful samples
        // advance the sampling cursor. Invalid configuration and disk errors stop.
        if (!(error instanceof RpcUnavailable || error instanceof RpcError))
          throw error;
        warnCause("fee_sample_retry", error);
        write(`${JSON.stringify({ reason: "fee_sample_retry" })}\n`);
        await (
          dependencies.sleep ??
          ((ms, signal) => delay(ms, undefined, { signal }))
        )(serviceParams.keeper.backoffBaseMs, dependencies.signal);
        continue;
      }
      const report = summarizeFeeMeasurement(collector.records());
      write(`${JSON.stringify(report)}\n`);
      if (options.once || report.complete) return report;
    }
    return null;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  runFeeMeasurementCli(process.argv.slice(2), {
    signal: controller.signal,
  }).catch((error: unknown) => {
    if (controller.signal.aborted) return;
    // No provider messages, full URLs, environment values or request payloads.
    const code =
      error instanceof Error && /^fee_measurement_[a-z_]+$/.test(error.message)
        ? error.message
        : "fee_measurement_failed";
    warnCause(code, error);
    process.exitCode = 1;
  });
}

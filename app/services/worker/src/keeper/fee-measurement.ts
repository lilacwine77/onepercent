import { warnCause } from "@onepercent/service-kit";
import { MAINNET_GENESIS_HASH } from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { z } from "zod";

// Protocol identity and sampling rules from PARAMS §26.3, not economic settings.
export { MAINNET_GENESIS_HASH };
export const FEE_SAMPLE_INTERVAL_MS = 60_000;
const REQUIRED_WINDOW_MS = 24 * 60 * 60 * 1000;
const ROUNDING_MICRO_LAMPORTS = 10_000n;
const uint = z.number().int().safe().nonnegative();
const address = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch (error) {
    warnCause("fee_measurement_address_invalid", error);
    return false;
  }
}, "invalid_public_key");
const groupSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    accounts: z.array(address).max(128),
  })
  .strict();
const feesSchema = z
  .array(z.object({ slot: uint, prioritizationFee: uint }).strict())
  .min(1);
const headerSchema = z
  .object({
    kind: z.literal("header"),
    version: z.literal(1),
    cluster: z.literal("mainnet-beta"),
    genesisHash: z.literal(MAINNET_GENESIS_HASH),
    groups: z.array(groupSchema).min(2),
  })
  .strict();
const sampleSchema = z
  .object({
    kind: z.literal("sample"),
    timestampMs: uint,
    verifiedAccountsSlot: uint,
    groups: z
      .array(
        groupSchema
          .extend({
            // Exact comparison with the validated header below avoids decoding every key again.
            accounts: z.array(z.string()).max(128),
            fees: feesSchema,
            p75MicroLamports: z.string().regex(/^\d+$/),
          })
          .strict(),
      )
      .min(2),
  })
  .strict();
const recordSchema = z.discriminatedUnion("kind", [headerSchema, sampleSchema]);
export type FeeGroup = z.infer<typeof groupSchema>;
export type FeeMeasurementHeader = z.infer<typeof headerSchema>;
export type FeeMeasurementSample = z.infer<typeof sampleSchema>;
export type FeeMeasurementRecord = FeeMeasurementHeader | FeeMeasurementSample;

function percentile(values: readonly bigint[], percentage: number): bigint {
  if (!values.length) throw new Error("fee_measurement_empty_sample");
  const sorted = [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return sorted[Math.ceil((sorted.length * percentage) / 100) - 1]!;
}

function normalizedGroups(filtered: readonly FeeGroup[]): FeeGroup[] {
  const groups: FeeGroup[] = [{ name: "unfiltered", accounts: [] }];
  for (const group of filtered) {
    groupSchema.parse(group);
    if (
      group.accounts.length === 0 ||
      group.name === "unfiltered" ||
      new Set(group.accounts).size !== group.accounts.length ||
      groups.some((existing) => existing.name === group.name)
    )
      throw new Error("fee_measurement_invalid_groups");
    groups.push({ name: group.name, accounts: [...group.accounts].sort() });
  }
  if (groups.length < 2)
    throw new Error("fee_measurement_pool_accounts_required");
  return [
    groups[0]!,
    ...groups
      .slice(1)
      .sort((left, right) => left.name.localeCompare(right.name)),
  ];
}

function validateHeader(header: FeeMeasurementHeader): FeeMeasurementHeader {
  headerSchema.parse(header);
  const groups = normalizedGroups(
    header.groups.filter((group) => group.name !== "unfiltered"),
  );
  if (JSON.stringify(groups) !== JSON.stringify(header.groups))
    throw new Error("fee_measurement_group_mismatch");
  return header;
}

function validateSample(
  header: FeeMeasurementHeader,
  sample: FeeMeasurementSample,
  previous?: FeeMeasurementSample,
): void {
  if (sample.groups.length !== header.groups.length)
    throw new Error("fee_measurement_group_mismatch");
  sample.groups.forEach((group, index) => {
    const expected = header.groups[index]!;
    if (
      group.name !== expected.name ||
      JSON.stringify(group.accounts) !== JSON.stringify(expected.accounts)
    )
      throw new Error("fee_measurement_group_mismatch");
    if (
      new Set(group.fees.map((entry) => entry.slot)).size !== group.fees.length
    )
      throw new Error("fee_measurement_duplicate_slots");
    const actual = percentile(
      group.fees.map((entry) => BigInt(entry.prioritizationFee)),
      75,
    ).toString();
    if (actual !== group.p75MicroLamports)
      throw new Error("fee_measurement_percentile_mismatch");
  });
  if (
    previous &&
    Math.floor(sample.timestampMs / FEE_SAMPLE_INTERVAL_MS) <=
      Math.floor(previous.timestampMs / FEE_SAMPLE_INTERVAL_MS)
  )
    throw new Error("fee_measurement_too_frequent");
}

/** Full raw responses are retained so p75 and the final p99 remain reproducible. */
export function readFeeMeasurementJsonl(
  source: string,
): FeeMeasurementRecord[] {
  const records = source
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => recordSchema.parse(JSON.parse(line)));
  if (!records.length) return [];
  const [header, ...samples] = records;
  if (header?.kind !== "header")
    throw new Error("fee_measurement_header_required");
  validateHeader(header);
  let previous: FeeMeasurementSample | undefined;
  for (const sample of samples) {
    if (sample.kind !== "sample")
      throw new Error("fee_measurement_duplicate_header");
    validateSample(header, sample, previous);
    previous = sample;
  }
  return records;
}

export function summarizeFeeMeasurement(
  records: readonly FeeMeasurementRecord[],
) {
  const checked = readFeeMeasurementJsonl(
    records.map((record) => JSON.stringify(record)).join("\n"),
  );
  const header = checked[0];
  if (!header || header.kind !== "header")
    throw new Error("fee_measurement_header_required");
  const allSamples = checked.slice(1) as FeeMeasurementSample[];
  let start = 0;
  for (let index = 1; index < allSamples.length; index += 1) {
    if (
      Math.floor(allSamples[index]!.timestampMs / FEE_SAMPLE_INTERVAL_MS) !==
      Math.floor(allSamples[index - 1]!.timestampMs / FEE_SAMPLE_INTERVAL_MS) +
        1
    )
      start = index;
  }
  // A resumed run can recover with a new full window while retaining prior evidence.
  const samples = allSamples.slice(start);
  const first = samples[0];
  const last = samples.at(-1);
  const elapsedMs = first && last ? last.timestampMs - first.timestampMs : 0;
  const continuous = samples.every(
    (sample, index) =>
      index === 0 ||
      Math.floor(sample.timestampMs / FEE_SAMPLE_INTERVAL_MS) ===
        Math.floor(samples[index - 1]!.timestampMs / FEE_SAMPLE_INTERVAL_MS) +
          1,
  );
  const complete =
    elapsedMs >= REQUIRED_WINDOW_MS &&
    continuous &&
    samples.length >= REQUIRED_WINDOW_MS / FEE_SAMPLE_INTERVAL_MS + 1;
  const values = samples.flatMap((sample) =>
    sample.groups.map((group) => BigInt(group.p75MicroLamports)),
  );
  const p99 = values.length ? percentile(values, 99) : null;
  return {
    complete,
    continuous,
    cluster: header.cluster,
    genesisHash: header.genesisHash,
    sampleCount: samples.length,
    totalRecordedSamples: allSamples.length,
    excludedEarlierSamples: start,
    startedAt: first ? new Date(first.timestampMs).toISOString() : null,
    endedAt: last ? new Date(last.timestampMs).toISOString() : null,
    elapsedMs,
    groups: header.groups.map((group) => {
      const values = samples.map((sample) =>
        BigInt(
          sample.groups.find((entry) => entry.name === group.name)!
            .p75MicroLamports,
        ),
      );
      return {
        ...group,
        p50OfP75MicroLamports: values.length
          ? percentile(values, 50).toString()
          : null,
        p75OfP75MicroLamports: values.length
          ? percentile(values, 75).toString()
          : null,
        p99OfP75MicroLamports: values.length
          ? percentile(values, 99).toString()
          : null,
      };
    }),
    p99OfP75MicroLamports: p99?.toString() ?? null,
    // Never publish a candidate cap from a short or interrupted window.
    maxComputeUnitPriceMicroLamports:
      complete && p99 !== null
        ? (
            ((p99 + ROUNDING_MICRO_LAMPORTS - 1n) / ROUNDING_MICRO_LAMPORTS) *
            ROUNDING_MICRO_LAMPORTS
          ).toString()
        : null,
  };
}

export function createFeeMeasurementCollector(options: {
  rpc: Pick<ServiceRuntime["rpc"], "request">;
  /** The launch majors' existing main pool writable accounts; no future PDAs. */
  groups: readonly FeeGroup[];
  previous?: readonly FeeMeasurementRecord[];
  appendJsonl(line: string): Promise<void>;
  now?: () => number;
}) {
  const header: FeeMeasurementHeader = {
    kind: "header",
    version: 1,
    cluster: "mainnet-beta",
    genesisHash: MAINNET_GENESIS_HASH,
    groups: normalizedGroups(options.groups),
  };
  const records = readFeeMeasurementJsonl(
    (options.previous ?? []).map((record) => JSON.stringify(record)).join("\n"),
  );
  if (records.length && JSON.stringify(records[0]) !== JSON.stringify(header))
    throw new Error("fee_measurement_resume_mismatch");
  let running = false;
  return {
    records: (): readonly FeeMeasurementRecord[] => structuredClone(records),
    async sample(signal?: AbortSignal): Promise<FeeMeasurementSample> {
      if (running) throw new Error("fee_measurement_sample_in_progress");
      running = true;
      try {
        signal?.throwIfAborted();
        const timestampMs = uint.parse((options.now ?? Date.now)());
        const previous = records.at(-1);
        if (
          previous?.kind === "sample" &&
          Math.floor(timestampMs / FEE_SAMPLE_INTERVAL_MS) <=
            Math.floor(previous.timestampMs / FEE_SAMPLE_INTERVAL_MS)
        )
          throw new Error("fee_measurement_too_frequent");
        const genesis = await options.rpc.request(
          "getGenesisHash",
          [],
          z.string(),
          signal,
        );
        if (genesis !== MAINNET_GENESIS_HASH)
          throw new Error("fee_measurement_mainnet_required");
        const addresses = [
          ...new Set(header.groups.flatMap((group) => group.accounts)),
        ];
        let verifiedAccountsSlot = 0;
        for (let offset = 0; offset < addresses.length; offset += 100) {
          const batch = addresses.slice(offset, offset + 100);
          const accountProof = await options.rpc.request(
            "getMultipleAccounts",
            [
              batch,
              {
                commitment: "confirmed",
                encoding: "base64",
                dataSlice: { offset: 0, length: 0 },
              },
            ],
            z.object({
              context: z.object({ slot: uint }),
              value: z.array(
                z
                  .object({ executable: z.boolean(), owner: address })
                  .nullable(),
              ),
            }),
            signal,
          );
          if (
            accountProof.value.length !== batch.length ||
            accountProof.value.some(
              (account) => account === null || account.executable,
            )
          )
            throw new Error("fee_measurement_pool_account_unavailable");
          verifiedAccountsSlot = Math.max(
            verifiedAccountsSlot,
            accountProof.context.slot,
          );
        }
        const groups: FeeMeasurementSample["groups"] = [];
        for (const group of header.groups) {
          const fees = await options.rpc.request(
            "getRecentPrioritizationFees",
            group.accounts.length ? [group.accounts] : [],
            feesSchema,
            signal,
          );
          groups.push({
            ...group,
            fees,
            p75MicroLamports: percentile(
              fees.map((entry) => BigInt(entry.prioritizationFee)),
              75,
            ).toString(),
          });
        }
        const sample: FeeMeasurementSample = {
          kind: "sample",
          timestampMs,
          verifiedAccountsSlot,
          groups,
        };
        validateSample(
          header,
          sampleSchema.parse(sample),
          previous?.kind === "sample" ? previous : undefined,
        );
        // A failed/partial network sample never enters the evidence file.
        if (!records.length) {
          await options.appendJsonl(`${JSON.stringify(header)}\n`);
          records.push(header);
        }
        await options.appendJsonl(`${JSON.stringify(sample)}\n`);
        records.push(sample);
        return structuredClone(sample);
      } finally {
        running = false;
      }
    },
  };
}

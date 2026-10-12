import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_1PCT,
  METEORA_BY_CLUSTER,
  ONEPERCENT_PROGRAM_IDS,
} from "@onepercent/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  launchMetadata,
  parseLaunchInput,
  migrationQuoteThreshold,
  requirePinnedLaunchIdentity,
} from "./input.js";

const program = new PublicKey(Buffer.alloc(32, 31)).toBase58();
const base = [
  "plan",
  "--cluster",
  "devnet",
  "--rpc",
  "https://rpc.example.test",
  "--program",
  program,
  "--dbc-config",
  program,
  "--name",
  "Test coin",
  "--symbol",
  "TEST",
  "--uri",
  "https://metadata.example.test/coin",
];
describe("launch CLI input boundary", () => {
  const now = 1_791_504_000;
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(now * 1_000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("parses launch namespace commands and ignores the read-only simulate compatibility flag", () => {
    expect(parseLaunchInput(["launch", ...base, "--simulate"])).toMatchObject({
      command: "plan",
      cluster: "devnet",
      acceptWarnings: false,
    });
    expect(() => parseLaunchInput([...base, "extra"])).toThrow();
    expect(() => parseLaunchInput([...base, "--unknown"])).toThrow();
  });
  it("uses an exact decimal SOL threshold and requires the DBC config identity", () => {
    expect(migrationQuoteThreshold(parseLaunchInput(base))).toBe(
      85_000_000_000n,
    );
    expect(
      migrationQuoteThreshold(
        parseLaunchInput([
          ...base,
          "--migration-threshold-sol",
          "42.000000001",
        ]),
      ),
    ).toBe(42_000_000_001n);
    for (const value of [
      "",
      "0",
      "-1",
      "1e3",
      "0x10",
      "1.0000000001",
      "18446744074",
    ]) {
      expect(() =>
        parseLaunchInput([...base, "--migration-threshold-sol", value]),
      ).toThrow("invalid_launch_arguments");
    }
    expect(() =>
      parseLaunchInput(base.filter((_, i) => i !== 7 && i !== 8)),
    ).toThrow("launch_dbc_config_required");
    expect(
      parseLaunchInput([
        "config",
        "--cluster",
        "devnet",
        "--rpc",
        "https://rpc.example.test",
        "--program",
        program,
        "--wallet",
        "/tmp/operator.json",
      ]).command,
    ).toBe("config");
  });
  it("accepts an explicit config signer only for config creation", () => {
    const config = [
      "config",
      ...base.slice(1),
      "--wallet",
      "/tmp/operator.json",
      "--dbc-config-keypair",
      "/tmp/config.json",
    ];
    expect(parseLaunchInput(config).dbcConfigKeypair).toBe("/tmp/config.json");
    expect(() =>
      parseLaunchInput([...base, "--dbc-config-keypair", "/tmp/config.json"]),
    ).toThrow("launch_config_keypair_requires_config_command");
    expect(() => parseLaunchInput([...config.slice(0, -1), ""])).toThrow(
      "invalid_launch_arguments",
    );
  });
  it("accepts only ten-digit Unix seconds in the permitted scheduling window", () => {
    for (const seconds of [now - 3_600, now, now + 30 * 86_400]) {
      expect(parseLaunchInput([...base, "--at", String(seconds)]).at).toBe(
        seconds,
      );
    }
    expect(parseLaunchInput(base).at).toBeUndefined();
    for (const value of [
      "",
      "0x10",
      "1e3",
      "-1",
      "123456789",
      ` ${now}`,
      `${now} `,
      `${now}.0`,
      String(now * 1_000),
      String(now - 3_601),
      String(now + 30 * 86_400 + 1),
    ]) {
      expect(() => parseLaunchInput([...base, "--at", value])).toThrow(
        "invalid_launch_arguments",
      );
    }
  });
  it("rejects removed bundle simulation options", () => {
    expect(() =>
      parseLaunchInput([
        ...base,
        "--bundle-simulation-rpc",
        "https://simulation.example.test",
      ]),
    ).toThrow("invalid_launch_arguments");
  });
  it("rejects the simulate flag on every command that can mutate state", () => {
    const signers = [
      "--wallet",
      "/tmp/operator.json",
      "--mint-keypair",
      "/tmp/mint.json",
      "--confirm",
      "abcdefgh",
    ];
    for (const command of ["config", "send", "lut", "report"]) {
      expect(() =>
        parseLaunchInput([command, ...base.slice(1), ...signers, "--simulate"]),
      ).toThrow("simulate_flag_requires_read_only_launch_command");
    }
    expect(
      parseLaunchInput(["check", ...base.slice(1), "--simulate"]).command,
    ).toBe("check");
  });
  it("requires explicit mainnet identity and explicit send signers and mint-prefix confirmation", () => {
    const args = [...base];
    args[2] = "mainnet";
    expect(() => parseLaunchInput(args)).toThrow(
      "mainnet_program_identity_required",
    );
    expect(
      parseLaunchInput([...args, "--mainnet-program", program]).mainnetProgram,
    ).toBe(program);
    const send = [...base];
    send[0] = "send";
    expect(() => parseLaunchInput(send)).toThrow(
      "launch_confirmation_and_signers_required",
    );
    expect(
      parseLaunchInput([
        ...send,
        "--wallet",
        "/tmp/operator.json",
        "--mint-keypair",
        "/tmp/mint.json",
        "--confirm",
        "abcdefgh",
      ]).command,
    ).toBe("send");
  });
  it("accepts only HTTPS RPCs or local loopback HTTP without embedded credentials", () => {
    for (const endpoint of [
      "http://rpc.example.test",
      "https://user:secret@rpc.example.test",
      "file:///tmp/rpc",
    ]) {
      const args = [...base];
      args[4] = endpoint;
      expect(() => parseLaunchInput(args)).toThrow("invalid_launch_endpoint");
    }
    const local = [...base];
    local[2] = "localnet";
    local[4] = "http://127.0.0.1:8899";
    expect(parseLaunchInput(local).cluster).toBe("localnet");
    expect(() =>
      parseLaunchInput([...base, "--rehearsal-rpc", "http://rpc.example.test"]),
    ).toThrow("invalid_launch_endpoint");
  });
  it("pins production metadata and refuses reserved branding in every rehearsal context", () => {
    const parsed = parseLaunchInput(base);
    expect(launchMetadata(parsed).symbol).toBe("TEST");
    for (const name of ["Onepercent", "test ONEPERCENT coin", "my 1pct coin"])
      expect(() => launchMetadata({ ...parsed, name })).toThrow(
        "launch_name_forbidden",
      );
    const production = {
      ...parsed,
      cluster: "mainnet" as const,
      program,
      mainnetProgram: program,
      name: undefined,
      symbol: undefined,
    };
    expect(launchMetadata(production)).toMatchObject({
      name: TOKEN_1PCT.name,
      symbol: TOKEN_1PCT.symbol,
    });
    expect(() => launchMetadata({ ...production, name: "Test" })).toThrow(
      "launch_name_forbidden",
    );
    expect(() =>
      launchMetadata({
        ...production,
        mainnetProgram: new PublicKey(Buffer.alloc(32, 32)).toBase58(),
        name: TOKEN_1PCT.name,
        symbol: TOKEN_1PCT.symbol,
      }),
    ).toThrow("launch_name_forbidden");
  });
  it("rejects invalid metadata byte bounds, protocols and empty program identities", () => {
    const input = parseLaunchInput(base);
    for (const override of [
      { uri: "http://metadata.example.test" },
      { uri: "https://u:p@metadata.example.test" },
      { name: "é".repeat(17) },
      { symbol: "a".repeat(14) },
      { uri: `https://example.test/${"x".repeat(200)}` },
    ])
      expect(() => launchMetadata({ ...input, ...override })).toThrow(
        "invalid_launch_metadata",
      );
    expect(() =>
      launchMetadata({ ...input, program: PublicKey.default.toBase58() }),
    ).toThrow("invalid_launch_program");
  });
});

it("binds runtime program IDs and config pins through the selected cluster", () => {
  for (const cluster of ["localnet", "devnet"] as const) {
    const input = {
      cluster,
      program,
      dbcConfig: METEORA_BY_CLUSTER[cluster].dbcConfig,
    };
    const deployment = requirePinnedLaunchIdentity(input);
    expect(deployment.cluster).toBe(cluster);
    expect(deployment.programId.toBase58()).toBe(program);
    expect(deployment.meteora.dbcConfig).toBe(input.dbcConfig);
    expect(() =>
      requirePinnedLaunchIdentity({ ...input, dbcConfig: program }),
    ).toThrow("launch_dbc_config_cluster_pin_mismatch");
  }
  expect(() =>
    requirePinnedLaunchIdentity({
      cluster: "mainnet",
      program,
      dbcConfig: METEORA_BY_CLUSTER.devnet.dbcConfig,
    }),
  ).toThrow(
    ONEPERCENT_PROGRAM_IDS.mainnet === null
      ? "launch_mainnet_program_pending"
      : "launch_mainnet_program_pin_mismatch",
  );
});

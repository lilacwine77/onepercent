import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  METEORA_BY_CLUSTER,
  ONEPERCENT_PROGRAM_IDS,
  type ProgramCluster,
} from "@onepercent/config";
import { createDeploymentSelector } from "../src/deployment.js";
import { EXTERNAL_IDS } from "../src/constants.js";
import { dbcPoolPda, feeInPda, machinePda } from "../src/pda.js";
import { redeemInstruction, takeBackInstruction } from "../src/ix/index.js";
import { powerOnIx } from "../src/ix/powerOn.js";
import { claimLaunchFeesIx } from "../src/ix/claimLaunchFees.js";
import { collectCreatorFeesIx } from "../src/ix/collectCreatorFees.js";

const key = (value: number) => new PublicKey(new Uint8Array(32).fill(value));
const ids = { localnet: key(101), devnet: key(102), mainnet: key(103) };

describe("cluster deployment selection", () => {
  it("ships canonical localnet IDL and event addresses independently of runtime selection", () => {
    const localnet = "DoNH1Cxvv9umyWV9i77LEK4CoqTotDxPRzPxPBzjMJpe";
    for (const path of [
      "../src/idl/onepercent.json",
      "../src/events/m1.json",
      "../src/events/m4.json",
    ]) {
      const artifact = JSON.parse(
        readFileSync(new URL(path, import.meta.url), "utf8"),
      );
      expect(artifact.address).toBe(localnet);
      if (path.includes("/idl/")) {
        const initialize = artifact.instructions.find(
          (instruction: { name: string }) => instruction.name === "initialize",
        );
        expect(
          initialize.accounts.find(
            (account: { name: string }) => account.name === "program",
          ).address,
        ).toBe(localnet);
      }
    }
  });

  it("selects one explicit cluster and normalizes mainnet-beta", () => {
    const select = createDeploymentSelector(ids);
    for (const cluster of ["localnet", "devnet", "mainnet"] as const) {
      expect(select(cluster).cluster).toBe(cluster);
      expect(select(cluster).programId.equals(ids[cluster])).toBe(true);
    }
    expect(select("mainnet-beta").cluster).toBe("mainnet");
    expect(select("mainnet-beta").programId.equals(ids.mainnet)).toBe(true);
    expect(
      select("localnet").programId.equals(select("devnet").programId),
    ).toBe(false);
  });

  it("never supplies a default cluster or a fallback deployment ID", () => {
    const select = createDeploymentSelector({
      localnet: ids.localnet,
      devnet: null,
      mainnet: undefined,
    });
    for (const cluster of [undefined, null, "", "canary", "testnet"])
      expect(() => select(cluster as string)).toThrow();
    expect(() => select("devnet")).toThrow(
      "Program ID is not configured for devnet",
    );
    expect(() => select("mainnet-beta")).toThrow(
      "Program ID is not configured for mainnet",
    );
    expect(() => createDeploymentSelector({ localnet: "invalid" })).toThrow();
  });

  it("defaults to the canonical public program identity map without a mainnet fallback", () => {
    const select = createDeploymentSelector();
    expect(select("localnet").programId.toBase58()).toBe(
      ONEPERCENT_PROGRAM_IDS.localnet,
    );
    expect(select("devnet").programId.toBase58()).toBe(
      ONEPERCENT_PROGRAM_IDS.devnet,
    );
    if (ONEPERCENT_PROGRAM_IDS.mainnet === null)
      expect(() => select("mainnet")).toThrow("Program ID is not configured");
    else
      expect(select("mainnet").programId.toBase58()).toBe(
        ONEPERCENT_PROGRAM_IDS.mainnet,
      );
  });

  it("snapshots the runtime map and keeps selected contexts immutable", () => {
    const source: Partial<Record<ProgramCluster, string | PublicKey | null>> = {
      localnet: ids.localnet,
      devnet: ids.devnet.toBase58(),
    };
    const select = createDeploymentSelector(source);
    source.localnet = key(110);
    delete source.devnet;
    const deployment = select("localnet");
    expect(deployment.programId.equals(ids.localnet)).toBe(true);
    expect(select("devnet").programId.equals(ids.devnet)).toBe(true);
    expect(deployment.programId).not.toBe(deployment.programId);
    const bytes = deployment.programId.toBuffer();
    bytes.fill(0);
    expect(deployment.programId.equals(ids.localnet)).toBe(true);
    expect(Object.isFrozen(deployment)).toBe(true);
    expect(Object.isFrozen(deployment.meteora)).toBe(true);
    expect(() => Object.assign(deployment, { cluster: "devnet" })).toThrow();
    expect(() => Object.assign(deployment, { programId: key(111) })).toThrow();
    expect(() =>
      Object.assign(deployment.meteora, { dbcConfig: key(112).toBase58() }),
    ).toThrow();
    expect(deployment.programId.equals(ids.localnet)).toBe(true);
  });

  it("keeps mainnet selection and existing exits independent of a pending launch pin", () => {
    const deployment = createDeploymentSelector(ids)("mainnet-beta");
    const exit = redeemInstruction(deployment.programId, {
      owner: key(1),
      mint: key(2),
      amount: 1n,
      cardIndex: 0,
      tokenProgram: EXTERNAL_IDS.splToken,
    });
    expect(exit.programId.equals(ids.mainnet)).toBe(true);
    if (METEORA_BY_CLUSTER.mainnet.dbcConfig === "PENDING") {
      expect(deployment.meteoraConfigPin).toBeNull();
      expect(() => deployment.meteora).toThrow("PENDING for mainnet");
      expect(() =>
        powerOnIx(deployment, {
          launchWallet: key(1),
          mint: key(2),
          tokenProgram: EXTERNAL_IDS.splToken,
        }),
      ).toThrow("PENDING for mainnet");
    } else {
      expect(deployment.meteoraConfigPin).toBe(
        METEORA_BY_CLUSTER.mainnet.dbcConfig,
      );
      expect(
        powerOnIx(deployment, {
          launchWallet: key(1),
          mint: key(2),
          tokenProgram: EXTERNAL_IDS.splToken,
        }).programId.equals(ids.mainnet),
      ).toBe(true);
    }
    expect(
      collectCreatorFeesIx(deployment, { payer: key(1) }).programId.equals(
        ids.mainnet,
      ),
    ).toBe(true);
  });

  it.each(["localnet", "devnet"] as const)(
    "binds launch instructions, fee sentinels and pins to the selected %s deployment",
    (cluster) => {
      const deployment = createDeploymentSelector(ids)(cluster);
      const programId = ids[cluster];
      const mint = key(3);
      const expectedConfig = new PublicKey(
        METEORA_BY_CLUSTER[cluster].dbcConfig,
      );
      expect(deployment.meteora.dbcConfig).toBe(expectedConfig.toBase58());
      expect(deployment.meteoraConfigPin).toBe(expectedConfig.toBase58());
      const pool = dbcPoolPda(mint, expectedConfig)[0];
      const launch = powerOnIx(deployment, {
        launchWallet: key(1),
        mint,
        tokenProgram: EXTERNAL_IDS.splToken,
      });
      expect(launch.programId.equals(programId)).toBe(true);
      expect(launch.keys[2]!.pubkey.equals(machinePda(programId)[0])).toBe(
        true,
      );
      expect(launch.keys[4]!.pubkey.equals(pool)).toBe(true);
      expect(launch.keys[5]!.pubkey.equals(expectedConfig)).toBe(true);
      expect(launch.keys[6]!.pubkey.equals(feeInPda(programId)[0])).toBe(true);
      const fees = claimLaunchFeesIx(deployment, {
        kind: "surplus",
        payer: key(1),
        mint,
        baseVault: key(4),
        quoteVault: key(5),
      });
      expect(fees.programId.equals(programId)).toBe(true);
      expect(fees.keys[4]!.pubkey.equals(pool)).toBe(true);
      expect(fees.keys[5]!.pubkey.equals(expectedConfig)).toBe(true);
      expect(
        fees.keys.slice(16).every((meta) => meta.pubkey.equals(programId)),
      ).toBe(true);
      const collect = collectCreatorFeesIx(deployment, { payer: key(1) });
      expect(collect.programId.equals(programId)).toBe(true);
      expect(collect.keys[2]!.pubkey.equals(feeInPda(programId)[0])).toBe(true);
    },
  );
});

it.each(["localnet", "devnet", "mainnet"] as const)(
  "keeps both exit Machine accounts readonly and bound to %s",
  (cluster) => {
    const deployment = createDeploymentSelector(ids)(cluster);
    const common = {
      mint: key(2),
      amount: 1n,
      tokenProgram: EXTERNAL_IDS.splToken,
    };
    const exits = [
      redeemInstruction(deployment.programId, {
        ...common,
        owner: key(1),
        cardIndex: 0,
      }),
      takeBackInstruction(deployment.programId, {
        ...common,
        depositor: key(1),
        deckIndex: 0,
      }),
    ];
    for (const exit of exits) {
      expect(exit.programId.equals(ids[cluster])).toBe(true);
      expect(exit.keys.at(-1)).toEqual({
        pubkey: machinePda(ids[cluster])[0],
        isSigner: false,
        isWritable: false,
      });
    }
  },
);

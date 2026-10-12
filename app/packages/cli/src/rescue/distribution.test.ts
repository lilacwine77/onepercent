import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ONEPERCENT_PROGRAM_IDS } from "@onepercent/config";
import { expect, it } from "vitest";

const run = promisify(execFile);
it("distributes a reproducible standalone rescue CLI that refuses an unpublished mainnet id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rescue-dist-"));
  try {
    const script = fileURLToPath(
      new URL("../../scripts/rescue-bundle.mjs", import.meta.url),
    );
    await run(process.execPath, [script, directory], { cwd: tmpdir() });
    const bytes = await readFile(join(directory, "onepct-rescue.cjs"));
    const manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ) as { sha256: string; reproducibleBuilds: number };
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      manifest.sha256,
    );
    expect(manifest.reproducibleBuilds).toBe(2);
    expect(
      await readFile(join(directory, "onepct-rescue.cjs.sha256"), "utf8"),
    ).toBe(`${manifest.sha256}  onepct-rescue.cjs\n`);
    const help = await run(
      process.execPath,
      [join(directory, "onepct-rescue.cjs"), "--help"],
      { cwd: directory },
    );
    for (const command of [
      "take-back",
      "redeem",
      "withdraw-owed",
      "close-my-cards",
      "settle",
      "refund",
      "close-vaults",
      "crank advance-phase",
      "all",
    ])
      expect(help.stdout).toContain(command);
    const refuse = (cluster: string[]) =>
      expect(
        run(
          process.execPath,
          [
            join(directory, "onepct-rescue.cjs"),
            "status",
            "--rpc",
            "http://127.0.0.1:1",
            ...cluster,
          ],
          { cwd: directory },
        ),
      ).rejects.toMatchObject({
        code: 4,
        stderr: expect.stringContaining(
          "program_id_not_published_use_advanced_program",
        ),
      });
    // No id is guessed: localnet is never published, mainnet is the default.
    await refuse(["--cluster", "localnet"]);
    if (ONEPERCENT_PROGRAM_IDS.mainnet === null) await refuse([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

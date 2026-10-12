import { spawn, execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { createSocket } from "node:dgram";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Keypair } from "@solana/web3.js";

type ProgramAccount = { executable: boolean; owner: string };

// Reserve TCP and UDP together because the validator allocates both protocols.
export async function reservePorts() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const first = randomInt(20_000, 55_000);
    const releases: (() => Promise<void>)[] = [];
    const release = async () => {
      await Promise.all(releases.splice(0).map((close) => close()));
    };
    try {
      for (let port = first; port < first + 40; port++) {
        const tcp = createServer();
        await new Promise<void>((resolve, reject) => {
          tcp.once("error", reject);
          tcp.listen(port, "127.0.0.1", resolve);
        });
        releases.push(
          () => new Promise((resolve) => tcp.close(() => resolve())),
        );
        const udp = createSocket("udp4");
        try {
          await new Promise<void>((resolve, reject) => {
            udp.once("error", reject);
            udp.bind(port, "127.0.0.1", resolve);
          });
        } catch (error) {
          udp.close();
          throw error;
        }
        releases.push(() => new Promise((resolve) => udp.close(resolve)));
      }
      return { first, release };
    } catch {
      await release();
    }
  }
  throw new Error("Cannot reserve local validator ports");
}

// Explicit localhost transport keeps the suite's global fetch guard in place.
function getProgramAccount(port: number, address: string) {
  return new Promise<ProgramAccount | null>((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [address, { encoding: "base64", commitment: "confirmed" }],
    });
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: { "content-type": "application/json" },
        timeout: 1_000,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
          if (text.length > 1_000_000)
            req.destroy(new Error("Validator RPC response is too large"));
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const rpc = JSON.parse(text) as {
              result?: { value: ProgramAccount | null };
              error?: unknown;
            };
            if (response.statusCode !== 200 || rpc.error || !rpc.result)
              throw new Error("Validator RPC did not return account data");
            resolve(rpc.result.value);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.once("error", reject);
    req.once("timeout", () =>
      req.destroy(new Error("Validator RPC timed out")),
    );
    req.end(body);
  });
}

export async function loadProgramWithValidator(
  address: string,
  artifact: string,
): Promise<ProgramAccount> {
  const version = execFileSync("solana-test-validator", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (!/^solana-test-validator 4\.3\.0(?:\s|$)/.test(version))
    throw new Error(
      "The v3 artifact test requires solana-test-validator 4.3.0",
    );

  const ports = await reservePorts();
  let ledger: string | undefined;
  try {
    ledger = await mkdtemp(join(tmpdir(), "onepercent-chain-"));
    await ports.release();
    const child = spawn(
      "solana-test-validator",
      [
        "--ledger",
        ledger,
        "--bind-address",
        "127.0.0.1",
        "--rpc-port",
        String(ports.first),
        "--url",
        `http://127.0.0.1:${ports.first}`,
        "--faucet-port",
        String(ports.first + 2),
        "--gossip-port",
        String(ports.first + 3),
        "--dynamic-port-range",
        `${ports.first + 8}-${ports.first + 40}`,
        "--mint",
        Keypair.generate().publicKey.toBase58(),
        "--upgradeable-program",
        address,
        artifact,
        "none",
        "--quiet",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let closed = false;
    let spawnError: Error | undefined;
    const record = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_000);
    };
    child.stdout.on("data", record);
    child.stderr.on("data", record);
    child.once("error", (error) => {
      spawnError = error;
    });
    const completion = new Promise<void>((resolve) => {
      child.once("close", () => {
        closed = true;
        resolve();
      });
    });
    try {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (closed)
          throw new Error(
            `Local validator exited before readiness:\n${output}`,
          );
        const account = await getProgramAccount(ports.first, address).catch(
          () => null,
        );
        if (account) return account;
        await delay(100);
      }
      throw new Error(
        `Local validator did not load the v3 program:\n${output}`,
      );
    } finally {
      if (!closed) {
        child.kill("SIGTERM");
        const forceStop = setTimeout(() => child.kill("SIGKILL"), 3_000);
        forceStop.unref();
        await completion;
        clearTimeout(forceStop);
      }
    }
  } finally {
    await ports.release();
    if (ledger) await rm(ledger, { recursive: true, force: true });
  }
}

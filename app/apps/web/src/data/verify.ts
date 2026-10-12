import { webDeployment } from "./deployment";
import { PublicKey, type Connection } from "@solana/web3.js";

import { VerifyResponse } from "@onepercent/sdk/api";
import { api } from "./api";
import { loadPullEvidence } from "./pull";
import { requestCallerSeed } from "../chain/verification";
import { verifyModel } from "../adapters/verify";

export async function loadVerify(
  rpc: Connection,
  identifier: string,
  paramsHash: string | null = null,
  programId = webDeployment().programId,
) {
  const isSeq = /^\d+$/.test(identifier);
  const response = isSeq
    ? await api(`/api/verify/${identifier}`, VerifyResponse)
    : null;
  if (response && BigInt(response.seq) !== BigInt(identifier))
    throw new Error("Verify sequence mismatch");
  const address = new PublicKey(response?.pull ?? identifier);
  const evidence = await loadPullEvidence(
    rpc,
    address,
    response ? BigInt(response.seq) : undefined,
    undefined,
    programId,
  );
  if (!evidence) return null;
  const request = evidence.requestSignature
    ? evidence.transactions.get(evidence.requestSignature)
    : undefined;
  if (request) {
    const seed = requestCallerSeed(
      request,
      programId.toBase58(),
      address.toBase58(),
    );
    if (seed) evidence.header = { ...evidence.header, callerSeed: seed };
  }
  const callback = evidence.callbackSignature
    ? evidence.transactions.get(evidence.callbackSignature)
    : undefined;
  return verifyModel(evidence, programId.toBase58(), {
    revealedSlot: callback?.slot ?? response?.revealedSlot ?? null,
    revealOrder:
      response?.revealedSig === evidence.callbackSignature
        ? response.revealOrder
        : null,
    paramsHash,
  });
}

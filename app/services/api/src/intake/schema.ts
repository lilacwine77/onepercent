import { z } from "zod";
import {
  PublicKeyString,
  FeedRefusal as ContractFeedRefusal,
  FeedAttestResponse as ContractFeedAttestResponse,
  createFeedAttestRequest,
} from "@onepercent/sdk/api";
import type { IntakeParams } from "../internal/params.js";

export const publicKeySchema = PublicKeyString;
export const ipHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const feedRefusalSchema = ContractFeedRefusal;
export type FeedRefusal = z.infer<typeof feedRefusalSchema>;
export const feedResponseSchema = ContractFeedAttestResponse;
export const feedBagSchema =
  ContractFeedAttestResponse.shape.attestations.element.shape.bags.element;
export function feedRequestSchema(params: IntakeParams) {
  return createFeedAttestRequest(params.TX_LIMITS);
}
export type FeedAttestResponse = z.infer<typeof feedResponseSchema>;
export type FeedBag = z.infer<typeof feedBagSchema>;

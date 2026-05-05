import { createHash } from "node:crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  NormalizedProofInput,
  ScorePayload,
  SignedScore,
  ValidatorTask,
} from "./types.js";
import { proofDigestHex, reasonCode } from "./scoring.js";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );

  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

export function buildScorePayload(
  task: ValidatorTask,
  validator: string,
  normalizedProof: NormalizedProofInput,
  scoreBps: number,
  scoredAtUnix = Math.floor(Date.now() / 1000),
): ScorePayload {
  return {
    version: 1,
    campaignId: task.campaignId.toString(),
    taskRefHex: task.taskRefHex,
    validator,
    scoreBps,
    reasonCode: reasonCode(normalizedProof, scoreBps),
    proofDigestHex: proofDigestHex(normalizedProof),
    scoredAtUnix,
  };
}

export function serializeScorePayload(payload: ScorePayload): Uint8Array {
  return Buffer.from(canonicalJson(payload), "utf8");
}

export function scorePayloadDigestHex(payload: ScorePayload): string {
  return createHash("sha256")
    .update(serializeScorePayload(payload))
    .digest("hex");
}

export function signScore(payload: ScorePayload, signer: Keypair): SignedScore {
  const serialized = serializeScorePayload(payload);
  const signature = nacl.sign.detached(serialized, signer.secretKey);

  return {
    payload,
    payloadDigestHex: scorePayloadDigestHex(payload),
    signatureBase58: bs58.encode(signature),
    signer: signer.publicKey.toBase58(),
  };
}

export function verifySignedScore(signed: SignedScore): boolean {
  const signer = bs58.decode(signed.signer);
  const signature = bs58.decode(signed.signatureBase58);

  // Payload's declared validator must match the signing key.
  // Without this check an attacker could sign a payload that claims to be
  // from validator B using validator A's key.
  if (signed.payload.validator !== signed.signer) {
    return false;
  }

  if (signed.payloadDigestHex !== scorePayloadDigestHex(signed.payload)) {
    return false;
  }

  return nacl.sign.detached.verify(
    serializeScorePayload(signed.payload),
    signature,
    signer,
  );
}

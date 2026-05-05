import { createHash } from "node:crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  AttestationPayload,
  CampaignTask,
  ProofInput,
  SignedAttestation,
} from "./types.js";

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

export function buildAttestationPayload(
  campaign: CampaignTask,
  proof: ProofInput,
  attestedAtUnix = Math.floor(Date.now() / 1000),
): AttestationPayload {
  return {
    version: 1,
    campaignId: campaign.campaignId.toString(),
    executor: campaign.executor,
    taskRefHex: campaign.taskRefHex,
    action: proof.action,
    platform: proof.platform,
    contentUri: proof.contentUri,
    evidenceDigestHex: proof.evidenceDigestHex,
    attestedAtUnix,
  };
}

export function serializeAttestation(payload: AttestationPayload): Uint8Array {
  return Buffer.from(canonicalJson(payload), "utf8");
}

export function payloadDigestHex(payload: AttestationPayload): string {
  return createHash("sha256")
    .update(serializeAttestation(payload))
    .digest("hex");
}

export function signAttestation(
  payload: AttestationPayload,
  signer: Keypair,
): SignedAttestation {
  const serialized = serializeAttestation(payload);
  const signature = nacl.sign.detached(serialized, signer.secretKey);

  return {
    payload,
    payloadDigestHex: payloadDigestHex(payload),
    signatureBase58: bs58.encode(signature),
    signer: signer.publicKey.toBase58(),
  };
}

export function verifyAttestation(attestation: SignedAttestation): boolean {
  const signer = bs58.decode(attestation.signer);
  const signature = bs58.decode(attestation.signatureBase58);

  if (attestation.payloadDigestHex !== payloadDigestHex(attestation.payload)) {
    return false;
  }

  return nacl.sign.detached.verify(
    serializeAttestation(attestation.payload),
    signature,
    signer,
  );
}

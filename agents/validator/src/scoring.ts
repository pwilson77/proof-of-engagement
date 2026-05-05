import { createHash } from "node:crypto";
import { NormalizedProofInput, RawProofInput } from "./types.js";

const ACTION_BASE_BPS: Record<string, number> = {
  like: 5500,
  repost: 7000,
  retweet: 7000,
  comment: 7600,
  reply: 7600,
  quote: 8000,
  thread: 8200,
};

const PLATFORM_BONUS_BPS: Record<string, number> = {
  x: 100,
  twitter: 100,
  farcaster: 250,
  lens: 200,
};

function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, value));
}

function normalizeUri(input: string): string {
  return input.trim().toLowerCase().replace(/\/+$/, "");
}

function normalizeHex32(input: string): string {
  const cleaned = input.toLowerCase().replace(/^0x/, "").trim();
  if (!/^[0-9a-f]{64}$/.test(cleaned)) {
    throw new Error("evidenceDigestHex must be 32-byte hex");
  }
  return cleaned;
}

export function normalizeProofInput(input: RawProofInput): NormalizedProofInput {
  const metadataEntries = Object.entries(input.metadata ?? {})
    .map(([k, v]) => [k.trim().toLowerCase(), String(v).trim().toLowerCase()] as [string, string])
    .sort(([a], [b]) => a.localeCompare(b));

  return {
    platform: input.platform.trim().toLowerCase(),
    contentUri: normalizeUri(input.contentUri),
    action: input.action.trim().toLowerCase(),
    actor: input.actor.trim().toLowerCase(),
    evidenceDigestHex: normalizeHex32(input.evidenceDigestHex),
    engagementCount: Math.max(0, Math.floor(input.engagementCount ?? 0)),
    createdAtUnix: Math.max(0, Math.floor(input.createdAtUnix ?? 0)),
    metadata: metadataEntries,
  };
}

export function proofDigestHex(input: NormalizedProofInput): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

export function deterministicScoreBps(input: NormalizedProofInput): number {
  const base = ACTION_BASE_BPS[input.action] ?? 5000;
  const platformBonus = PLATFORM_BONUS_BPS[input.platform] ?? 0;

  // Saturating engagement bonus: sqrt keeps growth bounded and deterministic.
  const engagementBonus = Math.min(1600, Math.floor(Math.sqrt(input.engagementCount) * 55));

  const freshnessBonus = input.createdAtUnix > 0 ? 200 : 0;

  const digestNudge = parseInt(input.evidenceDigestHex.slice(0, 2), 16) % 51;

  return clampBps(base + platformBonus + engagementBonus + freshnessBonus + digestNudge);
}

export function reasonCode(input: NormalizedProofInput, scoreBps: number): string {
  const action = input.action || "unknown";
  if (scoreBps >= 8500) {
    return `${action}_high_confidence`;
  }
  if (scoreBps >= 6500) {
    return `${action}_medium_confidence`;
  }
  return `${action}_low_confidence`;
}

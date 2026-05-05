/**
 * Step 9 — Security Hardening: validator / signing / scoring layer
 *
 * Covers:
 *  - Spoof resistance: cross-key signer mismatch rejected
 *  - Spoof resistance: payload.validator ≠ signer rejected
 *  - Replay resistance: campaignId is bound to signature
 *  - Tamper resistance: mutating any field breaks verification
 *  - Digest binding: payloadDigestHex mismatch rejected
 *  - Input sanitisation: normalizeProofInput rejects bad evidenceDigestHex
 */

import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  buildScorePayload,
  signScore,
  verifySignedScore,
  normalizeProofInput,
  ScorePayload,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNormalized() {
  return normalizeProofInput({
    platform: "x",
    contentUri: "https://x.com/alice/status/1",
    action: "like",
    actor: "alice",
    evidenceDigestHex: "ab".repeat(32),
    engagementCount: 10,
    createdAtUnix: 1700000000,
  });
}

function makeTask(campaignId = 42n) {
  return { campaignId, taskRefHex: "cd".repeat(32) };
}

// ---------------------------------------------------------------------------
// Spoof resistance
// ---------------------------------------------------------------------------

describe("Spoof resistance", () => {
  it("rejects a signature made by a different key than payload.validator claims", () => {
    const claimedValidator = Keypair.generate();
    const actualSigner = Keypair.generate(); // different key

    const normalized = makeNormalized();
    const payload = buildScorePayload(
      makeTask(),
      claimedValidator.publicKey.toBase58(), // claims to be from claimedValidator
      normalized,
      7000,
    );

    // Sign with a completely different key
    const signed = signScore(payload, actualSigner);

    // verifySignedScore must reject because signed.signer !== payload.validator
    expect(verifySignedScore(signed)).toBe(false);
  });

  it("rejects when signer field is overwritten to match payload.validator after signing", () => {
    const realValidator = Keypair.generate();
    const impostorValidator = Keypair.generate();

    const normalized = makeNormalized();
    const payload = buildScorePayload(
      makeTask(),
      impostorValidator.publicKey.toBase58(), // payload says impostorValidator
      normalized,
      7000,
    );

    // Sign legitimately as impostorValidator
    const signed = signScore(payload, impostorValidator);

    // An attacker forges the signer field to point to realValidator
    // (pretending realValidator vouched for this score)
    const forged = {
      ...signed,
      signer: realValidator.publicKey.toBase58(),
    };

    // Must fail: nacl signature won't match the substituted key
    expect(verifySignedScore(forged)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Replay resistance
// ---------------------------------------------------------------------------

describe("Replay resistance", () => {
  it("rejects a score signed for campaign A when presented as campaign B", () => {
    const validator = Keypair.generate();
    const normalized = makeNormalized();

    const payloadForA = buildScorePayload(
      makeTask(1n),
      validator.publicKey.toBase58(),
      normalized,
      7000,
    );
    const signedForA = signScore(payloadForA, validator);

    // Attempt replay: swap campaignId in the payload
    const replayPayload: ScorePayload = {
      ...payloadForA,
      campaignId: "2", // campaign B
    };

    const replayAttempt = {
      ...signedForA,
      payload: replayPayload,
    };

    // Digest check will catch it even before nacl.verify
    expect(verifySignedScore(replayAttempt)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tamper resistance
// ---------------------------------------------------------------------------

describe("Tamper resistance", () => {
  it("rejects a score whose scoreBps has been altered after signing", () => {
    const validator = Keypair.generate();
    const normalized = makeNormalized();

    const payload = buildScorePayload(
      makeTask(),
      validator.publicKey.toBase58(),
      normalized,
      5000, // original score
    );
    const signed = signScore(payload, validator);

    // Attacker bumps the score in the payload without re-signing
    const tampered = {
      ...signed,
      payload: { ...payload, scoreBps: 10000 },
    };

    expect(verifySignedScore(tampered)).toBe(false);
  });

  it("rejects when proofDigestHex is altered after signing", () => {
    const validator = Keypair.generate();
    const normalized = makeNormalized();

    const payload = buildScorePayload(
      makeTask(),
      validator.publicKey.toBase58(),
      normalized,
      7000,
    );
    const signed = signScore(payload, validator);

    // Flip one nibble in proofDigestHex without re-signing or updating digest
    const flipped =
      payload.proofDigestHex[0] === "a"
        ? "b" + payload.proofDigestHex.slice(1)
        : "a" + payload.proofDigestHex.slice(1);

    const tampered = {
      ...signed,
      payload: { ...payload, proofDigestHex: flipped },
    };

    expect(verifySignedScore(tampered)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Digest binding
// ---------------------------------------------------------------------------

describe("Digest binding", () => {
  it("rejects when payloadDigestHex doesn't match the payload", () => {
    const validator = Keypair.generate();
    const normalized = makeNormalized();

    const payload = buildScorePayload(
      makeTask(),
      validator.publicKey.toBase58(),
      normalized,
      7000,
    );
    const signed = signScore(payload, validator);

    // Supply a stale / forged digest hex while keeping the payload intact
    const tampered = {
      ...signed,
      payloadDigestHex: "00".repeat(32),
    };

    expect(verifySignedScore(tampered)).toBe(false);
  });

  it("accepts a validly signed score", () => {
    const validator = Keypair.generate();
    const normalized = makeNormalized();

    const payload = buildScorePayload(
      makeTask(),
      validator.publicKey.toBase58(),
      normalized,
      7000,
    );
    const signed = signScore(payload, validator);

    expect(verifySignedScore(signed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Input sanitisation
// ---------------------------------------------------------------------------

describe("Input sanitisation", () => {
  it("throws on non-hex evidenceDigestHex", () => {
    expect(() =>
      normalizeProofInput({
        platform: "x",
        contentUri: "https://x.com/a/status/1",
        action: "like",
        actor: "a",
        evidenceDigestHex: "not-valid-hex",
        engagementCount: 0,
        createdAtUnix: 0,
      }),
    ).toThrow("evidenceDigestHex must be 32-byte hex");
  });

  it("throws on evidenceDigestHex that is correct hex but wrong length", () => {
    expect(() =>
      normalizeProofInput({
        platform: "x",
        contentUri: "https://x.com/a/status/1",
        action: "like",
        actor: "a",
        evidenceDigestHex: "ab".repeat(16), // 32 hex chars = 16 bytes, not 32
        engagementCount: 0,
        createdAtUnix: 0,
      }),
    ).toThrow("evidenceDigestHex must be 32-byte hex");
  });

  it("clamps negative engagementCount to 0", () => {
    const proof = normalizeProofInput({
      platform: "x",
      contentUri: "https://x.com/a/status/1",
      action: "like",
      actor: "a",
      evidenceDigestHex: "ab".repeat(32),
      engagementCount: -999,
      createdAtUnix: 0,
    });
    expect(proof.engagementCount).toBe(0);
  });
});

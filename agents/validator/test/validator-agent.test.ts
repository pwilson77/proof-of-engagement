import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  deterministicScoreBps,
  normalizeProofInput,
  signScore,
  buildScorePayload,
  ValidatorAgent,
  verifySignedScore,
  ScoreSubmissionClient,
} from "../src/index.js";

describe("Validator scoring", () => {
  const rawProof = {
    platform: "X",
    contentUri: "https://x.com/Foo/Status/12345/",
    action: "ReTweet",
    actor: "Alice  ",
    evidenceDigestHex: "aa".repeat(32),
    engagementCount: 121,
    createdAtUnix: 1700000000,
    metadata: {
      Topic: "Solana",
      verified: true,
    },
  };

  it("normalizes proof input deterministically", () => {
    const normalized = normalizeProofInput(rawProof);

    expect(normalized.platform).toBe("x");
    expect(normalized.action).toBe("retweet");
    expect(normalized.actor).toBe("alice");
    expect(normalized.contentUri).toBe("https://x.com/foo/status/12345");
    expect(normalized.metadata).toEqual([
      ["topic", "solana"],
      ["verified", "true"],
    ]);
  });

  it("returns identical score for identical normalized input", () => {
    const normalized = normalizeProofInput(rawProof);
    const scores = Array.from({ length: 5 }, () => deterministicScoreBps(normalized));

    expect(new Set(scores).size).toBe(1);
    expect(scores[0]).toBeGreaterThanOrEqual(0);
    expect(scores[0]).toBeLessThanOrEqual(10_000);
  });

  it("signs and verifies score payload", () => {
    const signer = Keypair.generate();
    const normalized = normalizeProofInput(rawProof);
    const scoreBps = deterministicScoreBps(normalized);
    const payload = buildScorePayload(
      { campaignId: 12n, taskRefHex: "11".repeat(32) },
      signer.publicKey.toBase58(),
      normalized,
      scoreBps,
      1700000010,
    );

    const signed = signScore(payload, signer);

    expect(signed.payload.campaignId).toBe("12");
    expect(signed.payload.scoreBps).toBe(scoreBps);
    expect(verifySignedScore(signed)).toBe(true);
  });
});

describe("ValidatorAgent", () => {
  it("normalizes, scores, signs and submits via client", async () => {
    const signer = Keypair.generate();
    const submissions: Array<{ campaignId: bigint; scoreBps: number; signer: string }> = [];

    const client: ScoreSubmissionClient = {
      async submitValidatorScore(request) {
        submissions.push({
          campaignId: request.campaignId,
          scoreBps: request.scoreBps,
          signer: request.signedScore.signer,
        });

        return {
          txSignature: "mock-score-submit-tx",
          submittedAtUnix: 1700000100,
        };
      },
    };

    const agent = new ValidatorAgent({ signer, submissionClient: client });

    const result = await agent.validateAndSubmit(
      {
        campaignId: 222n,
        taskRefHex: "22".repeat(32),
      },
      {
        platform: "farcaster",
        contentUri: "https://warpcast.com/example/123",
        action: "reply",
        actor: "validator-user",
        evidenceDigestHex: "bb".repeat(32),
        engagementCount: 64,
        createdAtUnix: 1700000000,
      },
    );

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      campaignId: 222n,
      signer: signer.publicKey.toBase58(),
    });
    expect(result.receipt.txSignature).toBe("mock-score-submit-tx");
    expect(result.scoreBps).toBe(submissions[0]?.scoreBps);
    expect(verifySignedScore(result.signedScore)).toBe(true);
  });
});

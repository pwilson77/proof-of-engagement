import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  buildAttestationPayload,
  ClaimStore,
  ExecutorAgent,
  SettlementClient,
  signAttestation,
  verifyAttestation,
} from "../src/index.js";

describe("ClaimStore", () => {
  it("prevents double-claim on same campaign", () => {
    const store = new ClaimStore();
    const handle = store.claim(42n, 1700000000);

    expect(store.isClaimed(42n)).toBe(true);
    expect(() => store.claim(42n, 1700000001)).toThrow(/already claimed/);

    handle.release();
    expect(store.isClaimed(42n)).toBe(false);
  });
});

describe("Attestation", () => {
  it("builds deterministic payload and valid signature", () => {
    const signer = Keypair.generate();
    const payload = buildAttestationPayload(
      {
        campaignId: 7n,
        executor: signer.publicKey.toBase58(),
        taskRefHex: "ab".repeat(32),
      },
      {
        platform: "x",
        contentUri: "https://x.com/post/123",
        action: "retweet",
        evidenceDigestHex: "cd".repeat(32),
      },
      1700000000,
    );

    const signed = signAttestation(payload, signer);

    expect(signed.payload.campaignId).toBe("7");
    expect(signed.payload.attestedAtUnix).toBe(1700000000);
    expect(verifyAttestation(signed)).toBe(true);
  });
});

describe("ExecutorAgent", () => {
  it("claims, signs, submits and releases claim", async () => {
    const signer = Keypair.generate();
    const claimStore = new ClaimStore();
    const calls: Array<{ campaignId: bigint; signer: string }> = [];

    const settlementClient: SettlementClient = {
      async submitExecutorAttestation(request) {
        calls.push({
          campaignId: request.campaignId,
          signer: request.signedAttestation.signer,
        });

        return {
          txSignature: "mock-tx-signature",
          submittedAtUnix: 1700000005,
        };
      },
    };

    const agent = new ExecutorAgent({ signer, settlementClient, claimStore });

    const result = await agent.executeCampaign(
      {
        campaignId: 99n,
        executor: signer.publicKey.toBase58(),
        taskRefHex: "ef".repeat(32),
      },
      {
        platform: "farcaster",
        contentUri: "https://warpcast.com/example",
        action: "reply",
        evidenceDigestHex: "12".repeat(32),
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.campaignId).toBe(99n);
    expect(calls[0]?.signer).toBe(signer.publicKey.toBase58());
    expect(result.receipt.txSignature).toBe("mock-tx-signature");
    expect(verifyAttestation(result.attestation)).toBe(true);
    expect(claimStore.isClaimed(99n)).toBe(false);
  });
});

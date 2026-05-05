/**
 * Step 9 — Security Hardening: consensus layer
 *
 * Covers:
 *  - Timeout boundary: exactly at deadline → no refund triggered
 *  - Timeout boundary: one second past deadline → refund triggered
 *  - Partial validator failure: exactly minValidators succeed → proceeds
 *  - Partial validator failure: below minValidators → insufficient_responses
 *  - Average flooring: matches on-chain floor(sum/count)
 *  - Zero validators rejected at construction
 */

import { describe, expect, it, vi } from "vitest";
import { ConsensusOrchestrator } from "../src/consensus-orchestrator.js";
import type { SettlementTriggerClient, SettleTxReceipt } from "../src/types.js";
import type {
  ValidatorAgent,
  ValidateAndSubmitResult,
  RawProofInput,
  ValidatorTask,
} from "@poe/validator-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = 99n;

const TASK: ValidatorTask = {
  campaignId: CAMPAIGN_ID,
  taskRefHex: "ef".repeat(32),
};

const RAW_PROOF: RawProofInput = {
  platform: "x",
  contentUri: "https://x.com/bob/status/9",
  action: "like",
  actor: "bob",
  evidenceDigestHex: "bb".repeat(32),
  engagementCount: 50,
  createdAtUnix: 1700000000,
};

function makeValidator(pubkey: string, scoreBps: number): ValidatorAgent {
  const result: ValidateAndSubmitResult = {
    scoreBps,
    signedScore: {
      payload: {
        version: 1,
        campaignId: String(CAMPAIGN_ID),
        taskRefHex: TASK.taskRefHex,
        validator: pubkey,
        scoreBps,
        reasonCode: "ok",
        proofDigestHex: "00".repeat(32),
        scoredAtUnix: 1700000100,
      },
      payloadDigestHex: "00".repeat(32),
      signatureBase58: "fakeSig",
      signer: pubkey,
    },
    receipt: { txSignature: `tx-${pubkey}`, submittedAtUnix: 1700000100 },
  };
  return {
    validateAndSubmit: vi.fn().mockResolvedValue(result),
  } as unknown as ValidatorAgent;
}

function makeFailingValidator(pubkey: string): ValidatorAgent {
  return {
    validateAndSubmit: vi
      .fn()
      .mockRejectedValue(new Error(`${pubkey} unavailable`)),
  } as unknown as ValidatorAgent;
}

function makeTriggerClient(): {
  client: SettlementTriggerClient;
  successCalls: bigint[];
  timeoutCalls: bigint[];
} {
  const successCalls: bigint[] = [];
  const timeoutCalls: bigint[] = [];
  const receipt: SettleTxReceipt = {
    txSignature: "settle-tx",
    settledAtUnix: 1700001000,
  };

  const client: SettlementTriggerClient = {
    triggerSettleSuccess: vi.fn().mockImplementation((id) => {
      successCalls.push(id);
      return Promise.resolve(receipt);
    }),
    triggerTimeoutRefund: vi.fn().mockImplementation((id) => {
      timeoutCalls.push(id);
      return Promise.resolve(receipt);
    }),
  };

  return { client, successCalls, timeoutCalls };
}

// ---------------------------------------------------------------------------
// Timeout boundary
// ---------------------------------------------------------------------------

describe("Timeout boundary", () => {
  it("does NOT trigger refund when now === deadline (not yet expired)", async () => {
    const { client, timeoutCalls } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [makeValidator("v1", 7000)],
      settlementTrigger: client,
    });

    const deadline = 1800000000;
    // now === deadline: not expired
    const result = await orchestrator.checkAndSettleTimeout(
      CAMPAIGN_ID,
      deadline,
      deadline, // nowUnix exactly equals deadline
    );

    expect(result.status).toBe("not_expired");
    expect(timeoutCalls).toHaveLength(0);
  });

  it("triggers refund when now === deadline + 1 (one second past)", async () => {
    const { client, timeoutCalls } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [makeValidator("v1", 7000)],
      settlementTrigger: client,
    });

    const deadline = 1800000000;
    const result = await orchestrator.checkAndSettleTimeout(
      CAMPAIGN_ID,
      deadline,
      deadline + 1,
    );

    expect(result.status).toBe("refund_triggered");
    expect(timeoutCalls).toHaveLength(1);
    expect(timeoutCalls[0]).toBe(CAMPAIGN_ID);
  });

  it("does NOT trigger refund when now is far in the past (deadline far in future)", async () => {
    const { client, timeoutCalls } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [makeValidator("v1", 7000)],
      settlementTrigger: client,
    });

    const result = await orchestrator.checkAndSettleTimeout(
      CAMPAIGN_ID,
      9999999999, // deadline far in the future
      1700000000,
    );

    expect(result.status).toBe("not_expired");
    expect(timeoutCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Partial validator failure
// ---------------------------------------------------------------------------

describe("Partial validator failure", () => {
  it("succeeds when exactly minValidators respond (2 of 3 needed)", async () => {
    const { client, successCalls } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [
        makeValidator("v1", 7000),
        makeValidator("v2", 8000),
        makeFailingValidator("v3"), // one fails
      ],
      settlementTrigger: client,
      minValidators: 2,
    });

    const result = await orchestrator.runConsensus(
      TASK,
      RAW_PROOF,
      6000, // threshold
      ["v1", "v2", "v3"],
    );

    // floor((7000 + 8000) / 2) = 7500 >= 6000
    expect(result.status).toBe("settled_success");
    if (result.status === "settled_success") {
      expect(result.averageScoreBps).toBe(7500);
    }
    expect(successCalls).toHaveLength(1);
  });

  it("returns insufficient_responses when fewer than minValidators succeed", async () => {
    const { client, successCalls } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [
        makeValidator("v1", 7000),
        makeFailingValidator("v2"),
        makeFailingValidator("v3"),
      ],
      settlementTrigger: client,
      minValidators: 2, // need 2, only 1 succeeds
    });

    const result = await orchestrator.runConsensus(TASK, RAW_PROOF, 5000, [
      "v1",
      "v2",
      "v3",
    ]);

    expect(result.status).toBe("insufficient_responses");
    if (result.status === "insufficient_responses") {
      expect(result.successCount).toBe(1);
      expect(result.minRequired).toBe(2);
    }
    expect(successCalls).toHaveLength(0);
  });

  it("returns below_threshold when partial responses average is still too low", async () => {
    const { client } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [
        makeValidator("v1", 4000),
        makeValidator("v2", 4500),
        makeFailingValidator("v3"),
      ],
      settlementTrigger: client,
      minValidators: 2,
    });

    const result = await orchestrator.runConsensus(
      TASK,
      RAW_PROOF,
      6000, // threshold 60%
      ["v1", "v2", "v3"],
    );

    // floor((4000 + 4500) / 2) = 4250 < 6000
    expect(result.status).toBe("below_threshold");
    if (result.status === "below_threshold") {
      expect(result.averageScoreBps).toBe(4250);
    }
  });
});

// ---------------------------------------------------------------------------
// Average flooring (mirrors on-chain)
// ---------------------------------------------------------------------------

describe("Average score flooring", () => {
  it("floors fractional average to match on-chain behavior", async () => {
    const { client } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [makeValidator("v1", 5000), makeValidator("v2", 7001)],
      settlementTrigger: client,
    });

    const result = await orchestrator.runConsensus(
      TASK,
      RAW_PROOF,
      5000, // threshold at exactly the floored value
      ["v1", "v2"],
    );

    // floor((5000 + 7001) / 2) = floor(6000.5) = 6000
    expect(result.status).toBe("settled_success");
    if (result.status === "settled_success") {
      expect(result.averageScoreBps).toBe(6000);
    }
  });

  it("treats all-zero scores correctly (floor(0/N) = 0)", async () => {
    const { client } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [makeValidator("v1", 0), makeValidator("v2", 0)],
      settlementTrigger: client,
    });

    const result = await orchestrator.runConsensus(
      TASK,
      RAW_PROOF,
      1, // threshold > 0
      ["v1", "v2"],
    );

    expect(result.status).toBe("below_threshold");
    if (result.status === "below_threshold") {
      expect(result.averageScoreBps).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Constructor guard
// ---------------------------------------------------------------------------

describe("Constructor guard", () => {
  it("throws when no validators are provided", () => {
    const { client } = makeTriggerClient();
    expect(
      () =>
        new ConsensusOrchestrator({
          validators: [],
          settlementTrigger: client,
        }),
    ).toThrow("at least one validator");
  });
});

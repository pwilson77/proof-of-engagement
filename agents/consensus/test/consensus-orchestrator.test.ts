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
// Test helpers
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = 1n;

const TASK: ValidatorTask = {
  campaignId: CAMPAIGN_ID,
  taskRefHex: "ab".repeat(32),
};

const RAW_PROOF: RawProofInput = {
  platform: "X",
  contentUri: "https://x.com/user/status/1",
  action: "retweet",
  actor: "alice",
  evidenceDigestHex: "aa".repeat(32),
  engagementCount: 100,
  createdAtUnix: 1700000000,
};

const THRESHOLD_BPS = 5_000; // 50%

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
      .mockRejectedValue(new Error(`validator ${pubkey} unavailable`)),
  } as unknown as ValidatorAgent;
}

function makeTriggerClient(): {
  client: SettlementTriggerClient;
  successCalls: Array<{ campaignId: bigint; scoreAccounts: unknown[] }>;
  timeoutCalls: bigint[];
} {
  const successCalls: Array<{ campaignId: bigint; scoreAccounts: unknown[] }> =
    [];
  const timeoutCalls: bigint[] = [];

  const receipt: SettleTxReceipt = {
    txSignature: "settle-tx",
    settledAtUnix: 1700000200,
  };

  const client: SettlementTriggerClient = {
    triggerSettleSuccess: vi
      .fn()
      .mockImplementation(async (campaignId, scoreAccounts) => {
        successCalls.push({ campaignId, scoreAccounts });
        return receipt;
      }),
    triggerTimeoutRefund: vi.fn().mockImplementation(async (campaignId) => {
      timeoutCalls.push(campaignId);
      return receipt;
    }),
  };

  return { client, successCalls, timeoutCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConsensusOrchestrator – runConsensus", () => {
  it("settles success when 3/3 validators score above threshold", async () => {
    const pubkeys = ["V1pub", "V2pub", "V3pub"];
    const validators = [
      makeValidator(pubkeys[0]!, 8_000),
      makeValidator(pubkeys[1]!, 7_000),
      makeValidator(pubkeys[2]!, 9_000),
    ];
    const { client, successCalls } = makeTriggerClient();

    const orchestrator = new ConsensusOrchestrator({
      validators,
      settlementTrigger: client,
    });
    const outcome = await orchestrator.runConsensus(
      TASK,
      RAW_PROOF,
      THRESHOLD_BPS,
      pubkeys,
    );

    expect(outcome.status).toBe("settled_success");
    if (outcome.status === "settled_success") {
      // floor((8000 + 7000 + 9000) / 3) = floor(24000/3) = 8000
      expect(outcome.averageScoreBps).toBe(8_000);
      expect(outcome.receipt.txSignature).toBe("settle-tx");
      expect(outcome.validatorOutcomes).toHaveLength(3);
      expect(outcome.validatorOutcomes.every((o) => o.status === "ok")).toBe(
        true,
      );
    }

    expect(successCalls).toHaveLength(1);
    expect(successCalls[0]!.campaignId).toBe(CAMPAIGN_ID);
    expect(successCalls[0]!.scoreAccounts).toHaveLength(3);
  });

  it("returns below_threshold and does NOT trigger settlement when scores are low", async () => {
    const pubkeys = ["V1pub", "V2pub", "V3pub"];
    const validators = [
      makeValidator(pubkeys[0]!, 2_000),
      makeValidator(pubkeys[1]!, 1_000),
      makeValidator(pubkeys[2]!, 3_000),
    ];
    const { client, successCalls } = makeTriggerClient();

    const orchestrator = new ConsensusOrchestrator({
      validators,
      settlementTrigger: client,
    });
    const outcome = await orchestrator.runConsensus(
      TASK,
      RAW_PROOF,
      THRESHOLD_BPS,
      pubkeys,
    );

    expect(outcome.status).toBe("below_threshold");
    if (outcome.status === "below_threshold") {
      // floor((2000 + 1000 + 3000) / 3) = floor(6000/3) = 2000
      expect(outcome.averageScoreBps).toBe(2_000);
      expect(outcome.thresholdBps).toBe(THRESHOLD_BPS);
    }
    expect(successCalls).toHaveLength(0);
    expect(client.triggerSettleSuccess).not.toHaveBeenCalled();
  });

  it("still settles when 2/3 validators respond and 1 fails (minValidators=2)", async () => {
    const pubkeys = ["V1pub", "V2pub", "V3pub"];
    const validators = [
      makeValidator(pubkeys[0]!, 8_000),
      makeFailingValidator(pubkeys[1]!),
      makeValidator(pubkeys[2]!, 6_000),
    ];
    const { client, successCalls } = makeTriggerClient();

    const orchestrator = new ConsensusOrchestrator({
      validators,
      settlementTrigger: client,
      minValidators: 2,
    });
    const outcome = await orchestrator.runConsensus(
      TASK,
      RAW_PROOF,
      THRESHOLD_BPS,
      pubkeys,
    );

    expect(outcome.status).toBe("settled_success");
    if (outcome.status === "settled_success") {
      // floor((8000 + 6000) / 2) = 7000
      expect(outcome.averageScoreBps).toBe(7_000);
      // Only 2 score accounts — the failing validator is excluded
      expect(
        outcome.validatorOutcomes.filter((o) => o.status === "ok"),
      ).toHaveLength(2);
      expect(
        outcome.validatorOutcomes.filter((o) => o.status === "error"),
      ).toHaveLength(1);
    }
    expect(successCalls[0]!.scoreAccounts).toHaveLength(2);
  });

  it("returns insufficient_responses when too many validators fail", async () => {
    const pubkeys = ["V1pub", "V2pub", "V3pub"];
    const validators = [
      makeValidator(pubkeys[0]!, 9_000),
      makeFailingValidator(pubkeys[1]!),
      makeFailingValidator(pubkeys[2]!),
    ];
    const { client } = makeTriggerClient();

    // Default minValidators = 3, only 1 succeeds
    const orchestrator = new ConsensusOrchestrator({
      validators,
      settlementTrigger: client,
    });
    const outcome = await orchestrator.runConsensus(
      TASK,
      RAW_PROOF,
      THRESHOLD_BPS,
      pubkeys,
    );

    expect(outcome.status).toBe("insufficient_responses");
    if (outcome.status === "insufficient_responses") {
      expect(outcome.successCount).toBe(1);
      expect(outcome.minRequired).toBe(3);
    }
    expect(client.triggerSettleSuccess).not.toHaveBeenCalled();
  });
});

describe("ConsensusOrchestrator – checkAndSettleTimeout", () => {
  it("triggers timeout refund when now is past deadline", async () => {
    const { client, timeoutCalls } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [makeValidator("V1pub", 9_000)],
      settlementTrigger: client,
    });

    const deadlineUnix = 1_700_000_000;
    const nowUnix = deadlineUnix + 1;

    const outcome = await orchestrator.checkAndSettleTimeout(
      CAMPAIGN_ID,
      deadlineUnix,
      nowUnix,
    );

    expect(outcome.status).toBe("refund_triggered");
    if (outcome.status === "refund_triggered") {
      expect(outcome.receipt.txSignature).toBe("settle-tx");
    }
    expect(timeoutCalls).toHaveLength(1);
    expect(timeoutCalls[0]).toBe(CAMPAIGN_ID);
  });

  it("does NOT trigger refund when deadline has not passed", async () => {
    const { client, timeoutCalls } = makeTriggerClient();
    const orchestrator = new ConsensusOrchestrator({
      validators: [makeValidator("V1pub", 9_000)],
      settlementTrigger: client,
    });

    const deadlineUnix = 1_700_000_000;
    const nowUnix = deadlineUnix - 100;

    const outcome = await orchestrator.checkAndSettleTimeout(
      CAMPAIGN_ID,
      deadlineUnix,
      nowUnix,
    );

    expect(outcome.status).toBe("not_expired");
    if (outcome.status === "not_expired") {
      expect(outcome.nowUnix).toBe(nowUnix);
      expect(outcome.deadlineUnix).toBe(deadlineUnix);
    }
    expect(timeoutCalls).toHaveLength(0);
  });
});

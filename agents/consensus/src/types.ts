import type { ValidateAndSubmitResult } from "@poe/validator-agent";

export type CampaignId = bigint;

/** Identifies an on-chain validator score account for a given campaign + validator. */
export interface ScoreAccountRef {
  campaignId: CampaignId;
  validatorPubkey: string;
}

/**
 * Client interface for triggering on-chain settlement instructions.
 * Implementations can target a local test validator, devnet, or mainnet.
 */
export interface SettlementTriggerClient {
  /**
   * Trigger `settle_success` on-chain.
   * Called when the average score meets the threshold.
   */
  triggerSettleSuccess(
    campaignId: CampaignId,
    scoreAccounts: ScoreAccountRef[],
  ): Promise<SettleTxReceipt>;

  /**
   * Trigger `settle_timeout_refund` on-chain.
   * Called when the campaign deadline has passed.
   */
  triggerTimeoutRefund(campaignId: CampaignId): Promise<SettleTxReceipt>;
}

export interface SettleTxReceipt {
  txSignature: string;
  settledAtUnix: number;
}

/** Per-validator result, including whether it succeeded or failed. */
export type ValidatorOutcome =
  | { status: "ok"; result: ValidateAndSubmitResult; validatorPubkey: string }
  | { status: "error"; error: unknown; validatorPubkey: string };

/** The outcome of a consensus round. */
export type ConsensusOutcome =
  | {
      status: "settled_success";
      averageScoreBps: number;
      validatorOutcomes: ValidatorOutcome[];
      receipt: SettleTxReceipt;
    }
  | {
      status: "below_threshold";
      averageScoreBps: number;
      thresholdBps: number;
      validatorOutcomes: ValidatorOutcome[];
    }
  | {
      status: "insufficient_responses";
      successCount: number;
      minRequired: number;
      validatorOutcomes: ValidatorOutcome[];
    };

/** The outcome of a timeout-refund check. */
export type TimeoutOutcome =
  | { status: "refund_triggered"; receipt: SettleTxReceipt }
  | { status: "not_expired"; nowUnix: number; deadlineUnix: number };

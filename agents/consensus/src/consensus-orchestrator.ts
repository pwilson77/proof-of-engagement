import type {
  ValidatorAgent,
  RawProofInput,
  ValidatorTask,
} from "@poe/validator-agent";
import type {
  CampaignId,
  ConsensusOutcome,
  ScoreAccountRef,
  SettlementTriggerClient,
  TimeoutOutcome,
  ValidatorOutcome,
} from "./types.js";

export interface ConsensusOrchestratorConfig {
  /** Ordered list of validator agents to fan out to. */
  validators: ValidatorAgent[];
  /** Client that submits settlement instructions on-chain. */
  settlementTrigger: SettlementTriggerClient;
  /**
   * Minimum number of successful validator responses required before
   * settlement can proceed. Defaults to all validators.
   */
  minValidators?: number;
}

/**
 * ConsensusOrchestrator fans proof input out to N validator agents in parallel,
 * aggregates their signed scores, and automatically triggers on-chain settlement
 * when the average score meets the campaign threshold.
 *
 * This mirrors the on-chain `settle_success` averaging logic:
 *   average_bps = floor(sum(score_bps) / count)
 */
export class ConsensusOrchestrator {
  private readonly validators: ValidatorAgent[];
  private readonly settlementTrigger: SettlementTriggerClient;
  private readonly minValidators: number;

  constructor(config: ConsensusOrchestratorConfig) {
    if (config.validators.length === 0) {
      throw new Error("ConsensusOrchestrator requires at least one validator");
    }
    this.validators = config.validators;
    this.settlementTrigger = config.settlementTrigger;
    this.minValidators = config.minValidators ?? config.validators.length;
  }

  /**
   * Fan out to all validators, aggregate scores, and trigger settlement if met.
   *
   * @param task       Validator task metadata (campaignId + taskRefHex).
   * @param rawProof   The proof input each validator will score independently.
   * @param thresholdBps  Campaign threshold in basis points (0–10000).
   * @param validatorPubkeys  Ordered list matching `this.validators`, used to build
   *                          score account references for the settlement instruction.
   */
  async runConsensus(
    task: ValidatorTask,
    rawProof: RawProofInput,
    thresholdBps: number,
    validatorPubkeys: string[],
  ): Promise<ConsensusOutcome> {
    if (validatorPubkeys.length !== this.validators.length) {
      throw new Error(
        `validatorPubkeys length (${validatorPubkeys.length}) must match validators length (${this.validators.length})`,
      );
    }

    // Fan out in parallel; collect all results, including failures.
    const settled = await Promise.allSettled(
      this.validators.map((v) => v.validateAndSubmit(task, rawProof)),
    );

    const outcomes: ValidatorOutcome[] = settled.map((result, i) => {
      const validatorPubkey = validatorPubkeys[i]!;
      if (result.status === "fulfilled") {
        return { status: "ok", result: result.value, validatorPubkey };
      } else {
        return { status: "error", error: result.reason, validatorPubkey };
      }
    });

    const successes = outcomes.filter((o) => o.status === "ok");

    if (successes.length < this.minValidators) {
      return {
        status: "insufficient_responses",
        successCount: successes.length,
        minRequired: this.minValidators,
        validatorOutcomes: outcomes,
      };
    }

    // Average matches on-chain logic: floor(sum / count)
    const sum = successes.reduce((acc, o) => {
      return (
        acc + (o as Extract<ValidatorOutcome, { status: "ok" }>).result.scoreBps
      );
    }, 0);
    const averageScoreBps = Math.floor(sum / successes.length);

    if (averageScoreBps < thresholdBps) {
      return {
        status: "below_threshold",
        averageScoreBps,
        thresholdBps,
        validatorOutcomes: outcomes,
      };
    }

    // Build score account references for the on-chain instruction.
    const scoreAccounts: ScoreAccountRef[] = successes.map((o) => ({
      campaignId: task.campaignId,
      validatorPubkey: (o as Extract<ValidatorOutcome, { status: "ok" }>)
        .validatorPubkey,
    }));

    const receipt = await this.settlementTrigger.triggerSettleSuccess(
      task.campaignId,
      scoreAccounts,
    );

    return {
      status: "settled_success",
      averageScoreBps,
      validatorOutcomes: outcomes,
      receipt,
    };
  }

  /**
   * Check whether the campaign deadline has passed and, if so, trigger a
   * timeout refund on-chain.
   */
  async checkAndSettleTimeout(
    campaignId: CampaignId,
    deadlineUnix: number,
    nowUnix?: number,
  ): Promise<TimeoutOutcome> {
    const now = nowUnix ?? Math.floor(Date.now() / 1000);

    if (now <= deadlineUnix) {
      return { status: "not_expired", nowUnix: now, deadlineUnix };
    }

    const receipt =
      await this.settlementTrigger.triggerTimeoutRefund(campaignId);
    return { status: "refund_triggered", receipt };
  }
}

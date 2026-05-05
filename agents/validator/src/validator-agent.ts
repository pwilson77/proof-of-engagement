import { Keypair } from "@solana/web3.js";
import {
  RawProofInput,
  ScoreSubmissionClient,
  ScoreSubmissionReceipt,
  SignedScore,
  ValidatorTask,
} from "./types.js";
import { deterministicScoreBps, normalizeProofInput } from "./scoring.js";
import { buildScorePayload, signScore } from "./signing.js";

export interface ValidatorAgentConfig {
  signer: Keypair;
  submissionClient: ScoreSubmissionClient;
}

export interface ValidateAndSubmitResult {
  scoreBps: number;
  signedScore: SignedScore;
  receipt: ScoreSubmissionReceipt;
}

export class ValidatorAgent {
  private readonly signer: Keypair;
  private readonly submissionClient: ScoreSubmissionClient;

  constructor(config: ValidatorAgentConfig) {
    this.signer = config.signer;
    this.submissionClient = config.submissionClient;
  }

  async validateAndSubmit(
    task: ValidatorTask,
    rawProof: RawProofInput,
  ): Promise<ValidateAndSubmitResult> {
    const normalized = normalizeProofInput(rawProof);
    const scoreBps = deterministicScoreBps(normalized);
    const payload = buildScorePayload(
      task,
      this.signer.publicKey.toBase58(),
      normalized,
      scoreBps,
    );
    const signedScore = signScore(payload, this.signer);

    const receipt = await this.submissionClient.submitValidatorScore({
      campaignId: task.campaignId,
      scoreBps,
      signedScore,
    });

    return {
      scoreBps,
      signedScore,
      receipt,
    };
  }
}

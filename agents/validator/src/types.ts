export type CampaignId = bigint;

export interface ValidatorTask {
  campaignId: CampaignId;
  taskRefHex: string;
}

export interface RawProofInput {
  platform: string;
  contentUri: string;
  action: string;
  actor: string;
  evidenceDigestHex: string;
  engagementCount?: number;
  createdAtUnix?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface NormalizedProofInput {
  platform: string;
  contentUri: string;
  action: string;
  actor: string;
  evidenceDigestHex: string;
  engagementCount: number;
  createdAtUnix: number;
  metadata: Array<[string, string]>;
}

export interface ScorePayload {
  version: number;
  campaignId: string;
  taskRefHex: string;
  validator: string;
  scoreBps: number;
  reasonCode: string;
  proofDigestHex: string;
  scoredAtUnix: number;
}

export interface SignedScore {
  payload: ScorePayload;
  payloadDigestHex: string;
  signatureBase58: string;
  signer: string;
}

export interface SubmitScoreRequest {
  campaignId: CampaignId;
  scoreBps: number;
  signedScore: SignedScore;
}

export interface ScoreSubmissionReceipt {
  txSignature: string;
  submittedAtUnix: number;
}

export interface ScoreSubmissionClient {
  submitValidatorScore(request: SubmitScoreRequest): Promise<ScoreSubmissionReceipt>;
}

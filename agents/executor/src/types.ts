export type CampaignId = bigint;

export interface CampaignTask {
  campaignId: CampaignId;
  taskRefHex: string;
  executor: string;
}

export interface ProofInput {
  platform: string;
  contentUri: string;
  action: string;
  evidenceDigestHex: string;
}

export interface AttestationPayload {
  version: number;
  campaignId: string;
  executor: string;
  taskRefHex: string;
  action: string;
  platform: string;
  contentUri: string;
  evidenceDigestHex: string;
  attestedAtUnix: number;
}

export interface SignedAttestation {
  payload: AttestationPayload;
  payloadDigestHex: string;
  signatureBase58: string;
  signer: string;
}

export interface SubmitAttestationRequest {
  campaignId: CampaignId;
  signedAttestation: SignedAttestation;
}

export interface SubmissionReceipt {
  txSignature: string;
  submittedAtUnix: number;
}

export interface SettlementClient {
  submitExecutorAttestation(
    request: SubmitAttestationRequest,
  ): Promise<SubmissionReceipt>;
}

export interface ClaimHandle {
  campaignId: CampaignId;
  claimedAtUnix: number;
  release: () => void;
}

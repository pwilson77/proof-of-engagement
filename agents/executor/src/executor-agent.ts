import { Keypair } from "@solana/web3.js";
import { ClaimStore } from "./claim-store.js";
import {
  CampaignTask,
  ProofInput,
  SettlementClient,
  SignedAttestation,
  SubmissionReceipt,
} from "./types.js";
import { buildAttestationPayload, signAttestation } from "./attestation.js";

export interface ExecutorAgentConfig {
  signer: Keypair;
  settlementClient: SettlementClient;
  claimStore?: ClaimStore;
}

export interface ExecuteCampaignResult {
  attestation: SignedAttestation;
  receipt: SubmissionReceipt;
}

export class ExecutorAgent {
  private readonly signer: Keypair;
  private readonly settlementClient: SettlementClient;
  private readonly claimStore: ClaimStore;

  constructor(config: ExecutorAgentConfig) {
    this.signer = config.signer;
    this.settlementClient = config.settlementClient;
    this.claimStore = config.claimStore ?? new ClaimStore();
  }

  async executeCampaign(
    campaign: CampaignTask,
    proof: ProofInput,
  ): Promise<ExecuteCampaignResult> {
    const claim = this.claimStore.claim(campaign.campaignId);

    try {
      const payload = buildAttestationPayload(campaign, proof);
      const attestation = signAttestation(payload, this.signer);
      const receipt = await this.settlementClient.submitExecutorAttestation({
        campaignId: campaign.campaignId,
        signedAttestation: attestation,
      });

      return { attestation, receipt };
    } finally {
      claim.release();
    }
  }
}

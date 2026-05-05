import { PublicKey } from "@solana/web3.js";
import type {
  SettlementTriggerClient,
  SettleTxReceipt,
  ScoreAccountRef,
} from "@poe/consensus-orchestrator";
import { PoeClient } from "./client.js";
import { findValidatorScorePda, findCampaignPda } from "./pda.js";

/**
 * Bridges PoeClient into the SettlementTriggerClient interface expected by
 * ConsensusOrchestrator, so the consensus layer can trigger on-chain settlement
 * without knowing about raw transactions.
 */
export class SdkSettlementTrigger implements SettlementTriggerClient {
  constructor(
    private readonly sdk: PoeClient,
    private readonly creator: PublicKey,
    private readonly executorTokenAccount: PublicKey,
    private readonly creatorRefundTokenAccount: PublicKey,
  ) {}

  async triggerSettleSuccess(
    campaignId: bigint,
    scoreAccountRefs: ScoreAccountRef[],
  ): Promise<SettleTxReceipt> {
    const [campaignPda] = await findCampaignPda(this.creator, campaignId);

    const scorePubkeys = await Promise.all(
      scoreAccountRefs.map(async (ref) => {
        const [pda] = await findValidatorScorePda(
          campaignPda,
          new PublicKey(ref.validatorPubkey),
        );
        return pda;
      }),
    );

    const receipt = await this.sdk.triggerSettleSuccess(
      this.creator,
      campaignId,
      this.executorTokenAccount,
      scorePubkeys,
    );

    return {
      txSignature: receipt.txSignature,
      settledAtUnix: receipt.confirmedAtUnix,
    };
  }

  async triggerTimeoutRefund(campaignId: bigint): Promise<SettleTxReceipt> {
    const receipt = await this.sdk.triggerTimeoutRefund(
      this.creator,
      campaignId,
      this.creatorRefundTokenAccount,
    );

    return {
      txSignature: receipt.txSignature,
      settledAtUnix: receipt.confirmedAtUnix,
    };
  }
}

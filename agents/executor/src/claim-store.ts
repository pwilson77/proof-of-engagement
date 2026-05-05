import { ClaimHandle, CampaignId } from "./types.js";

export class ClaimStore {
  private readonly activeClaims = new Map<string, number>();

  claim(
    campaignId: CampaignId,
    nowUnix = Math.floor(Date.now() / 1000),
  ): ClaimHandle {
    const key = campaignId.toString();
    if (this.activeClaims.has(key)) {
      throw new Error(`campaign ${key} is already claimed`);
    }

    this.activeClaims.set(key, nowUnix);

    return {
      campaignId,
      claimedAtUnix: nowUnix,
      release: () => {
        this.activeClaims.delete(key);
      },
    };
  }

  isClaimed(campaignId: CampaignId): boolean {
    return this.activeClaims.has(campaignId.toString());
  }
}

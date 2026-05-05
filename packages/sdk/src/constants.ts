import { PublicKey } from "@solana/web3.js";

/** On-chain program ID */
export const PROGRAM_ID = new PublicKey(
  "PoEe1hTQghtjuxrbR628JjpNPfLxEDN5GagwqUvJTGA",
);

/** Campaign status codes */
export const CAMPAIGN_STATUS = {
  OPEN: 0,
  SETTLED_SUCCESS: 1,
  SETTLED_REFUND: 2,
} as const;

export type CampaignStatus =
  (typeof CAMPAIGN_STATUS)[keyof typeof CAMPAIGN_STATUS];

/** Anchor discriminator length prefix on all accounts */
export const DISCRIMINATOR_LEN = 8;

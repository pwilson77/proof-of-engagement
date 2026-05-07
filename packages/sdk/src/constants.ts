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
  RFQ_EXPIRED: 3,
} as const;

export type CampaignStatus =
  (typeof CAMPAIGN_STATUS)[keyof typeof CAMPAIGN_STATUS];

/** Campaign mode codes */
export const CAMPAIGN_MODE = {
  DIRECT: 0,
  RFQ: 1,
} as const;

export type CampaignMode = (typeof CAMPAIGN_MODE)[keyof typeof CAMPAIGN_MODE];

/** Bid status codes */
export const BID_STATUS = {
  OPEN: 0,
  WITHDRAWN: 1,
  ACCEPTED: 2,
} as const;

export type BidStatus = (typeof BID_STATUS)[keyof typeof BID_STATUS];

/** Anchor discriminator length prefix on all accounts */
export const DISCRIMINATOR_LEN = 8;

/** MagicBlock Ephemeral Rollup (ER) RPC endpoints */
export const ER_ENDPOINTS = {
  devnet: "https://devnet.magicblock.app",
  devnetRouter: "https://devnet-router.magicblock.app",
  mainnet: "https://mainnet.magicblock.app",
} as const;

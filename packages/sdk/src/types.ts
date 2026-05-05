import { PublicKey } from "@solana/web3.js";
import type { CampaignStatus } from "./constants.js";

/** Deserialized on-chain Campaign account. */
export interface CampaignAccount {
  campaignId: bigint;
  creator: PublicKey;
  executor: PublicKey;
  mint: PublicKey;
  escrowTokenAccount: PublicKey;
  amount: bigint;
  taskRef: Uint8Array;
  validatorSetHash: Uint8Array;
  validatorCount: number;
  thresholdBps: number;
  deadlineUnix: bigint;
  status: CampaignStatus;
  createdAtUnix: bigint;
  bump: number;
}

/** Deserialized on-chain ValidatorScore account. */
export interface ValidatorScoreAccount {
  campaign: PublicKey;
  validator: PublicKey;
  scoreBps: number;
  submittedAtUnix: bigint;
  bump: number;
}

/** Human-readable campaign status string. */
export type CampaignStatusLabel = "open" | "settled_success" | "settled_refund";

/** Campaign status query result. */
export interface CampaignStatusResult {
  publicKey: PublicKey;
  account: CampaignAccount;
  statusLabel: CampaignStatusLabel;
  scores: ValidatorScoreAccount[];
}

/** Parameters for creating a campaign. */
export interface CreateCampaignParams {
  /** Monotonic u64 campaign id chosen by the creator. */
  campaignId: bigint;
  /** Executor wallet that will receive the payout on success. */
  executor: PublicKey;
  /** Token amount to escrow (in raw token units). */
  amount: bigint;
  /** 32-byte deterministic hash of off-chain task metadata. */
  taskRef: Uint8Array;
  /** Ordered list of allowed validator pubkeys. */
  validators: PublicKey[];
  /** Minimum score in basis points (0–10000) for success. */
  thresholdBps: number;
  /** Unix timestamp deadline (must be in the future). */
  deadlineUnix: bigint;
}

/** Receipt returned after a successful transaction. */
export interface TxReceipt {
  txSignature: string;
  confirmedAtUnix: number;
}

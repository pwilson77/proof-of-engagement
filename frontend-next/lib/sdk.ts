import { sha256 } from "@noble/hashes/sha2.js";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

export const PROGRAM_ID = new PublicKey(
  "PoEe1hTQghtjuxrbR628JjpNPfLxEDN5GagwqUvJTGA",
);

export const CAMPAIGN_STATUS = {
  OPEN: 0,
  SETTLED_SUCCESS: 1,
  SETTLED_REFUND: 2,
  RFQ_EXPIRED: 3,
} as const;

export const CAMPAIGN_MODE = {
  DIRECT: 0,
  RFQ: 1,
} as const;

export const BID_STATUS = {
  OPEN: 0,
  WITHDRAWN: 1,
  ACCEPTED: 2,
} as const;

export const ER_ENDPOINTS = {
  devnet: "https://devnet.magicblock.app",
  devnetRouter: "https://devnet-router.magicblock.app",
  mainnet: "https://mainnet.magicblock.app",
} as const;

const DISCRIMINATOR_LEN = 8;

export type CampaignStatusLabel =
  | "open"
  | "settled_success"
  | "settled_refund"
  | "rfq_expired";

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
  status: number;
  createdAtUnix: bigint;
  bump: number;
  mode: number;
  rfqDeadlineUnix: bigint;
  acceptedBidId: bigint;
}

export interface BidAccount {
  campaign: PublicKey;
  bidId: bigint;
  bidder: PublicKey;
  amount: bigint;
  capabilitiesHash: Uint8Array;
  etaUnix: bigint;
  status: number;
  createdAtUnix: bigint;
  bump: number;
}

export interface ValidatorScoreAccount {
  campaign: PublicKey;
  validator: PublicKey;
  scoreBps: number;
  submittedAtUnix: bigint;
  bump: number;
}

export interface CampaignStatusResult {
  publicKey: PublicKey;
  account: CampaignAccount;
  statusLabel: CampaignStatusLabel;
  scores: ValidatorScoreAccount[];
}

export interface TxReceipt {
  txSignature: string;
  confirmedAtUnix: number;
}

export interface CreateCampaignParams {
  campaignId: bigint;
  executor: PublicKey;
  amount: bigint;
  taskRef: Uint8Array;
  validators: PublicKey[];
  thresholdBps: number;
  deadlineUnix: bigint;
}

export interface CreateCampaignRfqParams {
  campaignId: bigint;
  amount: bigint;
  taskRef: Uint8Array;
  validators: PublicKey[];
  thresholdBps: number;
  deadlineUnix: bigint;
  rfqDeadlineUnix: bigint;
}

export interface SubmitBidParams {
  creator: PublicKey;
  campaignId: bigint;
  bidId: bigint;
  amount: bigint;
  capabilitiesHash: Uint8Array;
  etaUnix: bigint;
}

export interface WithdrawBidParams {
  creator: PublicKey;
  campaignId: bigint;
  bidId: bigint;
}

export interface AcceptBidParams {
  campaignId: bigint;
  bidder: PublicKey;
  bidId: bigint;
}

export interface ScoreAccountRef {
  validatorPubkey: string;
}

export interface SettleTxReceipt {
  txSignature: string;
  settledAtUnix: number;
}

export interface SettlementTriggerClient {
  triggerSettleSuccess(
    campaignId: bigint,
    scoreAccountRefs: ScoreAccountRef[],
  ): Promise<SettleTxReceipt>;
  triggerTimeoutRefund(campaignId: bigint): Promise<SettleTxReceipt>;
}

function accountDiscriminator(name: string): number[] {
  return Array.from(sha256(new TextEncoder().encode(`account:${name}`))).slice(
    0,
    8,
  );
}

function ixDiscriminator(name: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`))).subarray(
    0,
    8,
  );
}

function readU64LE(view: DataView, offset: number): bigint {
  const lo = BigInt(view.getUint32(offset, true));
  const hi = BigInt(view.getUint32(offset + 4, true));
  return lo | (hi << 32n);
}

function readI64LE(view: DataView, offset: number): bigint {
  const lo = BigInt(view.getUint32(offset, true));
  const hi = BigInt(view.getInt32(offset + 4, true));
  return lo | (hi << 32n);
}

function readPubkey(buf: Uint8Array, offset: number): PublicKey {
  return new PublicKey(buf.slice(offset, offset + 32));
}

function encodeU64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

function encodeU16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

function encodeI64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}

function encodeVecPubkey(pubkeys: PublicKey[]): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(pubkeys.length);
  return Buffer.concat([lenBuf, ...pubkeys.map((p) => p.toBuffer())]);
}

export function canonicalValidatorHash(validators: PublicKey[]): Uint8Array {
  return sha256(Buffer.concat(validators.map((v) => v.toBuffer())));
}

export async function findCampaignPda(
  creator: PublicKey,
  campaignId: bigint,
): Promise<[PublicKey, number]> {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(campaignId);
  return PublicKey.findProgramAddress(
    [Buffer.from("campaign"), creator.toBuffer(), idBuf],
    PROGRAM_ID,
  );
}

export async function findValidatorSetPda(
  creator: PublicKey,
  campaignId: bigint,
): Promise<[PublicKey, number]> {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(campaignId);
  return PublicKey.findProgramAddress(
    [Buffer.from("validator_set"), creator.toBuffer(), idBuf],
    PROGRAM_ID,
  );
}

export async function findValidatorScorePda(
  campaignPubkey: PublicKey,
  validatorPubkey: PublicKey,
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [
      Buffer.from("score"),
      campaignPubkey.toBuffer(),
      validatorPubkey.toBuffer(),
    ],
    PROGRAM_ID,
  );
}

export async function findConfigPda(): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress([Buffer.from("config")], PROGRAM_ID);
}

export async function findBidPda(
  campaignPubkey: PublicKey,
  bidderPubkey: PublicKey,
  bidId: bigint,
): Promise<[PublicKey, number]> {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(bidId);
  return PublicKey.findProgramAddress(
    [Buffer.from("bid"), campaignPubkey.toBuffer(), bidderPubkey.toBuffer(), idBuf],
    PROGRAM_ID,
  );
}

export function deserializeCampaign(data: Uint8Array): CampaignAccount {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = DISCRIMINATOR_LEN;

  const campaignId = readU64LE(view, o);
  o += 8;
  const creator = readPubkey(data, o);
  o += 32;
  const executor = readPubkey(data, o);
  o += 32;
  const mint = readPubkey(data, o);
  o += 32;
  const escrowTokenAccount = readPubkey(data, o);
  o += 32;
  const amount = readU64LE(view, o);
  o += 8;
  const taskRef = data.slice(o, o + 32);
  o += 32;
  const validatorSetHash = data.slice(o, o + 32);
  o += 32;
  const validatorCount = data[o] ?? 0;
  o += 1;
  const thresholdBps = view.getUint16(o, true);
  o += 2;
  const deadlineUnix = readI64LE(view, o);
  o += 8;
  const rawStatus = data[o] ?? 0;
  o += 1;
  const createdAtUnix = readI64LE(view, o);
  o += 8;
  const bump = data[o] ?? 0;
  o += 1;
  const mode = data.length > o ? data[o]! : 0;
  o += 1;
  const rfqDeadlineUnix = data.length > o ? readI64LE(view, o) : 0n;
  o += 8;
  const acceptedBidId = data.length > o ? readU64LE(view, o) : 0n;

  return {
    campaignId,
    creator,
    executor,
    mint,
    escrowTokenAccount,
    amount,
    taskRef,
    validatorSetHash,
    validatorCount,
    thresholdBps,
    deadlineUnix,
    status: rawStatus,
    createdAtUnix,
    bump,
    mode,
    rfqDeadlineUnix,
    acceptedBidId,
  };
}

export function deserializeValidatorScore(
  data: Uint8Array,
): ValidatorScoreAccount {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = DISCRIMINATOR_LEN;

  const campaign = readPubkey(data, o);
  o += 32;
  const validator = readPubkey(data, o);
  o += 32;
  const scoreBps = view.getUint16(o, true);
  o += 2;
  const submittedAtUnix = readI64LE(view, o);
  o += 8;
  const bump = data[o] ?? 0;

  return { campaign, validator, scoreBps, submittedAtUnix, bump };
}

export function deserializeBid(data: Uint8Array): BidAccount {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = DISCRIMINATOR_LEN;

  const campaign = readPubkey(data, o);
  o += 32;
  const bidId = readU64LE(view, o);
  o += 8;
  const bidder = readPubkey(data, o);
  o += 32;
  const amount = readU64LE(view, o);
  o += 8;
  const capabilitiesHash = data.slice(o, o + 32);
  o += 32;
  const etaUnix = readI64LE(view, o);
  o += 8;
  const status = data[o] ?? 0;
  o += 1;
  const createdAtUnix = readI64LE(view, o);
  o += 8;
  const bump = data[o] ?? 0;

  return {
    campaign,
    bidId,
    bidder,
    amount,
    capabilitiesHash,
    etaUnix,
    status,
    createdAtUnix,
    bump,
  };
}

export function statusLabel(status: number): CampaignStatusLabel {
  if (status === CAMPAIGN_STATUS.SETTLED_SUCCESS) return "settled_success";
  if (status === CAMPAIGN_STATUS.SETTLED_REFUND) return "settled_refund";
  if (status === CAMPAIGN_STATUS.RFQ_EXPIRED) return "rfq_expired";
  return "open";
}

export class PoeClient {
  readonly connection: Connection;
  readonly payer: Keypair;

  constructor(config: { connection: Connection; payer: Keypair }) {
    this.connection = config.connection;
    this.payer = config.payer;
  }

  async queryCampaignStatus(
    creator: PublicKey,
    campaignId: bigint,
  ): Promise<CampaignStatusResult> {
    const [campaignPda] = await findCampaignPda(creator, campaignId);
    const campaignInfo = await this.connection.getAccountInfo(campaignPda);
    if (!campaignInfo) throw new Error(`Campaign ${campaignId} not found`);

    const account = deserializeCampaign(campaignInfo.data);
    const scoreDisc = accountDiscriminator("ValidatorScore");
    const programAccounts = await this.connection.getProgramAccounts(PROGRAM_ID);
    const scores = programAccounts
      .filter(({ account: candidate }) => {
        const data = candidate.data;
        if (data.length < 8) return false;
        for (let i = 0; i < 8; i += 1) if (data[i] !== scoreDisc[i]) return false;
        return true;
      })
      .flatMap(({ account: candidate }) => {
        try {
          const score = deserializeValidatorScore(candidate.data);
          return score.campaign.equals(campaignPda) ? [score] : [];
        } catch {
          return [];
        }
      });

    return {
      publicKey: campaignPda,
      account,
      statusLabel: statusLabel(account.status),
      scores,
    };
  }

  async createCampaign(_: CreateCampaignParams): Promise<TxReceipt> {
    throw new Error("createCampaign is not available in the frontend build");
  }

  async createCampaignRfq(_: CreateCampaignRfqParams): Promise<TxReceipt> {
    throw new Error("createCampaignRfq is not available in the frontend build");
  }

  async triggerSettleSuccess(_: unknown): Promise<TxReceipt> {
    throw new Error("triggerSettleSuccess is not available in the frontend build");
  }

  async triggerTimeoutRefund(_: unknown): Promise<TxReceipt> {
    throw new Error("triggerTimeoutRefund is not available in the frontend build");
  }
}

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
    void scoreAccountRefs;
    const receipt = await this.sdk.triggerSettleSuccess({
      creator: this.creator,
      campaignId,
      executorTokenAccount: this.executorTokenAccount,
    });
    return {
      txSignature: receipt.txSignature,
      settledAtUnix: receipt.confirmedAtUnix,
    };
  }

  async triggerTimeoutRefund(campaignId: bigint): Promise<SettleTxReceipt> {
    const receipt = await this.sdk.triggerTimeoutRefund({
      creator: this.creator,
      campaignId,
      creatorRefundTokenAccount: this.creatorRefundTokenAccount,
    });
    return {
      txSignature: receipt.txSignature,
      settledAtUnix: receipt.confirmedAtUnix,
    };
  }
}

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha2.js";
import { PROGRAM_ID } from "./constants.js";
import {
  findCampaignPda,
  findConfigPda,
  findValidatorSetPda,
  findValidatorScorePda,
  findBidPda,
} from "./pda.js";
import {
  deserializeBid,
  deserializeCampaign,
  deserializeValidatorScore,
  statusLabel,
} from "./layout.js";
import { canonicalValidatorHash } from "./validator-hash.js";
import type {
  AcceptBidParams,
  CreateCampaignParams,
  CreateCampaignRfqParams,
  CampaignStatusResult,
  SubmitBidParams,
  TxReceipt,
  WithdrawBidParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Instruction discriminators (Anchor sha256("global:<ix_name>")[0..8])
// ---------------------------------------------------------------------------
// Pre-computed values — must match the on-chain program discriminators exactly.
// Recompute with: sha256("global:create_validator_set")[0..8], etc.

function ixDiscriminator(name: string): Buffer {
  return Buffer.from(
    sha256(new TextEncoder().encode(`global:${name}`)),
  ).subarray(0, 8);
}

const DISC_CREATE_VALIDATOR_SET = ixDiscriminator("create_validator_set");
const DISC_CREATE_CAMPAIGN = ixDiscriminator("create_campaign");
const DISC_CREATE_CAMPAIGN_RFQ = ixDiscriminator("create_campaign_rfq");
const DISC_SUBMIT_BID = ixDiscriminator("submit_bid");
const DISC_WITHDRAW_BID = ixDiscriminator("withdraw_bid");
const DISC_ACCEPT_BID = ixDiscriminator("accept_bid");
const DISC_EXPIRE_RFQ = ixDiscriminator("expire_rfq");
const DISC_SETTLE_SUCCESS = ixDiscriminator("settle_success");
const DISC_SETTLE_TIMEOUT_REFUND = ixDiscriminator("settle_timeout_refund");

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

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

/** Encode a Borsh Vec<Pubkey>: 4-byte LE length prefix + 32 bytes each. */
function encodeVecPubkey(pubkeys: PublicKey[]): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(pubkeys.length);
  return Buffer.concat([lenBuf, ...pubkeys.map((p) => p.toBuffer())]);
}

// ---------------------------------------------------------------------------
// PoeClient
// ---------------------------------------------------------------------------

export interface PoeClientConfig {
  connection: Connection;
  /** Payer and authority for transactions. */
  payer: Keypair;
}

export class PoeClient {
  readonly connection: Connection;
  readonly payer: Keypair;

  constructor(config: PoeClientConfig) {
    this.connection = config.connection;
    this.payer = config.payer;
  }

  // -------------------------------------------------------------------------
  // create_campaign
  // -------------------------------------------------------------------------

  /**
   * Create a campaign on-chain:
   *   1. create_validator_set
   *   2. create_campaign (with token escrow)
   *
   * The payer is the campaign creator.
   */
  async createCampaign(params: CreateCampaignParams): Promise<TxReceipt> {
    const {
      campaignId,
      executor,
      amount,
      taskRef,
      validators,
      thresholdBps,
      deadlineUnix,
    } = params;

    // Input validation — catch bad inputs before wasting an RPC call.
    if (taskRef.length !== 32) {
      throw new Error(
        `taskRef must be exactly 32 bytes, got ${taskRef.length}`,
      );
    }
    if (validators.length === 0 || validators.length > 255) {
      throw new Error(
        `validators must have 1–255 entries, got ${validators.length}`,
      );
    }
    if (thresholdBps < 0 || thresholdBps > 10_000) {
      throw new Error(`thresholdBps must be 0–10000, got ${thresholdBps}`);
    }
    if (amount <= 0n) {
      throw new Error(`amount must be greater than zero`);
    }

    const creator = this.payer.publicKey;

    const [configPda] = await findConfigPda();
    const [validatorSetPda] = await findValidatorSetPda(creator, campaignId);
    const [campaignPda] = await findCampaignPda(creator, campaignId);

    // Fetch config to get USDC mint
    const configData = await this.connection.getAccountInfo(configPda);
    if (!configData)
      throw new Error(
        "Config account not initialized. Run initialize_config first.",
      );

    // Config layout: discriminator(8) + authority(32) + usdc_mint(32) + bump(1)
    const usdcMint = new PublicKey(configData.data.slice(8 + 32, 8 + 32 + 32));

    const creatorAta = await getAssociatedTokenAddress(usdcMint, creator);
    const escrowKp = Keypair.generate();

    const validatorSetHash = canonicalValidatorHash(validators);

    // --- Instruction 1: create_validator_set ---
    // Args layout: campaign_id(u64) + validators(Vec<Pubkey>)
    const vsArgs = Buffer.concat([
      DISC_CREATE_VALIDATOR_SET,
      encodeU64LE(campaignId),
      encodeVecPubkey(validators),
    ]);

    const vsIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: validatorSetPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: vsArgs,
    });

    // --- Instruction 2: create_campaign ---
    // Args layout (CreateCampaignArgs Borsh struct):
    //   campaign_id(u64) + executor(Pubkey) + amount(u64) + task_ref([u8;32]) +
    //   validator_set_hash([u8;32]) + validator_count(u8) + threshold_bps(u16) + deadline_unix(i64)
    const campaignArgs = Buffer.concat([
      DISC_CREATE_CAMPAIGN,
      encodeU64LE(campaignId),
      executor.toBuffer(),
      encodeU64LE(amount),
      Buffer.from(taskRef),
      Buffer.from(validatorSetHash),
      Buffer.from([validators.length]),
      encodeU16LE(thresholdBps),
      encodeI64LE(deadlineUnix),
    ]);

    // Ensure creator ATA exists (idempotent)
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      creator,
      creatorAta,
      creator,
      usdcMint,
    );

    const campaignIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: creatorAta, isSigner: false, isWritable: true },
        { pubkey: validatorSetPda, isSigner: false, isWritable: false },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
        { pubkey: escrowKp.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: campaignArgs,
    });

    const tx = new Transaction().add(createAtaIx, vsIx, campaignIx);
    const sig = await this.connection.sendTransaction(
      tx,
      [this.payer, escrowKp],
      {
        skipPreflight: false,
      },
    );
    await this.connection.confirmTransaction(sig, "confirmed");

    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  // -------------------------------------------------------------------------
  // queryCampaignStatus
  // -------------------------------------------------------------------------

  /**
   * Fetch campaign account + all validator score accounts.
   * Provides a full status snapshot without any on-chain state mutation.
   */
  async queryCampaignStatus(
    creator: PublicKey,
    campaignId: bigint,
  ): Promise<CampaignStatusResult> {
    const [campaignPda] = await findCampaignPda(creator, campaignId);

    const campaignInfo = await this.connection.getAccountInfo(campaignPda);
    if (!campaignInfo) throw new Error(`Campaign ${campaignId} not found`);

    const account = deserializeCampaign(new Uint8Array(campaignInfo.data));

    // Fetch all score PDAs by querying gPA filtered by program + discriminator prefix
    // For MVP, derive PDAs for all validators recorded in the validator set.
    const [validatorSetPda] = await findValidatorSetPda(creator, campaignId);
    const vsInfo = await this.connection.getAccountInfo(validatorSetPda);

    const scores: ReturnType<typeof deserializeValidatorScore>[] = [];

    if (vsInfo) {
      // Parse validators from ValidatorSet account:
      // discriminator(8) + creator(32) + campaign_id(8) +
      // validators Vec<Pubkey>: len(4) + n*32 + validator_count(1) + hash(32) + bump(1)
      const vsData = new Uint8Array(vsInfo.data);
      const view = new DataView(
        vsData.buffer,
        vsData.byteOffset,
        vsData.byteLength,
      );
      const validatorCount = view.getUint32(8 + 32 + 8, true);
      const validators: PublicKey[] = [];
      let offset = 8 + 32 + 8 + 4;
      for (let i = 0; i < validatorCount; i++) {
        validators.push(new PublicKey(vsData.slice(offset, offset + 32)));
        offset += 32;
      }

      await Promise.all(
        validators.map(async (v) => {
          const [scorePda] = await findValidatorScorePda(campaignPda, v);
          const info = await this.connection.getAccountInfo(scorePda);
          if (info) {
            scores.push(deserializeValidatorScore(new Uint8Array(info.data)));
          }
        }),
      );
    }

    return {
      publicKey: campaignPda,
      account,
      statusLabel: statusLabel(account.status),
      scores,
    };
  }

  // -------------------------------------------------------------------------
  // triggerSettleSuccess
  // -------------------------------------------------------------------------

  /**
   * Submit `settle_success` instruction with the given validator score account addresses.
   * Passes score accounts as `remaining_accounts`.
   */
  async triggerSettleSuccess(
    creator: PublicKey,
    campaignId: bigint,
    executorTokenAccount: PublicKey,
    scoreAccounts: PublicKey[],
  ): Promise<TxReceipt> {
    const [campaignPda] = await findCampaignPda(creator, campaignId);

    const campaignInfo = await this.connection.getAccountInfo(campaignPda);
    if (!campaignInfo) throw new Error(`Campaign ${campaignId} not found`);
    const campaign = deserializeCampaign(new Uint8Array(campaignInfo.data));

    const data = Buffer.concat([DISC_SETTLE_SUCCESS, encodeU64LE(campaignId)]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
        {
          pubkey: campaign.escrowTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: executorTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ...scoreAccounts.map((pk) => ({
          pubkey: pk,
          isSigner: false,
          isWritable: false,
        })),
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");

    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  // -------------------------------------------------------------------------
  // triggerTimeoutRefund
  // -------------------------------------------------------------------------

  /**
   * Submit `settle_timeout_refund` instruction.
   */
  async triggerTimeoutRefund(
    creator: PublicKey,
    campaignId: bigint,
    creatorRefundTokenAccount: PublicKey,
  ): Promise<TxReceipt> {
    const [campaignPda] = await findCampaignPda(creator, campaignId);

    const campaignInfo = await this.connection.getAccountInfo(campaignPda);
    if (!campaignInfo) throw new Error(`Campaign ${campaignId} not found`);
    const campaign = deserializeCampaign(new Uint8Array(campaignInfo.data));

    const data = Buffer.concat([
      DISC_SETTLE_TIMEOUT_REFUND,
      encodeU64LE(campaignId),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
        {
          pubkey: campaign.escrowTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: creatorRefundTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");

    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  // -------------------------------------------------------------------------
  // createCampaignRfq
  // -------------------------------------------------------------------------

  /**
   * Create an RFQ-mode campaign: escrows funds but sets no executor.
   * Executors must call submitBid, then creator calls acceptBid before
   * the execution flow can proceed.
   */
  async createCampaignRfq(params: CreateCampaignRfqParams): Promise<TxReceipt> {
    const {
      campaignId,
      amount,
      taskRef,
      validators,
      thresholdBps,
      deadlineUnix,
      rfqDeadlineUnix,
    } = params;

    if (taskRef.length !== 32) throw new Error("taskRef must be 32 bytes");
    if (validators.length === 0 || validators.length > 255)
      throw new Error("validators must have 1–255 entries");
    if (thresholdBps < 0 || thresholdBps > 10_000)
      throw new Error("thresholdBps must be 0–10000");
    if (amount <= 0n) throw new Error("amount must be > 0");
    if (rfqDeadlineUnix >= deadlineUnix)
      throw new Error("rfqDeadlineUnix must be before deadlineUnix");

    const creator = this.payer.publicKey;
    const [configPda] = await findConfigPda();
    const [validatorSetPda] = await findValidatorSetPda(creator, campaignId);
    const [campaignPda] = await findCampaignPda(creator, campaignId);

    const configData = await this.connection.getAccountInfo(configPda);
    if (!configData) throw new Error("Config account not initialized.");
    const usdcMint = new PublicKey(configData.data.slice(8 + 32, 8 + 32 + 32));

    const creatorAta = await getAssociatedTokenAddress(usdcMint, creator);
    const escrowKp = Keypair.generate();
    const validatorSetHash = canonicalValidatorHash(validators);

    const vsArgs = Buffer.concat([
      DISC_CREATE_VALIDATOR_SET,
      encodeU64LE(campaignId),
      encodeVecPubkey(validators),
    ]);
    const vsIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: validatorSetPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: vsArgs,
    });

    // CreateCampaignRfqArgs Borsh layout:
    //   campaign_id(u64) + amount(u64) + task_ref([u8;32]) +
    //   validator_set_hash([u8;32]) + validator_count(u8) + threshold_bps(u16) +
    //   deadline_unix(i64) + rfq_deadline_unix(i64)
    const rfqArgs = Buffer.concat([
      DISC_CREATE_CAMPAIGN_RFQ,
      encodeU64LE(campaignId),
      encodeU64LE(amount),
      Buffer.from(taskRef),
      Buffer.from(validatorSetHash),
      Buffer.from([validators.length]),
      encodeU16LE(thresholdBps),
      encodeI64LE(deadlineUnix),
      encodeI64LE(rfqDeadlineUnix),
    ]);

    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      creator,
      creatorAta,
      creator,
      usdcMint,
    );

    const rfqIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: creatorAta, isSigner: false, isWritable: true },
        { pubkey: validatorSetPda, isSigner: false, isWritable: false },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
        { pubkey: escrowKp.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: rfqArgs,
    });

    const tx = new Transaction().add(createAtaIx, vsIx, rfqIx);
    const sig = await this.connection.sendTransaction(tx, [
      this.payer,
      escrowKp,
    ]);
    await this.connection.confirmTransaction(sig, "confirmed");

    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  // -------------------------------------------------------------------------
  // submitBid
  // -------------------------------------------------------------------------

  async submitBid(params: SubmitBidParams): Promise<TxReceipt> {
    const { creator, campaignId, bidId, amount, capabilitiesHash, etaUnix } =
      params;

    if (capabilitiesHash.length !== 32)
      throw new Error("capabilitiesHash must be 32 bytes");

    const [campaignPda] = await findCampaignPda(creator, campaignId);
    const [bidPda] = await findBidPda(campaignPda, this.payer.publicKey, bidId);

    // submit_bid args: campaign_id(u64) + bid_id(u64) + amount(u64) +
    //                  capabilities_hash([u8;32]) + eta_unix(i64)
    const data = Buffer.concat([
      DISC_SUBMIT_BID,
      encodeU64LE(campaignId),
      encodeU64LE(bidId),
      encodeU64LE(amount),
      Buffer.from(capabilitiesHash),
      encodeI64LE(etaUnix),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: campaignPda, isSigner: false, isWritable: false },
        { pubkey: bidPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");

    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  // -------------------------------------------------------------------------
  // withdrawBid
  // -------------------------------------------------------------------------

  async withdrawBid(params: WithdrawBidParams): Promise<TxReceipt> {
    const { creator, campaignId, bidId } = params;

    const [campaignPda] = await findCampaignPda(creator, campaignId);
    const [bidPda] = await findBidPda(campaignPda, this.payer.publicKey, bidId);

    const data = Buffer.concat([
      DISC_WITHDRAW_BID,
      encodeU64LE(campaignId),
      encodeU64LE(bidId),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: campaignPda, isSigner: false, isWritable: false },
        { pubkey: bidPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");

    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  // -------------------------------------------------------------------------
  // acceptBid
  // -------------------------------------------------------------------------

  async acceptBid(params: AcceptBidParams): Promise<TxReceipt> {
    const { campaignId, bidder, bidId } = params;

    const creator = this.payer.publicKey;
    const [campaignPda] = await findCampaignPda(creator, campaignId);
    const [bidPda] = await findBidPda(campaignPda, bidder, bidId);

    const data = Buffer.concat([
      DISC_ACCEPT_BID,
      encodeU64LE(campaignId),
      encodeU64LE(bidId),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
        { pubkey: bidPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");

    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  // -------------------------------------------------------------------------
  // expireRfq
  // -------------------------------------------------------------------------

  async expireRfq(creator: PublicKey, campaignId: bigint): Promise<TxReceipt> {
    const [campaignPda] = await findCampaignPda(creator, campaignId);

    const data = Buffer.concat([DISC_EXPIRE_RFQ, encodeU64LE(campaignId)]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");

    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  // -------------------------------------------------------------------------
  // listBids — fetch all Bid PDAs for a campaign
  // -------------------------------------------------------------------------

  async listBids(creator: PublicKey, campaignId: bigint) {
    const [campaignPda] = await findCampaignPda(creator, campaignId);

    // Fetch all accounts owned by program with bid discriminator prefix
    // Bid discriminator = sha256("account:Bid")[0..8]
    const bidDisc = Buffer.from(
      sha256(new TextEncoder().encode("account:Bid")),
    ).subarray(0, 8);

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: bidDisc.toString("base64") } },
        { memcmp: { offset: 8, bytes: campaignPda.toBase58() } },
      ],
    });

    return accounts.map(({ pubkey, account }) => ({
      publicKey: pubkey,
      bid: deserializeBid(new Uint8Array(account.data)),
    }));
  }

  // -------------------------------------------------------------------------
  // MagicBlock Ephemeral Rollup (ER) helpers
  // -------------------------------------------------------------------------

  /**
   * Mark a campaign as "delegation in progress" on the base layer.
   *
   * This instruction is a no-op guard — it just validates the signer and
   * campaign status.  Actual delegation to the ER is performed off-chain
   * by the MagicBlock delegation program, which the TS caller invokes
   * separately via @magicblock-labs/ephemeral-rollups-sdk.
   *
   * @returns the tx signature
   */
  async delegateCampaign(campaignId: bigint): Promise<TxReceipt> {
    const [campaignPda] = await findCampaignPda(
      this.payer.publicKey,
      campaignId,
    );
    const disc = ixDiscriminator("delegate_campaign");
    const data = Buffer.concat([disc, encodeU64LE(campaignId)]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");
    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  /**
   * Mark a campaign as "undelegated / committed back" on the base layer.
   *
   * Like delegateCampaign, the actual undelegate CPI is handled by the
   * MagicBlock SDK.  This call just validates that the campaign can be
   * returned to the base layer (still OPEN or RFQ_EXPIRED).
   *
   * @returns the tx signature
   */
  async undelegateCampaign(campaignId: bigint): Promise<TxReceipt> {
    const [campaignPda] = await findCampaignPda(
      this.payer.publicKey,
      campaignId,
    );
    const disc = ixDiscriminator("undelegate_campaign");
    const data = Buffer.concat([disc, encodeU64LE(campaignId)]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");
    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }

  /**
   * Submit a validator score via the ER endpoint (skipPreflight + fast commit).
   *
   * The caller must provide an `erConnection` pointing at the MagicBlock ER
   * validator (e.g. https://devnet.magicblock.app).  Transactions sent to the
   * ER are not gossip-broadcast on base Solana, so skipPreflight is required.
   */
  async submitValidatorScoreEr(params: {
    erConnection: Connection;
    campaignId: bigint;
    creator: PublicKey;
    score: number;
  }): Promise<TxReceipt> {
    const { erConnection, campaignId, creator, score } = params;
    const [campaignPda] = await findCampaignPda(creator, campaignId);
    const [validatorSetPda] = await findValidatorSetPda(creator, campaignId);
    const [scorePda] = await findValidatorScorePda(
      campaignPda,
      this.payer.publicKey,
    );
    const disc = ixDiscriminator("submit_validator_score");
    const data = Buffer.concat([
      disc,
      encodeU64LE(campaignId),
      encodeU16LE(score),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
        { pubkey: validatorSetPda, isSigner: false, isWritable: false },
        { pubkey: scorePda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    // Must use skipPreflight for ER transactions
    const sig = await erConnection.sendTransaction(tx, [this.payer], {
      skipPreflight: true,
    });
    await erConnection.confirmTransaction(sig, "confirmed");
    const status = await erConnection.getSignatureStatuses([sig], {
      searchTransactionHistory: true,
    });
    const err = status.value[0]?.err;
    if (err) {
      throw new Error(
        `submit_validator_score failed for campaign ${campaignId}: ${JSON.stringify(err)}`,
      );
    }
    return { txSignature: sig, confirmedAtUnix: Math.floor(Date.now() / 1000) };
  }
}

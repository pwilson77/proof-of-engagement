import { PublicKey } from "@solana/web3.js";
import {
  BID_STATUS,
  CAMPAIGN_MODE,
  CAMPAIGN_STATUS,
  DISCRIMINATOR_LEN,
} from "./constants.js";
import type {
  BidAccount,
  CampaignAccount,
  CampaignStatusLabel,
  ValidatorScoreAccount,
} from "./types.js";

/**
 * Read a little-endian u64 from a DataView.
 * JavaScript BigInt handles the full u64 range safely.
 */
function readU64LE(view: DataView, offset: number): bigint {
  const lo = BigInt(view.getUint32(offset, true));
  const hi = BigInt(view.getUint32(offset + 4, true));
  return lo | (hi << 32n);
}

/**
 * Read a little-endian i64 from a DataView.
 */
function readI64LE(view: DataView, offset: number): bigint {
  const lo = BigInt(view.getUint32(offset, true));
  const hi = BigInt(view.getInt32(offset + 4, true)); // signed high word
  return lo | (hi << 32n);
}

function readPubkey(buf: Uint8Array, offset: number): PublicKey {
  return new PublicKey(buf.slice(offset, offset + 32));
}

/**
 * Deserialize a Campaign account from raw account data.
 *
 * On-chain layout (after 8-byte Anchor discriminator):
 *   campaign_id:          u64   (8)
 *   creator:              Pubkey (32)
 *   executor:             Pubkey (32)
 *   mint:                 Pubkey (32)
 *   escrow_token_account: Pubkey (32)
 *   amount:               u64   (8)
 *   task_ref:             [u8;32] (32)
 *   validator_set_hash:   [u8;32] (32)
 *   validator_count:      u8    (1)
 *   threshold_bps:        u16   (2)
 *   deadline_unix:        i64   (8)
 *   status:               u8    (1)
 *   created_at_unix:      i64   (8)
 *   bump:                 u8    (1)
 */
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
  const validatorCount = data[o]!;
  o += 1;
  const thresholdBps = view.getUint16(o, true);
  o += 2;
  const deadlineUnix = readI64LE(view, o);
  o += 8;
  const rawStatus = data[o]!;
  o += 1;
  const createdAtUnix = readI64LE(view, o);
  o += 8;
  const bump = data[o]!;
  o += 1;
  // RFQ extension fields (present in all accounts since Campaign::LEN includes them)
  const mode = data.length > o ? data[o]! : 0;
  o += 1;
  const rfqDeadlineUnix = data.length > o ? readI64LE(view, o) : 0n;
  o += 8;
  const acceptedBidId = data.length > o ? readU64LE(view, o) : 0n;

  const status =
    rawStatus === CAMPAIGN_STATUS.SETTLED_SUCCESS
      ? CAMPAIGN_STATUS.SETTLED_SUCCESS
      : rawStatus === CAMPAIGN_STATUS.SETTLED_REFUND
        ? CAMPAIGN_STATUS.SETTLED_REFUND
        : rawStatus === CAMPAIGN_STATUS.RFQ_EXPIRED
          ? CAMPAIGN_STATUS.RFQ_EXPIRED
          : CAMPAIGN_STATUS.OPEN;

  const campaignMode =
    mode === CAMPAIGN_MODE.RFQ ? CAMPAIGN_MODE.RFQ : CAMPAIGN_MODE.DIRECT;

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
    status,
    createdAtUnix,
    bump,
    mode: campaignMode,
    rfqDeadlineUnix,
    acceptedBidId,
  };
}

/**
 * Deserialize a ValidatorScore account from raw account data.
 *
 * On-chain layout (after 8-byte discriminator):
 *   campaign:         Pubkey (32)
 *   validator:        Pubkey (32)
 *   score_bps:        u16    (2)
 *   submitted_at_unix:i64    (8)
 *   bump:             u8     (1)
 */
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
  const bump = data[o]!;

  return { campaign, validator, scoreBps, submittedAtUnix, bump };
}

/** Map a numeric status code to a human-readable label. */
export function statusLabel(status: number): CampaignStatusLabel {
  if (status === CAMPAIGN_STATUS.SETTLED_SUCCESS) return "settled_success";
  if (status === CAMPAIGN_STATUS.SETTLED_REFUND) return "settled_refund";
  if (status === CAMPAIGN_STATUS.RFQ_EXPIRED) return "rfq_expired";
  return "open";
}

/**
 * Deserialize a Bid account from raw account data.
 *
 * On-chain layout (after 8-byte discriminator):
 *   campaign:            Pubkey (32)
 *   bid_id:              u64   (8)
 *   bidder:              Pubkey (32)
 *   amount:              u64   (8)
 *   capabilities_hash:   [u8;32] (32)
 *   eta_unix:            i64   (8)
 *   status:              u8    (1)
 *   created_at_unix:     i64   (8)
 *   bump:                u8    (1)
 */
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
  const rawStatus = data[o]!;
  o += 1;
  const createdAtUnix = readI64LE(view, o);
  o += 8;
  const bump = data[o]!;

  const status =
    rawStatus === BID_STATUS.WITHDRAWN
      ? BID_STATUS.WITHDRAWN
      : rawStatus === BID_STATUS.ACCEPTED
        ? BID_STATUS.ACCEPTED
        : BID_STATUS.OPEN;

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

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { canonicalValidatorHash } from "../src/validator-hash.js";
import {
  deserializeCampaign,
  deserializeValidatorScore,
  statusLabel,
} from "../src/layout.js";
import { CAMPAIGN_STATUS, DISCRIMINATOR_LEN } from "../src/constants.js";

// ---------------------------------------------------------------------------
// canonicalValidatorHash
// ---------------------------------------------------------------------------

describe("canonicalValidatorHash", () => {
  const v1 = new PublicKey("So11111111111111111111111111111111111111112");
  const v2 = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const v3 = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bv4");

  it("returns a 32-byte hash", () => {
    const hash = canonicalValidatorHash([v1, v2, v3]);
    expect(hash).toHaveLength(32);
  });

  it("is order-independent (same result regardless of input ordering)", () => {
    const h1 = canonicalValidatorHash([v1, v2, v3]);
    const h2 = canonicalValidatorHash([v3, v1, v2]);
    const h3 = canonicalValidatorHash([v2, v3, v1]);
    expect(h1).toEqual(h2);
    expect(h1).toEqual(h3);
  });

  it("produces different hash for different validator sets", () => {
    const ha = canonicalValidatorHash([v1, v2]);
    const hb = canonicalValidatorHash([v1, v3]);
    expect(ha).not.toEqual(hb);
  });
});

// ---------------------------------------------------------------------------
// deserializeCampaign
// ---------------------------------------------------------------------------

describe("deserializeCampaign", () => {
  function buildCampaignBytes(opts: {
    campaignId: bigint;
    status: number;
    thresholdBps: number;
    deadlineUnix: bigint;
  }): Uint8Array {
    const buf = Buffer.alloc(
      DISCRIMINATOR_LEN + 8 + 32 * 4 + 8 + 32 + 32 + 1 + 2 + 8 + 1 + 8 + 1,
    );
    let o = DISCRIMINATOR_LEN;

    // campaign_id u64 LE
    buf.writeBigUInt64LE(opts.campaignId, o);
    o += 8;
    // creator, executor, mint, escrow_token_account (32 bytes each — use zero pubkeys)
    o += 32 * 4;
    // amount u64
    buf.writeBigUInt64LE(1_000_000n, o);
    o += 8;
    // task_ref [u8;32]
    o += 32;
    // validator_set_hash [u8;32]
    o += 32;
    // validator_count u8
    buf[o] = 3;
    o += 1;
    // threshold_bps u16 LE
    buf.writeUInt16LE(opts.thresholdBps, o);
    o += 2;
    // deadline_unix i64 LE
    buf.writeBigInt64LE(opts.deadlineUnix, o);
    o += 8;
    // status u8
    buf[o] = opts.status;
    o += 1;
    // created_at_unix i64
    buf.writeBigInt64LE(1_700_000_000n, o);
    o += 8;
    // bump u8
    buf[o] = 255;

    return new Uint8Array(buf);
  }

  it("deserializes campaignId correctly", () => {
    const bytes = buildCampaignBytes({
      campaignId: 42n,
      status: 0,
      thresholdBps: 5000,
      deadlineUnix: 9_999_999_999n,
    });
    const account = deserializeCampaign(bytes);
    expect(account.campaignId).toBe(42n);
  });

  it("deserializes thresholdBps correctly", () => {
    const bytes = buildCampaignBytes({
      campaignId: 1n,
      status: 0,
      thresholdBps: 7500,
      deadlineUnix: 9_999_999_999n,
    });
    const account = deserializeCampaign(bytes);
    expect(account.thresholdBps).toBe(7500);
  });

  it("deserializes status open=0, settled_success=1, settled_refund=2", () => {
    for (const [raw, expected] of [
      [0, CAMPAIGN_STATUS.OPEN],
      [1, CAMPAIGN_STATUS.SETTLED_SUCCESS],
      [2, CAMPAIGN_STATUS.SETTLED_REFUND],
    ] as const) {
      const bytes = buildCampaignBytes({
        campaignId: 1n,
        status: raw,
        thresholdBps: 5000,
        deadlineUnix: 9_999_999_999n,
      });
      const account = deserializeCampaign(bytes);
      expect(account.status).toBe(expected);
    }
  });

  it("deserializes deadlineUnix correctly", () => {
    const bytes = buildCampaignBytes({
      campaignId: 1n,
      status: 0,
      thresholdBps: 5000,
      deadlineUnix: 1_800_000_000n,
    });
    const account = deserializeCampaign(bytes);
    expect(account.deadlineUnix).toBe(1_800_000_000n);
  });
});

// ---------------------------------------------------------------------------
// deserializeValidatorScore
// ---------------------------------------------------------------------------

describe("deserializeValidatorScore", () => {
  it("deserializes scoreBps and submittedAtUnix", () => {
    const buf = Buffer.alloc(DISCRIMINATOR_LEN + 32 + 32 + 2 + 8 + 1);
    let o = DISCRIMINATOR_LEN;
    // campaign pubkey (zero)
    o += 32;
    // validator pubkey (zero)
    o += 32;
    // score_bps u16 LE
    buf.writeUInt16LE(8_500, o);
    o += 2;
    // submitted_at_unix i64 LE
    buf.writeBigInt64LE(1_700_000_100n, o);
    o += 8;
    // bump
    buf[o] = 200;

    const account = deserializeValidatorScore(new Uint8Array(buf));
    expect(account.scoreBps).toBe(8_500);
    expect(account.submittedAtUnix).toBe(1_700_000_100n);
    expect(account.bump).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// statusLabel
// ---------------------------------------------------------------------------

describe("statusLabel", () => {
  it("maps 0 → open, 1 → settled_success, 2 → settled_refund", () => {
    expect(statusLabel(0)).toBe("open");
    expect(statusLabel(1)).toBe("settled_success");
    expect(statusLabel(2)).toBe("settled_refund");
  });

  it("defaults unknown values to open", () => {
    expect(statusLabel(99)).toBe("open");
  });
});

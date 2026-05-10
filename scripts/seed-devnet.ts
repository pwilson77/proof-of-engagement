/**
 * seed-devnet.ts — Seed demo campaigns on Solana devnet (or any live cluster).
 *
 * Usage:
 *   MINT=<token-mint-address> npx tsx seed-devnet.ts
 *
 * Funded actors are the same deterministic keypairs as localnet so dashboard
 * screenshots look consistent.
 *
 * Campaigns seeded:
 *   #1 — OPEN         Alice+Bob+Carol validators, Alpha executor  (no scores yet)
 *   #2 — OPEN (RFQ)   Alice+Dave validators, bid window open
 *   #3 — SETTLED      Bob+Carol validators,  Gamma executor  (Bob 9000, Carol 8500)
 *   #4 — OPEN         Five-validator primary demo campaign
 *   #5 — OPEN         Three-validator fallback demo campaign
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha2.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  PoeClient,
  findCampaignPda,
  findValidatorSetPda,
  findValidatorScorePda,
  deserializeCampaign,
  statusLabel,
  CAMPAIGN_STATUS,
  PROGRAM_ID,
} from "@poe/sdk";

// ── Deterministic keypairs (same seeds as seed-local.ts) ───────────────────
function deterministicKp(label: string): Keypair {
  const seed = new Uint8Array(32);
  const enc = new TextEncoder().encode(label);
  seed.set(enc.slice(0, 32));
  return Keypair.fromSeed(seed);
}

const ALICE = deterministicKp("poe:validator:alice:000000000000");
const BOB = deterministicKp("poe:validator:bob:0000000000000");
const CAROL = deterministicKp("poe:validator:carol:00000000000");
const DAVE = deterministicKp("poe:validator:dave:0000000000000");
const ERIN = deterministicKp("poe:validator:erin:0000000000000");

const ALPHA = deterministicKp("poe:executor:alpha:00000000000000");
const GAMMA = deterministicKp("poe:executor:gamma:0000000000000000");

function loadDefaultKeypair(): Keypair {
  const raw = JSON.parse(
    readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"),
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function encodeU16LE(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function disc(name: string): Buffer {
  return Buffer.from(
    sha256(new TextEncoder().encode(`global:${name}`)),
  ).subarray(0, 8);
}

const DISC_SUBMIT_SCORE = disc("submit_validator_score");
const DISC_SETTLE_SUCCESS = disc("settle_success");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomTaskRef(): Uint8Array {
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

async function fundIfNeeded(
  connection: Connection,
  payer: Keypair,
  pk: PublicKey,
  minLamports = 50_000_000, // 0.05 SOL
) {
  const bal = await connection.getBalance(pk);
  if (bal < minLamports) {
    console.log(`    transfer 0.1 SOL → ${pk.toBase58().slice(0, 8)}…`);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: pk,
        lamports: 100_000_000,
      }),
    );
    const sig = await connection.sendTransaction(tx, [payer]);
    await connection.confirmTransaction(sig, "confirmed");
    await sleep(500);
  }
}

async function submitValidatorScore(
  connection: Connection,
  signer: Keypair,
  creator: PublicKey,
  campaignId: bigint,
  scoreBps: number,
): Promise<string> {
  const [campaignPda] = await findCampaignPda(creator, campaignId);
  const [validatorSetPda] = await findValidatorSetPda(creator, campaignId);
  const [scorePda] = await findValidatorScorePda(campaignPda, signer.publicKey);

  const data = Buffer.concat([
    DISC_SUBMIT_SCORE,
    encodeU64LE(campaignId),
    encodeU16LE(scoreBps),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: campaignPda, isSigner: false, isWritable: true },
      { pubkey: validatorSetPda, isSigner: false, isWritable: false },
      { pubkey: scorePda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [signer]);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function settleSuccess(
  connection: Connection,
  payer: Keypair,
  creator: PublicKey,
  campaignId: bigint,
  _usdcMint: PublicKey,
  executorPk: PublicKey,
  validators: Keypair[],
): Promise<string> {
  const [campaignPda] = await findCampaignPda(creator, campaignId);

  // Read the real escrow address from on-chain campaign data (it's a random keypair set at init)
  const campaignInfo = await connection.getAccountInfo(campaignPda);
  if (!campaignInfo) throw new Error(`Campaign ${campaignId} not found`);
  const campaignAccount = deserializeCampaign(
    new Uint8Array(campaignInfo.data),
  );
  const escrowTokenAccount = campaignAccount.escrowTokenAccount;

  const usdcMint = campaignAccount.mint;
  const executorAta = await getAssociatedTokenAddress(usdcMint, executorPk);

  const scorePdaKeys = await Promise.all(
    validators.map(async (v) => {
      const [pda] = await findValidatorScorePda(campaignPda, v.publicKey);
      return { pubkey: pda, isSigner: false, isWritable: false };
    }),
  );

  const data = Buffer.concat([disc("settle_success"), encodeU64LE(campaignId)]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: campaignPda, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: executorAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...scorePdaKeys,
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function campaignExists(
  connection: Connection,
  creator: PublicKey,
  campaignId: bigint,
): Promise<boolean> {
  const [pda] = await findCampaignPda(creator, campaignId);
  const info = await connection.getAccountInfo(pda);
  return info !== null;
}

async function campaignStatus(
  connection: Connection,
  creator: PublicKey,
  campaignId: bigint,
): Promise<number | null> {
  const [pda] = await findCampaignPda(creator, campaignId);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return deserializeCampaign(new Uint8Array(info.data)).status;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const mintArg = process.env.MINT;
  if (!mintArg) throw new Error("Set MINT=<token-mint-pubkey> env variable.");

  const rpc =
    process.env.RPC_URL ??
    "https://devnet.helius-rpc.com/?api-key=b539e607-6c09-4971-9115-7e8e1befc126";
  const connection = new Connection(rpc, "confirmed");
  const payer = loadDefaultKeypair();
  const usdcMint = new PublicKey(mintArg);

  console.log("\n▶ seed-devnet");
  console.log("  payer:", payer.publicKey.toBase58());
  console.log("  mint: ", usdcMint.toBase58());

  const sdk = new PoeClient({ connection, payer });

  // ── Fund actors ─────────────────────────────────────────────────────────────
  console.log("\n▶ Fund validator/executor keypairs…");
  for (const kp of [ALICE, BOB, CAROL, DAVE, ERIN, ALPHA, GAMMA]) {
    await fundIfNeeded(connection, payer, kp.publicKey);
  }

  // ── Create ATAs & fund tokens ───────────────────────────────────────────────
  console.log("\n▶ Create token accounts…");
  const ataTxKeys = [payer.publicKey, ALPHA.publicKey, GAMMA.publicKey];
  const createAtaIxs = await Promise.all(
    ataTxKeys.map((owner) =>
      getAssociatedTokenAddress(usdcMint, owner).then((ata) =>
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          ata,
          owner,
          usdcMint,
        ),
      ),
    ),
  );

  const ataTx = new Transaction().add(...createAtaIxs);
  const ataSig = await connection.sendTransaction(ataTx, [payer]);
  await connection.confirmTransaction(ataSig, "confirmed");
  console.log("  ✓ ATAs ready");

  const now = Math.floor(Date.now() / 1000);

  // ── Campaign #1 — OPEN, direct mode ────────────────────────────────────────
  console.log("\n▶ Campaign #1 — OPEN direct");
  if (await campaignExists(connection, payer.publicKey, 1n)) {
    console.log("  ✓ already exists — skipping");
  } else {
    await sdk.createCampaign({
      campaignId: 1n,
      executor: ALPHA.publicKey,
      validators: [ALICE.publicKey, BOB.publicKey, CAROL.publicKey],
      thresholdBps: 7000,
      amount: 500_000n,
      taskRef: randomTaskRef(),
      deadlineUnix: BigInt(now + 86400 * 7),
    });
    console.log("  ✓ campaign #1 open");
  }

  // ── Campaign #2 — OPEN, RFQ mode ───────────────────────────────────────────
  console.log("\n▶ Campaign #2 — OPEN RFQ");
  if (await campaignExists(connection, payer.publicKey, 2n)) {
    console.log("  ✓ already exists — skipping");
  } else {
    await sdk.createCampaignRfq({
      campaignId: 2n,
      amount: 1_000_000n,
      taskRef: randomTaskRef(),
      validators: [ALICE.publicKey, DAVE.publicKey],
      thresholdBps: 6000,
      deadlineUnix: BigInt(now + 86400 * 14),
      rfqDeadlineUnix: BigInt(now + 86400 * 3),
    });
    console.log("  ✓ campaign #2 open (RFQ)");
  }

  // ── Campaign #3 — SETTLED_SUCCESS ──────────────────────────────────────────
  console.log("\n▶ Campaign #3 — settle success");
  if (!(await campaignExists(connection, payer.publicKey, 3n))) {
    await sdk.createCampaign({
      campaignId: 3n,
      executor: GAMMA.publicKey,
      validators: [BOB.publicKey, CAROL.publicKey],
      thresholdBps: 6000,
      amount: 250_000n,
      taskRef: randomTaskRef(),
      deadlineUnix: BigInt(now + 86400 * 7),
    });
    await sleep(1000);
  }

  const c3Status = await campaignStatus(connection, payer.publicKey, 3n);
  if (c3Status !== CAMPAIGN_STATUS.OPEN) {
    console.log(
      `  ✓ campaign #3 already ${statusLabel(c3Status ?? 0)} — skipping settle`,
    );
  } else {
    // Score submissions are idempotent — skip if already scored
    for (const [actor, score] of [
      [BOB, 9000],
      [CAROL, 8500],
    ] as const) {
      try {
        await submitValidatorScore(
          connection,
          actor,
          payer.publicKey,
          3n,
          score,
        );
        console.log(`  ✓ ${actor === BOB ? "Bob" : "Carol"} scored ${score}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("already in use") || msg.includes("0x0")) {
          console.log(
            `  ✓ ${actor === BOB ? "Bob" : "Carol"} score already submitted`,
          );
        } else {
          throw e;
        }
      }
    }

    const gammaAta = await getAssociatedTokenAddress(usdcMint, GAMMA.publicKey);
    const ensureGammaAtaTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        gammaAta,
        GAMMA.publicKey,
        usdcMint,
      ),
    );
    const ensureSig = await connection.sendTransaction(ensureGammaAtaTx, [payer]);
    await connection.confirmTransaction(ensureSig, "confirmed");

    await settleSuccess(
      connection,
      payer,
      payer.publicKey,
      3n,
      usdcMint,
      GAMMA.publicKey,
      [BOB, CAROL],
    );
    console.log("  ✓ campaign #3 settled success");
  }

  // ── Campaign #4 — OPEN, primary validation demo (5 validators) ───────────
  console.log("\n▶ Campaign #4 — OPEN primary (5 validators)");
  if (await campaignExists(connection, payer.publicKey, 4n)) {
    console.log("  ✓ already exists — skipping");
  } else {
    await sdk.createCampaign({
      campaignId: 4n,
      executor: ALPHA.publicKey,
      validators: [
        ALICE.publicKey,
        BOB.publicKey,
        CAROL.publicKey,
        DAVE.publicKey,
        ERIN.publicKey,
      ],
      thresholdBps: 7000,
      amount: 800_000n,
      taskRef: randomTaskRef(),
      deadlineUnix: BigInt(now + 86400 * 7),
    });
    console.log("  ✓ campaign #4 open (5 validators)");
  }

  // ── Campaign #5 — OPEN, fallback validation demo (3 validators) ──────────
  console.log("\n▶ Campaign #5 — OPEN fallback (3 validators)");
  if (await campaignExists(connection, payer.publicKey, 5n)) {
    console.log("  ✓ already exists — skipping");
  } else {
    await sdk.createCampaign({
      campaignId: 5n,
      executor: ALPHA.publicKey,
      validators: [ALICE.publicKey, CAROL.publicKey, ERIN.publicKey],
      thresholdBps: 6500,
      amount: 400_000n,
      taskRef: randomTaskRef(),
      deadlineUnix: BigInt(now + 86400 * 7),
    });
    console.log("  ✓ campaign #5 open (fallback)");
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n✅ Devnet seed complete");
  console.log("  #1 — OPEN (direct)         campaignId=1");
  console.log("  #2 — OPEN (RFQ)            campaignId=2");
  console.log("  #3 — SETTLED_SUCCESS       campaignId=3");
  console.log("  #4 — OPEN (5 validators)   campaignId=4");
  console.log("  #5 — OPEN (fallback)       campaignId=5");
  console.log(
    "\nOpen the dashboard, set RPC to https://devnet.helius-rpc.com/?api-key=b539e607-6c09-4971-9115-7e8e1befc126",
  );
}

main().catch((e) => {
  console.error("seed-devnet failed:", e);
  process.exit(1);
});

/**
 * seed-local.ts — Populate the local solana-test-validator with demo campaigns.
 *
 * Usage:
 *   MINT=<token-mint-address> npx tsx seed-local.ts
 *
 * Creates 3 campaigns:
 *   #1 — OPEN            (long deadline, 5 USDC)
 *   #2 — SETTLED_SUCCESS (payer is executor + sole validator; score then settled)
 *   #3 — SETTLED_REFUND  (2-second deadline, timeout triggered)
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
  findConfigPda,
  findCampaignPda,
  findValidatorSetPda,
  findValidatorScorePda,
  PROGRAM_ID,
} from "@poe/sdk";

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
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`))).subarray(0, 8);
}

const DISC_INIT_CONFIG  = disc("initialize_config");
const DISC_SUBMIT_SCORE = disc("submit_validator_score");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomTaskRef(): Uint8Array {
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

async function initializeConfig(
  connection: Connection,
  authority: Keypair,
  usdcMint: PublicKey,
): Promise<string> {
  const [configPda] = await findConfigPda();
  if (await connection.getAccountInfo(configPda)) {
    return "already_initialized";
  }
  const data = Buffer.concat([DISC_INIT_CONFIG, usdcMint.toBuffer()]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [authority]);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function submitValidatorScore(
  connection: Connection,
  signer: Keypair,
  creator: PublicKey,
  campaignId: bigint,
  scoreBps: number,
): Promise<string> {
  const [campaignPda]     = await findCampaignPda(creator, campaignId);
  const [validatorSetPda] = await findValidatorSetPda(creator, campaignId);
  const [scorePda]        = await findValidatorScorePda(campaignPda, signer.publicKey);

  const data = Buffer.concat([
    DISC_SUBMIT_SCORE,
    encodeU64LE(campaignId),
    encodeU16LE(scoreBps),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: signer.publicKey, isSigner: true,  isWritable: true  },
      { pubkey: campaignPda,      isSigner: false, isWritable: true  },
      { pubkey: validatorSetPda,  isSigner: false, isWritable: false },
      { pubkey: scorePda,         isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [signer]);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  const mintArg = process.env.MINT;
  if (!mintArg) throw new Error("Set MINT=<token-mint-pubkey> env variable.");

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer      = loadDefaultKeypair();
  const usdcMint   = new PublicKey(mintArg);
  const sdk        = new PoeClient({ connection, payer });

  console.log("\n══════════════════════════════════════════");
  console.log("  PoE local validator seeder");
  console.log("══════════════════════════════════════════");
  console.log(`  payer: ${payer.publicKey.toBase58()}`);
  console.log(`  mint:  ${usdcMint.toBase58()}`);

  console.log("\n▶ initialize_config…");
  const initSig = await initializeConfig(connection, payer, usdcMint);
  console.log(`  ${initSig}`);

  const now  = Math.floor(Date.now() / 1000);
  const id1  = BigInt(now + 1);
  const id2  = BigInt(now + 2);
  const id3  = BigInt(now + 3);

  const creatorAta = await getAssociatedTokenAddress(usdcMint, payer.publicKey);

  // ── Campaign 1: OPEN ────────────────────────────────────────────────────
  console.log(`\n▶ Campaign #${id1} → OPEN`);
  const r1 = await sdk.createCampaign({
    campaignId:   id1,
    executor:     Keypair.generate().publicKey,
    amount:       5_000_000n,
    taskRef:      randomTaskRef(),
    validators:   [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey],
    thresholdBps: 6000,
    deadlineUnix: BigInt(now + 365 * 24 * 3600),
  });
  console.log(`  created: ${r1.txSignature}`);
  const s1 = await sdk.queryCampaignStatus(payer.publicKey, id1);
  console.log(`  status:  ${s1.statusLabel} ✓`);

  // ── Campaign 2: SETTLED_SUCCESS ─────────────────────────────────────────
  // payer = executor + sole validator, so we can submit score and settle.
  console.log(`\n▶ Campaign #${id2} → SETTLED_SUCCESS`);

  // Ensure payer ATA exists
  const prepTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey, creatorAta, payer.publicKey, usdcMint,
    ),
  );
  const prepSig = await connection.sendTransaction(prepTx, [payer]);
  await connection.confirmTransaction(prepSig, "confirmed");

  const r2 = await sdk.createCampaign({
    campaignId:   id2,
    executor:     payer.publicKey,
    amount:       2_500_000n,
    taskRef:      randomTaskRef(),
    validators:   [payer.publicKey],
    thresholdBps: 5000,
    deadlineUnix: BigInt(now + 365 * 24 * 3600),
  });
  console.log(`  created: ${r2.txSignature}`);

  const scoreSig = await submitValidatorScore(
    connection, payer, payer.publicKey, id2, 9000,
  );
  console.log(`  scored:  ${scoreSig}`);

  const [campaignPda2] = await findCampaignPda(payer.publicKey, id2);
  const [scorePda2]    = await findValidatorScorePda(campaignPda2, payer.publicKey);

  const settleSig = await sdk.triggerSettleSuccess(
    payer.publicKey, id2, creatorAta, [scorePda2],
  );
  console.log(`  settled: ${settleSig.txSignature}`);
  const s2 = await sdk.queryCampaignStatus(payer.publicKey, id2);
  console.log(`  status:  ${s2.statusLabel} ✓`);

  // ── Campaign 3: SETTLED_REFUND ──────────────────────────────────────────
  console.log(`\n▶ Campaign #${id3} → SETTLED_REFUND`);
  // Refresh timestamp — previous transactions took a few seconds
  const now3 = Math.floor(Date.now() / 1000);
  const r3 = await sdk.createCampaign({
    campaignId:   id3,
    executor:     Keypair.generate().publicKey,
    amount:       1_000_000n,
    taskRef:      randomTaskRef(),
    validators:   [Keypair.generate().publicKey, Keypair.generate().publicKey],
    thresholdBps: 8000,
    deadlineUnix: BigInt(now3 + 10),   // 10s from now — definitely in the future
  });
  console.log(`  created: ${r3.txSignature}`);
  console.log("  Waiting 12s for deadline to expire…");
  await sleep(12000);

  const refundSig = await sdk.triggerTimeoutRefund(
    payer.publicKey, id3, creatorAta,
  );
  console.log(`  refunded: ${refundSig.txSignature}`);
  const s3 = await sdk.queryCampaignStatus(payer.publicKey, id3);
  console.log(`  status:   ${s3.statusLabel} ✓`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log("  Seed complete!");
  console.log(`  Campaign #${id1}: open`);
  console.log(`  Campaign #${id2}: settled_success`);
  console.log(`  Campaign #${id3}: settled_refund`);
  console.log("");
  console.log("  Dashboard: http://localhost:3000/dashboard");
  console.log("  RPC:       http://127.0.0.1:8899");
  console.log("══════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\nSeed failed:", err?.message ?? err);
  if (err?.logs) console.error("  logs:", err.logs);
  process.exit(1);
});

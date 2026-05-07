/**
 * seed-local.ts — Populate the local solana-test-validator with demo campaigns.
 *
 * Usage:
 *   MINT=<token-mint-address> npx tsx seed-local.ts
 *
 * Actors (deterministic keypairs derived from fixed seeds):
 *   Validators: Alice, Bob, Carol, Dave, Eve
 *   Executors:  Alpha, Beta, Gamma
 *
 * Campaigns:
 *   #1 — OPEN            Alice+Bob+Carol validators, Alpha executor  (Alice 8200, Bob 7500, Carol pending)
 *   #2 — OPEN            Alice+Dave+Eve validators,  Beta executor   (no scores)
 *   #3 — SETTLED_SUCCESS Bob+Carol validators,       Alpha executor  (Bob 9000, Carol 8500 → settled)
 *   #4 — SETTLED_SUCCESS Alice validator,            Gamma executor  (Alice 9500 → settled)
 *   #5 — SETTLED_REFUND  Dave+Eve validators,        Beta executor   (deadline expired → refund)
 *   #6 — OPEN            Bob+Dave+Eve validators,    Gamma executor  (Bob 8000, others pending)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
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

// ── Deterministic keypairs ────────────────────────────────────────────────────
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
const EVE = deterministicKp("poe:validator:eve:00000000000000");

const ALPHA = deterministicKp("poe:executor:alpha:00000000000000");
const BETA = deterministicKp("poe:executor:beta:000000000000000");
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

const DISC_INIT_CONFIG = disc("initialize_config");
const DISC_SUBMIT_SCORE = disc("submit_validator_score");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomTaskRef(): Uint8Array {
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

function extractErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function settleTimeoutRefundWithRetry(
  sdk: PoeClient,
  creator: PublicKey,
  campaignId: bigint,
  creatorAta: PublicKey,
): Promise<{ txSignature: string }> {
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sdk.triggerTimeoutRefund(creator, campaignId, creatorAta);
    } catch (err: unknown) {
      const msg = extractErrorText(err);
      let logs: string[] = [];

      if (err instanceof SendTransactionError) {
        try {
          logs = await err.getLogs();
        } catch {
          // best effort
        }
      } else if (typeof err === "object" && err !== null && "logs" in err) {
        const maybeLogs = (err as { logs?: unknown }).logs;
        if (Array.isArray(maybeLogs))
          logs = maybeLogs.filter((x): x is string => typeof x === "string");
      }

      const deadlineNotReached =
        msg.includes("DeadlineNotReached") ||
        logs.some(
          (l) =>
            l.includes("DeadlineNotReached") ||
            l.includes("deadline not reached"),
        );

      if (!deadlineNotReached || attempt === maxAttempts) {
        if (logs.length > 0) {
          console.error("  timeout-refund logs:", logs);
        }
        throw err;
      }

      console.log(
        `  deadline not reached yet (attempt ${attempt}/${maxAttempts}); retrying in 2s…`,
      );
      await sleep(2000);
    }
  }

  throw new Error("Timeout refund retries exhausted");
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

async function main() {
  const mintArg = process.env.MINT;
  if (!mintArg) throw new Error("Set MINT=<token-mint-pubkey> env variable.");

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = loadDefaultKeypair();
  const usdcMint = new PublicKey(mintArg);
  const sdk = new PoeClient({ connection, payer });

  console.log("\n══════════════════════════════════════════");
  console.log("  PoE local validator seeder");
  console.log("══════════════════════════════════════════");
  console.log(`  payer: ${payer.publicKey.toBase58()}`);
  console.log(`  mint:  ${usdcMint.toBase58()}`);
  console.log("\n  Named actors:");
  console.log(`  Alice:  ${ALICE.publicKey.toBase58()}`);
  console.log(`  Bob:    ${BOB.publicKey.toBase58()}`);
  console.log(`  Carol:  ${CAROL.publicKey.toBase58()}`);
  console.log(`  Dave:   ${DAVE.publicKey.toBase58()}`);
  console.log(`  Eve:    ${EVE.publicKey.toBase58()}`);
  console.log(`  Alpha:  ${ALPHA.publicKey.toBase58()}`);
  console.log(`  Beta:   ${BETA.publicKey.toBase58()}`);
  console.log(`  Gamma:  ${GAMMA.publicKey.toBase58()}`);

  console.log("\n▶ initialize_config…");
  const initSig = await initializeConfig(connection, payer, usdcMint);
  console.log(`  ${initSig}`);

  // ── Fund validators (they need SOL to sign score submissions) ──────────────
  console.log("\n▶ Fund validators with SOL…");
  for (const [name, kp] of [
    ["Alice", ALICE],
    ["Bob", BOB],
    ["Carol", CAROL],
    ["Dave", DAVE],
    ["Eve", EVE],
  ] as [string, Keypair][]) {
    try {
      await connection.requestAirdrop(kp.publicKey, 2_000_000_000);
      await sleep(400);
      console.log(`  ${name}: 2 SOL`);
    } catch {
      console.log(`  ${name}: airdrop skipped (already funded?)`);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const id1 = BigInt(now + 1);
  const id2 = BigInt(now + 2);
  const id3 = BigInt(now + 3);
  const id4 = BigInt(now + 4);
  const id5 = BigInt(now + 5);
  const id6 = BigInt(now + 6);

  const creatorAta = await getAssociatedTokenAddress(usdcMint, payer.publicKey);
  const alphaAta = await getAssociatedTokenAddress(usdcMint, ALPHA.publicKey);
  const betaAta = await getAssociatedTokenAddress(usdcMint, BETA.publicKey);
  const gammaAta = await getAssociatedTokenAddress(usdcMint, GAMMA.publicKey);

  // Ensure creator/executor ATAs exist (needed for settlement constraints)
  const prepTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      creatorAta,
      payer.publicKey,
      usdcMint,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      alphaAta,
      ALPHA.publicKey,
      usdcMint,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      betaAta,
      BETA.publicKey,
      usdcMint,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      gammaAta,
      GAMMA.publicKey,
      usdcMint,
    ),
  );
  const prepSig = await connection.sendTransaction(prepTx, [payer]);
  await connection.confirmTransaction(prepSig, "confirmed");

  // ── Campaign 1: OPEN — Alice+Bob+Carol / Alpha ────────────────────────────
  console.log(`\n▶ Campaign #${id1} → OPEN (Alice+Bob scored, Carol pending)`);
  const r1 = await sdk.createCampaign({
    campaignId: id1,
    executor: ALPHA.publicKey,
    amount: 5_000_000n, // 5 USDC
    taskRef: randomTaskRef(),
    validators: [ALICE.publicKey, BOB.publicKey, CAROL.publicKey],
    thresholdBps: 6000, // 60% needed
    deadlineUnix: BigInt(now + 365 * 24 * 3600),
  });
  console.log(`  created: ${r1.txSignature}`);

  // Alice submits 8200, Bob submits 7500 — Carol hasn't submitted yet
  const score1a = await submitValidatorScore(
    connection,
    ALICE,
    payer.publicKey,
    id1,
    8200,
  );
  console.log(`  Alice scored: ${score1a}`);
  const score1b = await submitValidatorScore(
    connection,
    BOB,
    payer.publicKey,
    id1,
    7500,
  );
  console.log(`  Bob scored:   ${score1b}`);
  const s1 = await sdk.queryCampaignStatus(payer.publicKey, id1);
  console.log(`  status:  ${s1.statusLabel} (${s1.scores.length}/3 scored) ✓`);

  // ── Campaign 2: OPEN — Alice+Dave+Eve / Beta ──────────────────────────────
  console.log(`\n▶ Campaign #${id2} → OPEN (no scores yet)`);
  await sdk.createCampaign({
    campaignId: id2,
    executor: BETA.publicKey,
    amount: 3_000_000n, // 3 USDC
    taskRef: randomTaskRef(),
    validators: [ALICE.publicKey, DAVE.publicKey, EVE.publicKey],
    thresholdBps: 7000, // 70% needed
    deadlineUnix: BigInt(now + 365 * 24 * 3600),
  });
  console.log(`  created ✓`);

  // ── Campaign 3: SETTLED_SUCCESS — Bob+Carol / Alpha ───────────────────────
  console.log(
    `\n▶ Campaign #${id3} → SETTLED_SUCCESS (Bob+Carol, Alpha executor)`,
  );
  const r3 = await sdk.createCampaign({
    campaignId: id3,
    executor: ALPHA.publicKey,
    amount: 2_500_000n, // 2.5 USDC
    taskRef: randomTaskRef(),
    validators: [BOB.publicKey, CAROL.publicKey],
    thresholdBps: 5000, // 50% needed
    deadlineUnix: BigInt(now + 365 * 24 * 3600),
  });
  console.log(`  created: ${r3.txSignature}`);

  const score3a = await submitValidatorScore(
    connection,
    BOB,
    payer.publicKey,
    id3,
    9000,
  );
  console.log(`  Bob scored:   ${score3a}`);
  const score3b = await submitValidatorScore(
    connection,
    CAROL,
    payer.publicKey,
    id3,
    8500,
  );
  console.log(`  Carol scored: ${score3b}`);

  const [campaignPda3] = await findCampaignPda(payer.publicKey, id3);
  const [scorePda3a] = await findValidatorScorePda(campaignPda3, BOB.publicKey);
  const [scorePda3b] = await findValidatorScorePda(
    campaignPda3,
    CAROL.publicKey,
  );
  const settleSig3 = await sdk.triggerSettleSuccess(
    payer.publicKey,
    id3,
    alphaAta,
    [scorePda3a, scorePda3b],
  );
  console.log(`  settled: ${settleSig3.txSignature}`);
  const s3 = await sdk.queryCampaignStatus(payer.publicKey, id3);
  console.log(`  status:  ${s3.statusLabel} ✓`);

  // ── Campaign 4: SETTLED_SUCCESS — Alice / Gamma ───────────────────────────
  console.log(
    `\n▶ Campaign #${id4} → SETTLED_SUCCESS (Alice sole validator, Gamma executor)`,
  );
  const r4 = await sdk.createCampaign({
    campaignId: id4,
    executor: GAMMA.publicKey,
    amount: 1_000_000n, // 1 USDC
    taskRef: randomTaskRef(),
    validators: [ALICE.publicKey],
    thresholdBps: 5000,
    deadlineUnix: BigInt(now + 365 * 24 * 3600),
  });
  console.log(`  created: ${r4.txSignature}`);

  const score4a = await submitValidatorScore(
    connection,
    ALICE,
    payer.publicKey,
    id4,
    9500,
  );
  console.log(`  Alice scored: ${score4a}`);

  const [campaignPda4] = await findCampaignPda(payer.publicKey, id4);
  const [scorePda4a] = await findValidatorScorePda(
    campaignPda4,
    ALICE.publicKey,
  );
  const settleSig4 = await sdk.triggerSettleSuccess(
    payer.publicKey,
    id4,
    gammaAta,
    [scorePda4a],
  );
  console.log(`  settled: ${settleSig4.txSignature}`);
  const s4 = await sdk.queryCampaignStatus(payer.publicKey, id4);
  console.log(`  status:  ${s4.statusLabel} ✓`);

  // ── Campaign 5: SETTLED_REFUND — Dave+Eve / Beta ──────────────────────────
  console.log(
    `\n▶ Campaign #${id5} → SETTLED_REFUND (deadline expires in 10s)`,
  );
  const now5 = Math.floor(Date.now() / 1000);
  await sdk.createCampaign({
    campaignId: id5,
    executor: BETA.publicKey,
    amount: 4_000_000n, // 4 USDC
    taskRef: randomTaskRef(),
    validators: [DAVE.publicKey, EVE.publicKey],
    thresholdBps: 8000,
    deadlineUnix: BigInt(now5 + 10), // 10s from now
  });
  console.log("  created ✓ — waiting for on-chain deadline and refunding…");
  const refundSig = await settleTimeoutRefundWithRetry(
    sdk,
    payer.publicKey,
    id5,
    creatorAta,
  );
  console.log(`  refunded: ${refundSig.txSignature}`);
  const s5 = await sdk.queryCampaignStatus(payer.publicKey, id5);
  console.log(`  status:   ${s5.statusLabel} ✓`);

  // ── Campaign 6: OPEN — Bob+Dave+Eve / Gamma ────────────────────────────────
  console.log(`\n▶ Campaign #${id6} → OPEN (Bob scored, Dave+Eve pending)`);
  await sdk.createCampaign({
    campaignId: id6,
    executor: GAMMA.publicKey,
    amount: 6_000_000n, // 6 USDC
    taskRef: randomTaskRef(),
    validators: [BOB.publicKey, DAVE.publicKey, EVE.publicKey],
    thresholdBps: 7500, // 75% needed
    deadlineUnix: BigInt(now + 365 * 24 * 3600),
  });
  console.log(`  created ✓`);
  const score6a = await submitValidatorScore(
    connection,
    BOB,
    payer.publicKey,
    id6,
    8000,
  );
  console.log(`  Bob scored:  ${score6a}`);
  const s6 = await sdk.queryCampaignStatus(payer.publicKey, id6);
  console.log(`  status:  ${s6.statusLabel} (${s6.scores.length}/3 scored) ✓`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log("  Seed complete!");
  console.log(`  Campaign #${id1}: open            (Alice+Bob scored)`);
  console.log(`  Campaign #${id2}: open            (no scores)`);
  console.log(`  Campaign #${id3}: settled_success (Bob+Carol)`);
  console.log(`  Campaign #${id4}: settled_success (Alice)`);
  console.log(`  Campaign #${id5}: settled_refund  (Dave+Eve)`);
  console.log(`  Campaign #${id6}: open            (Bob scored)`);
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

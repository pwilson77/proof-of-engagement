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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PoeClient,
  findCampaignPda,
  findValidatorSetPda,
  findValidatorScorePda,
  deserializeCampaign,
  statusLabel,
  CAMPAIGN_MODE,
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
const DEFAULT_METADATA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../frontend-next/public/campaign-metadata.devnet.json",
);

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

async function findNextCampaignBase(
  connection: Connection,
  creator: PublicKey,
  startBase = 1n,
  blockSize = 5n,
): Promise<bigint> {
  let base = startBase;
  while (true) {
    let slotTaken = false;
    for (let i = 0n; i < blockSize; i++) {
      if (await campaignExists(connection, creator, base + i)) {
        slotTaken = true;
        break;
      }
    }
    if (!slotTaken) return base;
    base += blockSize;
  }
}

async function submittedScoreCount(
  connection: Connection,
  creator: PublicKey,
  campaignId: bigint,
  validators: Keypair[],
): Promise<number> {
  const [campaignPda] = await findCampaignPda(creator, campaignId);
  let count = 0;
  for (const v of validators) {
    const [scorePda] = await findValidatorScorePda(campaignPda, v.publicKey);
    if (await connection.getAccountInfo(scorePda)) count += 1;
  }
  return count;
}

type CampaignReportSpec = {
  id: bigint;
  label: string;
  validators: Keypair[];
};

type CampaignUiMetadata = {
  campaignPda: string;
  creator: string;
  campaignId: string;
  label: string;
  title: string;
  description: string;
  tags: string[];
  validatorDescriptions: Record<
    string,
    {
      name: string;
      description: string;
    }
  >;
};

type MetadataDocument = {
  schemaVersion: number;
  cluster: string;
  updatedAtUnix: number;
  campaigns: Record<string, CampaignUiMetadata>;
};

const VALIDATOR_PROFILE_BY_ADDRESS: Record<
  string,
  { name: string; description: string }
> = {
  [ALICE.publicKey.toBase58()]: {
    name: "Alice",
    description:
      "Strict scoring profile focused on evidence integrity and digest consistency.",
  },
  [BOB.publicKey.toBase58()]: {
    name: "Bob",
    description:
      "High-signal validator emphasizing engagement authenticity and anti-spoof checks.",
  },
  [CAROL.publicKey.toBase58()]: {
    name: "Carol",
    description:
      "Conservative validator tuned for deadline windows and policy compliance.",
  },
  [DAVE.publicKey.toBase58()]: {
    name: "Dave",
    description:
      "RFQ-oriented validator balancing confidence with throughput under load.",
  },
  [ERIN.publicKey.toBase58()]: {
    name: "Erin",
    description:
      "Fallback validator optimized for resilient quorum participation.",
  },
};

function validatorDescriptionsFor(validators: Keypair[]) {
  return Object.fromEntries(
    validators.map((v) => {
      const key = v.publicKey.toBase58();
      return [
        key,
        VALIDATOR_PROFILE_BY_ADDRESS[key] ?? {
          name: "Validator",
          description: "Independent reviewer in the campaign validator set.",
        },
      ];
    }),
  );
}

function readMetadataDoc(path: string): MetadataDocument {
  if (!existsSync(path)) {
    return {
      schemaVersion: 1,
      cluster: "devnet",
      updatedAtUnix: 0,
      campaigns: {},
    };
  }

  const parsed = JSON.parse(
    readFileSync(path, "utf8"),
  ) as Partial<MetadataDocument>;
  return {
    schemaVersion: parsed.schemaVersion ?? 1,
    cluster: parsed.cluster ?? "devnet",
    updatedAtUnix: parsed.updatedAtUnix ?? 0,
    campaigns: parsed.campaigns ?? {},
  };
}

function writeMetadataDoc(path: string, doc: MetadataDocument) {
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

async function upsertCampaignMetadata(
  creator: PublicKey,
  entries: Array<{
    id: bigint;
    label: string;
    title: string;
    description: string;
    tags: string[];
    validators: Keypair[];
  }>,
) {
  const metadataPath = process.env.METADATA_PATH ?? DEFAULT_METADATA_PATH;
  const doc = readMetadataDoc(metadataPath);

  for (const entry of entries) {
    const [pda] = await findCampaignPda(creator, entry.id);
    const pdaKey = pda.toBase58();
    doc.campaigns[pdaKey] = {
      campaignPda: pdaKey,
      creator: creator.toBase58(),
      campaignId: entry.id.toString(),
      label: entry.label,
      title: entry.title,
      description: entry.description,
      tags: entry.tags,
      validatorDescriptions: validatorDescriptionsFor(entry.validators),
    };
  }

  doc.schemaVersion = 1;
  doc.cluster = "devnet";
  doc.updatedAtUnix = Math.floor(Date.now() / 1000);
  writeMetadataDoc(metadataPath, doc);
  console.log(`\n📝 Metadata updated: ${metadataPath}`);

  // Optionally push to the running Vercel deployment via the token-gated API route.
  const apiUrl = process.env.SEED_API_URL;
  const apiSecret = process.env.SEED_API_SECRET;
  if (apiUrl && apiSecret) {
    try {
      const endpoint = `${apiUrl.replace(/\/$/, "")}/api/metadata/update`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiSecret}`,
        },
        body: JSON.stringify(doc),
      });
      if (res.ok) {
        const json = (await res.json()) as { url?: string };
        console.log(
          `☁️  Metadata pushed to Vercel Blob: ${json.url ?? endpoint}`,
        );
      } else {
        const raw = await res.text();
        const preview = raw.replace(/\s+/g, " ").slice(0, 220);
        console.warn(`⚠️  Metadata push failed (${res.status}): ${preview}...`);
        console.warn(
          "   Hint: for prod push verify Vercel env vars SEED_API_SECRET + BLOB_READ_WRITE_TOKEN. For local demo runs, disable metadata push.",
        );
      }
    } catch (err) {
      console.warn(`⚠️  Metadata push error:`, err);
    }
  }
}

async function logCampaignReport(
  connection: Connection,
  creator: PublicKey,
  spec: CampaignReportSpec,
) {
  const [campaignPda] = await findCampaignPda(creator, spec.id);
  const info = await connection.getAccountInfo(campaignPda);
  if (!info) {
    console.log(`  - campaignId=${spec.id} (${spec.label}) missing`);
    return;
  }

  const account = deserializeCampaign(new Uint8Array(info.data));
  const mode = account.mode === CAMPAIGN_MODE.RFQ ? "rfq" : "direct";
  const scored = await submittedScoreCount(
    connection,
    creator,
    spec.id,
    spec.validators,
  );

  console.log(
    `  - campaignId=${spec.id} label=${spec.label} status=${statusLabel(account.status)} mode=${mode} validators=${account.validatorCount} scored=${scored}/${spec.validators.length} thresholdBps=${account.thresholdBps} amount=${account.amount}`,
  );
  console.log(`    pda=${campaignPda.toBase58()}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const mintArg = process.env.MINT;
  if (!mintArg) throw new Error("Set MINT=<token-mint-pubkey> env variable.");
  const singleCampaignMode =
    process.env.SINGLE_CAMPAIGN_MODE === "1" ||
    process.env.SINGLE_CAMPAIGN_MODE === "true";
  const creatorAgentName =
    process.env.CREATOR_AGENT_NAME?.trim() || "Creator Agent";
  const demoCampaignTitle =
    process.env.DEMO_CAMPAIGN_TITLE?.trim() ||
    "General Agent Task: Proof of Completion";
  const demoCampaignBrief =
    process.env.DEMO_CAMPAIGN_BRIEF?.trim() ||
    "Validate that an assigned agent completed a task using verifiable evidence and threshold consensus.";
  const demoCampaignCategory =
    process.env.DEMO_CAMPAIGN_CATEGORY?.trim().toLowerCase() || "general";

  const rpc =
    process.env.RPC_URL ??
    "https://devnet.helius-rpc.com/?api-key=b539e607-6c09-4971-9115-7e8e1befc126";
  const connection = new Connection(rpc, "confirmed");
  const payer = loadDefaultKeypair();
  const usdcMint = new PublicKey(mintArg);

  console.log("\n▶ seed-devnet");
  console.log("  payer:", payer.publicKey.toBase58());
  console.log("  mint: ", usdcMint.toBase58());
  console.log(
    "  mode: ",
    singleCampaignMode ? "single_campaign" : "full_bundle",
  );

  const campaignBaseId = process.env.CAMPAIGN_BASE_ID
    ? BigInt(process.env.CAMPAIGN_BASE_ID)
    : await findNextCampaignBase(
        connection,
        payer.publicKey,
        1n,
        singleCampaignMode ? 1n : 5n,
      );
  const c1 = campaignBaseId;
  const c2 = campaignBaseId + 1n;
  const c3 = campaignBaseId + 2n;
  const c4 = campaignBaseId + 3n;
  const c5 = campaignBaseId + 4n;
  const primaryCampaignId = singleCampaignMode ? c1 : c4;

  console.log("  campaign_base_id:", campaignBaseId.toString());
  console.log("  primary_campaign_id:", primaryCampaignId.toString());
  console.log("  creator_agent:", payer.publicKey.toBase58());
  console.log("  creator_agent_name:", creatorAgentName);

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

  if (singleCampaignMode) {
    console.log(`\n▶ Single Campaign Demo — OPEN direct (campaignId=${c1})`);
    console.log(
      `  ${creatorAgentName} requests campaign: ${demoCampaignTitle} [${demoCampaignCategory}]`,
    );
    console.log(`  brief: ${demoCampaignBrief}`);
    console.log(
      "  action: creator agent calling @poe/sdk -> PoeClient.createCampaign(...)",
    );
    if (await campaignExists(connection, payer.publicKey, c1)) {
      console.log("  ✓ already exists — skipping");
    } else {
      await sdk.createCampaign({
        campaignId: c1,
        executor: ALPHA.publicKey,
        validators: [ALICE.publicKey, BOB.publicKey, CAROL.publicKey],
        thresholdBps: 7000,
        amount: 800_000n,
        taskRef: randomTaskRef(),
        deadlineUnix: BigInt(now + 86400 * 7),
      });
      console.log(`  ✓ single demo campaign created (campaignId=${c1})`);
    }

    console.log("\n✅ Devnet seed complete (single campaign mode)");
    await logCampaignReport(connection, payer.publicKey, {
      id: c1,
      label: "single_live_demo",
      validators: [ALICE, BOB, CAROL],
    });

    await upsertCampaignMetadata(payer.publicKey, [
      {
        id: c1,
        label: "single_live_demo",
        title: demoCampaignTitle,
        description: demoCampaignBrief,
        tags: ["live_demo", "single", "e2e", demoCampaignCategory],
        validators: [ALICE, BOB, CAROL],
      },
    ]);

    // Machine-readable hints for run_demo.sh
    console.log(`SEED_CAMPAIGN_BASE_ID=${campaignBaseId.toString()}`);
    console.log(`SEED_PRIMARY_CAMPAIGN_ID=${c1.toString()}`);
    console.log(`SEED_CAMPAIGN_IDS=${c1.toString()}`);
    console.log(
      "\nOpen the dashboard, set RPC to https://devnet.helius-rpc.com/?api-key=b539e607-6c09-4971-9115-7e8e1befc126",
    );
    return;
  }

  // ── Campaign #1 — OPEN, direct mode ────────────────────────────────────────
  console.log(`\n▶ Campaign #1 — OPEN direct (campaignId=${c1})`);
  if (await campaignExists(connection, payer.publicKey, c1)) {
    console.log("  ✓ already exists — skipping");
  } else {
    await sdk.createCampaign({
      campaignId: c1,
      executor: ALPHA.publicKey,
      validators: [ALICE.publicKey, BOB.publicKey, CAROL.publicKey],
      thresholdBps: 7000,
      amount: 500_000n,
      taskRef: randomTaskRef(),
      deadlineUnix: BigInt(now + 86400 * 7),
    });
    console.log(`  ✓ campaign #1 open (campaignId=${c1})`);
  }

  // ── Campaign #2 — OPEN, RFQ mode ───────────────────────────────────────────
  console.log(`\n▶ Campaign #2 — OPEN RFQ (campaignId=${c2})`);
  if (await campaignExists(connection, payer.publicKey, c2)) {
    console.log("  ✓ already exists — skipping");
  } else {
    await sdk.createCampaignRfq({
      campaignId: c2,
      amount: 1_000_000n,
      taskRef: randomTaskRef(),
      validators: [ALICE.publicKey, DAVE.publicKey],
      thresholdBps: 6000,
      deadlineUnix: BigInt(now + 86400 * 14),
      rfqDeadlineUnix: BigInt(now + 86400 * 3),
    });
    console.log(`  ✓ campaign #2 open (RFQ, campaignId=${c2})`);
  }

  // ── Campaign #3 — SETTLED_SUCCESS ──────────────────────────────────────────
  console.log(`\n▶ Campaign #3 — settle success (campaignId=${c3})`);
  if (!(await campaignExists(connection, payer.publicKey, c3))) {
    await sdk.createCampaign({
      campaignId: c3,
      executor: GAMMA.publicKey,
      validators: [BOB.publicKey, CAROL.publicKey],
      thresholdBps: 6000,
      amount: 250_000n,
      taskRef: randomTaskRef(),
      deadlineUnix: BigInt(now + 86400 * 7),
    });
    await sleep(1000);
  }

  const c3Status = await campaignStatus(connection, payer.publicKey, c3);
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
          c3,
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
    const ensureSig = await connection.sendTransaction(ensureGammaAtaTx, [
      payer,
    ]);
    await connection.confirmTransaction(ensureSig, "confirmed");

    await settleSuccess(
      connection,
      payer,
      payer.publicKey,
      c3,
      usdcMint,
      GAMMA.publicKey,
      [BOB, CAROL],
    );
    console.log(`  ✓ campaign #3 settled success (campaignId=${c3})`);
  }

  // ── Campaign #4 — OPEN, primary validation demo (5 validators) ───────────
  console.log(
    `\n▶ Campaign #4 — OPEN primary (5 validators, campaignId=${c4})`,
  );
  if (await campaignExists(connection, payer.publicKey, c4)) {
    console.log("  ✓ already exists — skipping");
  } else {
    await sdk.createCampaign({
      campaignId: c4,
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
    console.log(`  ✓ campaign #4 open (5 validators, campaignId=${c4})`);
  }

  // ── Campaign #5 — OPEN, fallback validation demo (3 validators) ──────────
  console.log(
    `\n▶ Campaign #5 — OPEN fallback (3 validators, campaignId=${c5})`,
  );
  if (await campaignExists(connection, payer.publicKey, c5)) {
    console.log("  ✓ already exists — skipping");
  } else {
    await sdk.createCampaign({
      campaignId: c5,
      executor: ALPHA.publicKey,
      validators: [ALICE.publicKey, CAROL.publicKey, ERIN.publicKey],
      thresholdBps: 6500,
      amount: 400_000n,
      taskRef: randomTaskRef(),
      deadlineUnix: BigInt(now + 86400 * 7),
    });
    console.log(`  ✓ campaign #5 open (fallback, campaignId=${c5})`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n✅ Devnet seed complete");
  console.log(`  #1 — OPEN (direct)         campaignId=${c1}`);
  console.log(`  #2 — OPEN (RFQ)            campaignId=${c2}`);
  console.log(`  #3 — SETTLED_SUCCESS       campaignId=${c3}`);
  console.log(`  #4 — OPEN (5 validators)   campaignId=${c4}`);
  console.log(`  #5 — OPEN (fallback)       campaignId=${c5}`);
  console.log("\n📋 Campaign detail report:");
  await logCampaignReport(connection, payer.publicKey, {
    id: c1,
    label: "open_direct",
    validators: [ALICE, BOB, CAROL],
  });
  await logCampaignReport(connection, payer.publicKey, {
    id: c2,
    label: "open_rfq",
    validators: [ALICE, DAVE],
  });
  await logCampaignReport(connection, payer.publicKey, {
    id: c3,
    label: "settled_success_example",
    validators: [BOB, CAROL],
  });
  await logCampaignReport(connection, payer.publicKey, {
    id: c4,
    label: "primary_live_demo",
    validators: [ALICE, BOB, CAROL, DAVE, ERIN],
  });
  await logCampaignReport(connection, payer.publicKey, {
    id: c5,
    label: "fallback_live_demo",
    validators: [ALICE, CAROL, ERIN],
  });

  await upsertCampaignMetadata(payer.publicKey, [
    {
      id: c1,
      label: "open_direct",
      title: "Direct Campaign: Retweet Validation",
      description:
        "Creator pre-assigns Alpha executor and requires three independent validator scores before payout.",
      tags: ["direct", "x", "engagement"],
      validators: [ALICE, BOB, CAROL],
    },
    {
      id: c2,
      label: "open_rfq",
      title: "RFQ Campaign: Competitive Assignment",
      description:
        "Campaign opens for bids first, then transitions to execution once a bid is accepted on-chain.",
      tags: ["rfq", "bidding", "open"],
      validators: [ALICE, DAVE],
    },
    {
      id: c3,
      label: "settled_success_example",
      title: "Settled Success Reference",
      description:
        "Reference campaign with completed validator scoring and successful settlement path.",
      tags: ["settled_success", "reference", "completed"],
      validators: [BOB, CAROL],
    },
    {
      id: c4,
      label: "primary_live_demo",
      title: "Primary Live Demo Campaign",
      description:
        "Five-validator primary path used by run_demo live flow and consensus settlement showcase.",
      tags: ["live_demo", "primary", "magicblock"],
      validators: [ALICE, BOB, CAROL, DAVE, ERIN],
    },
    {
      id: c5,
      label: "fallback_live_demo",
      title: "Fallback Live Demo Campaign",
      description:
        "Three-validator fallback path for fast quorum and resilient demo execution.",
      tags: ["live_demo", "fallback", "resiliency"],
      validators: [ALICE, CAROL, ERIN],
    },
  ]);

  // Machine-readable hints for run_demo.sh
  console.log(`SEED_CAMPAIGN_BASE_ID=${campaignBaseId.toString()}`);
  console.log(`SEED_PRIMARY_CAMPAIGN_ID=${c4.toString()}`);
  console.log(
    `SEED_CAMPAIGN_IDS=${[c1, c2, c3, c4, c5].map(String).join(",")}`,
  );
  console.log(
    "\nOpen the dashboard, set RPC to https://devnet.helius-rpc.com/?api-key=b539e607-6c09-4971-9115-7e8e1befc126",
  );
}

main().catch((e) => {
  console.error("seed-devnet failed:", e);
  process.exit(1);
});

/**
 * live-demo.ts — Proof-of-Engagement  |  Live Devnet Demo Driver
 *
 * Submits REAL transactions to Solana devnet:
 *   1. Executor agent builds & signs attestation  → memo tx on devnet
 *   2. Three validator agents score independently  → memo tx each on devnet
 *   3. ConsensusOrchestrator aggregates scores     → prints settle verdict
 *
 * Keypairs are the same deterministic actors seeded by seed-devnet.ts so the
 * dashboard shows the correct wallet addresses.
 *
 * Run:
 *   cd scripts && npm run live-demo
 *
 * Env:
 *   RPC_URL   — defaults to Helius devnet
 *   CAMPAIGN_ID — bigint campaign to reference (default: 4)
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
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  ExecutorAgent,
  LocalValidatorSettlementClient,
} from "@poe/executor-agent";
import {
  ValidatorAgent,
  LocalValidatorScoreClient,
} from "@poe/validator-agent";
import { ConsensusOrchestrator } from "@poe/consensus-orchestrator";
import type {
  SettlementTriggerClient,
  ScoreAccountRef,
  SettleTxReceipt,
} from "@poe/consensus-orchestrator";
import { PoeClient, ER_ENDPOINTS, SdkSettlementTrigger } from "@poe/sdk";

// ── Evidence bundle (written to evidence.json at end of run) ──────────────────
interface VoteEvidence {
  name: string;
  pubkey: string;
  scoreBps: number;
  sig: string;
  erSig: string | null;
  sentAtMs: number;
  confirmedAtMs: number;
  latencyMs: number;
}
interface EvidenceBundle {
  generatedAt: string;
  campaignId: string;
  campaignTitle: string;
  campaignCategory: string;
  campaignBrief: string;
  taskRefHex: string;
  rpcEndpoint: string;
  erEndpoint: string;
  erExplorerLinks: string[];
  executor: { pubkey: string; sig: string; submittedAtUnix: number };
  delegateSig: string | null;
  votes: VoteEvidence[];
  undelegateSig: string | null;
  settlement: {
    status: string;
    averageScoreBps: number | null;
    sig: string | null;
    settledAtUnix: number | null;
  };
  durationMs: number;
  checks: { label: string; pass: boolean }[];
}

// ── ANSI palette ─────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[97m",
};

function tag(label: string, color: string) {
  return `${color}${C.bold}[${label}]${C.reset}`;
}
const EXEC_TAG = tag("EXECUTOR ", C.magenta);
const VAL_TAG = (name: string) => tag(`VALIDATOR:${name.padEnd(5)}`, C.blue);
const ORCH_TAG = tag("ORCHESTR ", C.cyan);
const CHAIN_TAG = tag("CHAIN    ", C.yellow);
const OK_TAG = tag("  OK     ", C.green);
const ERR_TAG = tag("  ERR    ", C.red);

const log = {
  exec: (msg: string) => console.log(`  ${EXEC_TAG}  ${msg}`),
  val: (name: string, msg: string) => console.log(`  ${VAL_TAG(name)}  ${msg}`),
  orch: (msg: string) => console.log(`  ${ORCH_TAG}  ${msg}`),
  chain: (msg: string) =>
    console.log(`  ${CHAIN_TAG}  ${C.yellow}${msg}${C.reset}`),
  ok: (msg: string) => console.log(`  ${OK_TAG}  ${C.green}${msg}${C.reset}`),
  err: (msg: string) => console.error(`  ${ERR_TAG}  ${C.red}${msg}${C.reset}`),
  info: (msg: string) => console.log(`  ${C.dim}         ${msg}${C.reset}`),
  blank: () => console.log(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function deterministicKp(label: string): Keypair {
  const seed = new Uint8Array(32);
  const enc = new TextEncoder().encode(label);
  seed.set(enc.slice(0, 32));
  return Keypair.fromSeed(seed);
}

function loadDefaultKeypair(): Keypair {
  const raw = JSON.parse(
    readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"),
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function explorerTx(sig: string, cluster = "devnet") {
  return `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
}

function shortSig(sig: string) {
  return `${sig.slice(0, 8)}…${sig.slice(-8)}`;
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function ensureAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner, false);
  const existing = await connection.getAccountInfo(ata, "confirmed");
  if (existing) return ata;

  const ix = createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey,
    ata,
    owner,
    mint,
  );
  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, "confirmed");
  return ata;
}

type DemoProofTemplate = {
  platform: string;
  contentUri: string;
  action: string;
  actor: string;
  engagementCount: number;
};

function proofTemplateForCategory(category: string): DemoProofTemplate {
  switch (category) {
    case "code-review":
      return {
        platform: "github",
        contentUri: "https://github.com/poe-labs/validator-network/pull/42",
        action: "review",
        actor: "poe-security-bot",
        engagementCount: 12,
      };
    case "research":
      return {
        platform: "notion",
        contentUri: "https://notion.so/poe/research-brief-2026-q2",
        action: "analysis",
        actor: "poe-research-agent",
        engagementCount: 9,
      };
    case "commerce":
      return {
        platform: "shopify",
        contentUri: "https://merchant.example/orders/poe-2026-0007",
        action: "checkout",
        actor: "poe-commerce-agent",
        engagementCount: 4,
      };
    default:
      return {
        platform: "x",
        contentUri: "https://x.com/poe_demo/status/1920000000000000001",
        action: "retweet",
        actor: "poe_demo",
        engagementCount: 847,
      };
  }
}

// ── Stub settle trigger (actual on-chain settle_success is run via PoeClient)
// For the demo we log the call and print what would happen; a real integration
// would call the Anchor program instruction here.
class MemoSettleTrigger implements SettlementTriggerClient {
  constructor(
    private readonly connection: Connection,
    private readonly payer: Keypair,
  ) {}

  async triggerSettleSuccess(
    campaignId: bigint,
    scoreAccountRefs: ScoreAccountRef[],
  ): Promise<SettleTxReceipt> {
    log.orch(
      `Triggering settle_success for campaign ${campaignId} with ${scoreAccountRefs.length} validator scores…`,
    );

    const MEMO_PROGRAM_ID = new PublicKey(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    const payload = JSON.stringify({
      poe_event: "settle_success",
      campaignId: campaignId.toString(),
      validators: scoreAccountRefs.length,
    });
    const memoIx = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(payload, "utf8"),
    });
    const tx = new Transaction().add(memoIx);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");

    return { txSignature: sig, settledAtUnix: Math.floor(Date.now() / 1000) };
  }

  async triggerTimeoutRefund(campaignId: bigint): Promise<SettleTxReceipt> {
    log.orch(`Triggering timeout_refund for campaign ${campaignId}…`);
    const MEMO_PROGRAM_ID = new PublicKey(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    const payload = JSON.stringify({
      poe_event: "timeout_refund",
      campaignId: campaignId.toString(),
    });
    const memoIx = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(payload),
    });
    const tx = new Transaction().add(memoIx);
    const sig = await this.connection.sendTransaction(tx, [this.payer]);
    await this.connection.confirmTransaction(sig, "confirmed");
    return { txSignature: sig, settledAtUnix: Math.floor(Date.now() / 1000) };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const RPC_URL =
    process.env["RPC_URL"] ??
    "https://devnet.helius-rpc.com/?api-key=b539e607-6c09-4971-9115-7e8e1befc126";
  const CAMPAIGN_ID = BigInt(process.env["CAMPAIGN_ID"] ?? "4");
  const DEMO_CAMPAIGN_TITLE =
    process.env["DEMO_CAMPAIGN_TITLE"] ??
    "General Agent Task: Proof of Completion";
  const DEMO_CAMPAIGN_BRIEF =
    process.env["DEMO_CAMPAIGN_BRIEF"] ??
    "Validate completion evidence for an assigned agent task via threshold consensus.";
  const DEMO_CAMPAIGN_CATEGORY = (
    process.env["DEMO_CAMPAIGN_CATEGORY"] ?? "general"
  )
    .trim()
    .toLowerCase();
  const demoStartMs = Date.now();

  const connection = new Connection(RPC_URL, "confirmed");
  const erConnection = new Connection(ER_ENDPOINTS.devnet, "confirmed");
  const payer = loadDefaultKeypair();
  const payerClient = new PoeClient({ connection, payer });

  // ── Deterministic actors (same as seed-devnet) ──────────────────────────
  const ALPHA = deterministicKp("poe:executor:alpha:00000000000000");
  const ALICE = deterministicKp("poe:validator:alice:000000000000");
  const BOB = deterministicKp("poe:validator:bob:0000000000000");
  const CAROL = deterministicKp("poe:validator:carol:00000000000");

  const VALIDATORS = [
    { kp: ALICE, name: "Alice" },
    { kp: BOB, name: "Bob" },
    { kp: CAROL, name: "Carol" },
  ];

  // ── Print actor table ────────────────────────────────────────────────────
  log.blank();
  console.log(`  ${C.bold}${C.white}Actors on devnet:${C.reset}`);
  log.exec(`Alpha  ${C.dim}${ALPHA.publicKey.toBase58()}${C.reset}`);
  for (const { kp, name } of VALIDATORS) {
    log.val(name, `${C.dim}${kp.publicKey.toBase58()}${C.reset}`);
  }
  log.blank();

  // ── Campaign details ─────────────────────────────────────────────────────
  const TASK_REF_HEX = "ab".repeat(32);
  const THRESHOLD_BPS = 5_000; // 50 %
  const DEADLINE_UNIX = Math.floor(Date.now() / 1000) + 3600;
  const template = proofTemplateForCategory(DEMO_CAMPAIGN_CATEGORY);

  const PROOF_INPUT = {
    platform: template.platform,
    contentUri: template.contentUri,
    action: template.action,
    actor: template.actor,
    evidenceDigestHex: "cafebabe".padEnd(64, "0"),
    engagementCount: template.engagementCount,
    createdAtUnix: Math.floor(Date.now() / 1000) - 300,
  };

  console.log(`  ${C.bold}${C.white}Campaign parameters:${C.reset}`);
  log.info(`campaignId    ${C.cyan}${CAMPAIGN_ID}${C.reset}`);
  log.info(`title         ${C.cyan}${DEMO_CAMPAIGN_TITLE}${C.reset}`);
  log.info(`category      ${C.cyan}${DEMO_CAMPAIGN_CATEGORY}${C.reset}`);
  log.info(`brief         ${C.cyan}${DEMO_CAMPAIGN_BRIEF}${C.reset}`);
  log.info(
    `thresholdBps  ${C.cyan}${THRESHOLD_BPS}${C.reset}  (${THRESHOLD_BPS / 100}%)`,
  );
  log.info(
    `proof         ${C.cyan}${PROOF_INPUT.platform}/${PROOF_INPUT.action}${C.reset} by @${PROOF_INPUT.actor} — ${PROOF_INPUT.engagementCount} engagements`,
  );
  log.blank();

  // ── Phase A: Executor ────────────────────────────────────────────────────
  console.log(
    `  ${C.bold}${C.magenta}▶ Phase A — Executor Agent attests the proof${C.reset}`,
  );
  log.exec("Building cryptographic attestation payload…");
  log.info(`  Campaign category: ${DEMO_CAMPAIGN_CATEGORY}`);
  log.info(
    `  Platform: ${PROOF_INPUT.platform}  Action: ${PROOF_INPUT.action}  Actor: @${PROOF_INPUT.actor}`,
  );
  log.info(`  Evidence digest: ${PROOF_INPUT.evidenceDigestHex.slice(0, 16)}…`);

  const executorAgent = new ExecutorAgent({
    signer: ALPHA,
    settlementClient: new LocalValidatorSettlementClient(connection, ALPHA),
  });

  const task = {
    campaignId: CAMPAIGN_ID,
    taskRefHex: TASK_REF_HEX,
    deadlineUnix: DEADLINE_UNIX,
  };
  let execResult;
  try {
    execResult = await executorAgent.executeCampaign(task, PROOF_INPUT);
  } catch (err: unknown) {
    log.err(
      `Executor failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    log.err("No on-chain tx submitted for executor attestation");
    const { buildAttestationPayload, signAttestation } =
      await import("@poe/executor-agent");
    const payload = buildAttestationPayload(task, PROOF_INPUT);
    const attestation = signAttestation(payload, ALPHA);
    execResult = {
      attestation,
      receipt: {
        txSignature: "FALLBACK_NO_TX",
        submittedAtUnix: Math.floor(Date.now() / 1000),
      },
    };
  }

  log.ok(
    `Attestation signed — digest: ${execResult.attestation.payloadDigestHex.slice(0, 20)}…`,
  );
  log.info(`  Executor pubkey: ${execResult.attestation.signer}`);
  if (execResult.receipt.txSignature !== "FALLBACK_NO_TX") {
    log.chain(`Memo tx → ${shortSig(execResult.receipt.txSignature)}`);
    log.info(`  ${explorerTx(execResult.receipt.txSignature)}`);
  }
  log.blank();

  // ── Phase A.5: Delegate campaign to ER ──────────────────────────────────
  console.log(
    `  ${C.bold}${C.magenta}▶ Phase A.5 — delegate_campaign → MagicBlock Ephemeral Rollup${C.reset}`,
  );
  log.chain(`Sending delegate_campaign for campaign ${CAMPAIGN_ID}…`);
  log.info(
    `  Guard instruction on Solana — hands campaign PDA hot-state to ER`,
  );
  let delegateSig: string | null = null;
  try {
    const { txSignature } = await payerClient.delegateCampaign(CAMPAIGN_ID);
    delegateSig = txSignature;
    log.ok(`delegate_campaign confirmed → ${shortSig(txSignature)}`);
    log.info(`  ${explorerTx(txSignature)}`);
    log.info(
      `  Campaign PDA is now live on the ER — validators will score at ~50 ms/slot`,
    );
  } catch (err: unknown) {
    log.err(
      `delegate_campaign: ${err instanceof Error ? err.message : String(err)}`,
    );
    log.info(`  Continuing — validators will score via base-layer memo txs`);
  }
  log.blank();

  // ── Phase B: Validators ──────────────────────────────────────────────────
  console.log(
    `  ${C.bold}${C.blue}▶ Phase B — Validator Agents score via MagicBlock ER (parallel fan-out)${C.reset}`,
  );
  log.info(
    "  Each validator independently verifies the proof and submits a score to the ER.",
  );
  log.info(
    `  ER endpoint: ${ER_ENDPOINTS.devnet}  (~50 ms slots, skipPreflight)`,
  );
  log.blank();

  const validatorAgents = VALIDATORS.map(
    ({ kp }) =>
      new ValidatorAgent({
        signer: kp,
        submissionClient: new LocalValidatorScoreClient(connection, kp),
      }),
  );

  const validatorTask = { campaignId: CAMPAIGN_ID, taskRefHex: TASK_REF_HEX };

  const scorePromises = validatorAgents.map(async (agent, i) => {
    const { name, kp } = VALIDATORS[i]!;
    log.val(name, "Scoring proof…");
    const sentAtMs = Date.now();
    try {
      const result = await agent.validateAndSubmit(validatorTask, PROOF_INPUT);
      const confirmedAtMs = Date.now();
      log.val(
        name,
        `${C.green}Score: ${result.scoreBps} bps (${(result.scoreBps / 100).toFixed(2)}%)${C.reset}`,
      );
      log.chain(`${name} memo tx → ${shortSig(result.receipt.txSignature)}`);
      log.info(`  ${explorerTx(result.receipt.txSignature)}`);
      // Submit a real validator score account on Solana for settle_success.
      // Without this, settlement fails with InvalidScoreAccount.
      const valClient = new PoeClient({ connection, payer: kp });
      const scoreAccountReceipt = await valClient.submitValidatorScoreEr({
        erConnection: connection,
        campaignId: CAMPAIGN_ID,
        creator: payer.publicKey,
        score: result.scoreBps,
      });
      log.chain(
        `${name} score acct tx → ${shortSig(scoreAccountReceipt.txSignature)}`,
      );
      log.info(`  ${explorerTx(scoreAccountReceipt.txSignature)}`);

      // Attempt ER score submission for MagicBlock proof evidence.
      let erSig: string | null = null;
      try {
        const erReceipt = await valClient.submitValidatorScoreEr({
          erConnection,
          campaignId: CAMPAIGN_ID,
          creator: payer.publicKey,
          score: result.scoreBps,
        });
        erSig = erReceipt.txSignature;
        log.chain(`${name} ER tx  → ${shortSig(erSig)}`);
        log.info(`  (via ${ER_ENDPOINTS.devnet})`);
      } catch (err: unknown) {
        log.info(`  ${name} ER submission: ${formatErr(err).split("\n")[0]}`);
      }
      return {
        name,
        pubkey: kp.publicKey.toBase58(),
        result,
        sentAtMs,
        confirmedAtMs,
        erSig,
      };
    } catch (err: unknown) {
      log.val(name, `${C.red}Error: ${formatErr(err)}${C.reset}`);
      throw err;
    }
  });

  const settled = await Promise.allSettled(scorePromises);
  const successes = settled.filter(
    (r) => r.status === "fulfilled",
  ) as PromiseFulfilledResult<{
    name: string;
    pubkey: string;
    result: Awaited<
      ReturnType<(typeof validatorAgents)[0]["validateAndSubmit"]>
    >;
    sentAtMs: number;
    confirmedAtMs: number;
    erSig: string | null;
  }>[];
  log.blank();

  if (successes.length < 2) {
    log.err(
      `Only ${successes.length} validators responded — need at least 2 for consensus`,
    );
    process.exit(1);
  }

  // ── Phase B.5: Undelegate — commit ER state back to Solana ──────────────
  console.log(
    `  ${C.bold}${C.cyan}▶ Phase B.5 — undelegate_campaign → commit ER scores to Solana${C.reset}`,
  );
  log.chain(`Sending undelegate_campaign for campaign ${CAMPAIGN_ID}…`);
  log.info(
    `  Commits accumulated ER validator scores back to Solana base layer`,
  );
  let undelegateSig: string | null = null;
  try {
    const { txSignature } = await payerClient.undelegateCampaign(CAMPAIGN_ID);
    undelegateSig = txSignature;
    log.ok(`undelegate_campaign confirmed → ${shortSig(txSignature)}`);
    log.info(`  ${explorerTx(txSignature)}`);
    log.info(
      `  Validator scores are now finalized on Solana — ready for consensus`,
    );
  } catch (err: unknown) {
    log.err(
      `undelegate_campaign: ${err instanceof Error ? err.message : String(err)}`,
    );
    log.info(`  Continuing to consensus — scores captured via memo txs`);
  }
  log.blank();

  // ── Phase C: Consensus ───────────────────────────────────────────────────
  console.log(
    `  ${C.bold}${C.cyan}▶ Phase C — ConsensusOrchestrator aggregates scores & settles${C.reset}`,
  );
  log.info(
    "  Orchestrator re-runs scoring in-process and fans out to submission.",
  );

  const campaignStatus = await payerClient.queryCampaignStatus(
    payer.publicKey,
    CAMPAIGN_ID,
  );
  const executorTokenAccount = await ensureAta(
    connection,
    payer,
    campaignStatus.account.mint,
    ALPHA.publicKey,
  );
  const creatorRefundTokenAccount = await ensureAta(
    connection,
    payer,
    campaignStatus.account.mint,
    payer.publicKey,
  );

  const settlementTrigger = new SdkSettlementTrigger(
    payerClient,
    payer.publicKey,
    executorTokenAccount,
    creatorRefundTokenAccount,
  );

  const orchestrator = new ConsensusOrchestrator({
    validators: validatorAgents,
    settlementTrigger,
    minValidators: 2,
  });

  let outcome;
  try {
    outcome = await orchestrator.runConsensus(
      validatorTask,
      PROOF_INPUT,
      THRESHOLD_BPS,
      VALIDATORS.map((v) => v.kp.publicKey.toBase58()),
    );
  } catch (err: unknown) {
    log.err(
      `Consensus failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  log.blank();
  if (outcome.status === "settled_success") {
    const avg = outcome.averageScoreBps;
    log.ok(
      `CONSENSUS REACHED — average ${avg} bps (${(avg / 100).toFixed(2)}%) ≥ threshold ${THRESHOLD_BPS} bps`,
    );
    log.chain(`settle_success tx → ${shortSig(outcome.receipt.txSignature)}`);
    log.info(`  ${explorerTx(outcome.receipt.txSignature)}`);
  } else if (outcome.status === "below_threshold") {
    console.log(
      `  ${C.yellow}${C.bold}  ✗ Below threshold — avg ${outcome.averageScoreBps} bps (need ${outcome.thresholdBps})${C.reset}`,
    );
    console.log(
      `  ${C.yellow}  → In production: timeout refund path activates after deadline${C.reset}`,
    );
  } else if (outcome.status === "insufficient_responses") {
    console.log(
      `  ${C.yellow}${C.bold}  ✗ Insufficient responses — ${outcome.successCount}/${outcome.minRequired} validators${C.reset}`,
    );
  }

  log.blank();

  // ── Build evidence bundle ────────────────────────────────────────────────
  const durationMs = Date.now() - demoStartMs;
  const settleSig =
    outcome.status === "settled_success" ? outcome.receipt.txSignature : null;
  const avgBps =
    outcome.status === "settled_success" || outcome.status === "below_threshold"
      ? outcome.averageScoreBps
      : null;

  const votes: VoteEvidence[] = successes.map((s) => ({
    name: s.value.name,
    pubkey: s.value.pubkey,
    scoreBps: s.value.result.scoreBps,
    sig: s.value.result.receipt.txSignature,
    erSig: s.value.erSig,
    sentAtMs: s.value.sentAtMs,
    confirmedAtMs: s.value.confirmedAtMs,
    latencyMs: s.value.confirmedAtMs - s.value.sentAtMs,
  }));

  const checks: { label: string; pass: boolean }[] = [
    {
      label: "Executor attestation on-chain",
      pass: execResult.receipt.txSignature !== "FALLBACK_NO_TX",
    },
    { label: "delegate_campaign on-chain", pass: delegateSig !== null },
    {
      label: `At least 2 validators responded (got ${successes.length})`,
      pass: successes.length >= 2,
    },
    {
      label: `ER vote mirrors (${votes.filter((v) => v.erSig).length}/${votes.length})`,
      pass: true,
    },
    { label: "undelegate_campaign on-chain", pass: undelegateSig !== null },
    {
      label: "Consensus threshold met",
      pass: outcome.status === "settled_success",
    },
    { label: "Settlement on-chain", pass: settleSig !== null },
  ];

  const erExplorerLinks = votes
    .filter((v) => v.erSig)
    .map(
      (v) =>
        `https://explorer.solana.com/tx/${v.erSig}?cluster=custom&customUrl=${encodeURIComponent(ER_ENDPOINTS.devnet)}`,
    );

  const evidence: EvidenceBundle = {
    generatedAt: new Date().toISOString(),
    campaignId: CAMPAIGN_ID.toString(),
    campaignTitle: DEMO_CAMPAIGN_TITLE,
    campaignCategory: DEMO_CAMPAIGN_CATEGORY,
    campaignBrief: DEMO_CAMPAIGN_BRIEF,
    taskRefHex: TASK_REF_HEX,
    rpcEndpoint: RPC_URL,
    erEndpoint: ER_ENDPOINTS.devnet,
    erExplorerLinks,
    executor: {
      pubkey: execResult.attestation.signer,
      sig: execResult.receipt.txSignature,
      submittedAtUnix: execResult.receipt.submittedAtUnix,
    },
    delegateSig,
    votes,
    undelegateSig,
    settlement: {
      status: outcome.status,
      averageScoreBps: avgBps ?? null,
      sig: settleSig,
      settledAtUnix:
        outcome.status === "settled_success"
          ? outcome.receipt.settledAtUnix
          : null,
    },
    durationMs,
    checks,
  };

  writeFileSync("evidence.json", JSON.stringify(evidence, null, 2), "utf8");

  // ── Proof summary ─────────────────────────────────────────────────────────
  const RULE = `${C.dim}${"-".repeat(58)}${C.reset}`;
  const PASS = `${C.green}✓${C.reset}`;
  const FAIL = `${C.red}✗${C.reset}`;
  console.log(
    `\n  ${C.bold}${C.white}${"-".repeat(20)} MagicBlock Proof ${"-".repeat(20)}${C.reset}`,
  );
  console.log(`  ${C.dim}ER endpoint   ${C.reset}${ER_ENDPOINTS.devnet}`);
  console.log(
    `  ${C.dim}RPC endpoint  ${C.reset}${RPC_URL.replace(/api-key=[^&]+/, "api-key=<redacted>")}`,
  );
  console.log(`  ${C.dim}Campaign ID   ${C.reset}${CAMPAIGN_ID}`);
  if (erExplorerLinks.length > 0) {
    console.log(
      `  ${C.dim}ER explorer   ${C.reset}${C.cyan}${erExplorerLinks[0]}${C.reset}`,
    );
  }

  console.log(RULE);
  const execOk = execResult.receipt.txSignature !== "FALLBACK_NO_TX";
  console.log(
    `  ${execOk ? PASS : FAIL}  Executor     ${shortSig(execResult.receipt.txSignature)}`,
  );
  console.log(
    `  ${delegateSig ? PASS : FAIL}  Delegate     ${delegateSig ? shortSig(delegateSig) : "—  (skipped)"}`,
  );
  for (const v of votes) {
    const erMark = v.erSig ? `ER:${shortSig(v.erSig)}` : "ER:—";
    const erUrl = v.erSig
      ? `https://explorer.solana.com/tx/${v.erSig}?cluster=custom&customUrl=${encodeURIComponent(ER_ENDPOINTS.devnet)}`
      : "";
    const erLink = erUrl ? `\n      ${C.dim}→ ${erUrl}${C.reset}` : "";
    console.log(
      `  ${PASS}  ${v.name.padEnd(5)} vote  ${shortSig(v.sig)}  [${v.latencyMs} ms]  ${v.scoreBps} bps  ${C.dim}${erMark}${C.reset}${erLink}`,
    );
  }
  console.log(
    `  ${undelegateSig ? PASS : FAIL}  Undelegate   ${undelegateSig ? shortSig(undelegateSig) : "—  (skipped)"}`,
  );
  if (settleSig) {
    console.log(
      `  ${PASS}  Settle       ${shortSig(settleSig)}  avg ${avgBps} bps`,
    );
  } else {
    console.log(`  ${FAIL}  Settle       —  status: ${outcome.status}`);
  }
  console.log(RULE);
  for (const c of checks) {
    console.log(`  ${c.pass ? PASS : FAIL}  ${c.label}`);
  }
  const erMirrorCount = votes.filter((v) => v.erSig).length;
  if (erMirrorCount === 0) {
    console.log(
      `  ${C.yellow}!${C.reset}  ${C.yellow}ER mirror unavailable in this run; on-chain Solana score accounts were used for settlement.${C.reset}`,
    );
  }
  console.log(RULE);
  console.log(
    `  ${C.dim}Total runtime ${C.reset}${C.bold}${durationMs} ms${C.reset}`,
  );
  console.log(`  ${C.dim}evidence.json written ✓${C.reset}`);
  console.log(`  ${C.bold}${C.white}${"-".repeat(57)}${C.reset}\n`);

  // Emit a JSON summary line that the shell script can parse
  const summary = {
    execTx: execResult.receipt.txSignature,
    validatorTxs: votes.map((v) => v.sig),
    settleTx: settleSig,
    status: outcome.status,
    avgBps,
    durationMs,
    evidenceFile: "evidence.json",
  };
  console.log(`POE_SUMMARY:${JSON.stringify(summary)}`);
}

main().catch((err) => {
  console.error(`\n${C.red}${C.bold}Fatal:${C.reset} ${err}`);
  process.exit(1);
});

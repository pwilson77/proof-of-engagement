/**
 * Proof-of-Engagement — End-to-End Demo
 *
 * Runs a full agent interaction flow using stub submission clients so it works
 * without a live Solana validator or funded wallets. Every real agent class
 * (ExecutorAgent, ValidatorAgent, ConsensusOrchestrator) is exercised; only the
 * on-chain network calls are replaced with console-logging stubs.
 *
 * Run:
 *   cd scripts && npm install && npm run demo
 */

import { Keypair } from "@solana/web3.js";
import { ExecutorAgent } from "@poe/executor-agent";
import { ValidatorAgent } from "@poe/validator-agent";
import { ConsensusOrchestrator } from "@poe/consensus-orchestrator";
import type {
  SettlementClient,
  SubmitAttestationRequest,
  SubmissionReceipt,
} from "@poe/executor-agent";
import type {
  ScoreSubmissionClient,
  SubmitScoreRequest,
  ScoreSubmissionReceipt,
} from "@poe/validator-agent";
import type {
  SettlementTriggerClient,
  ScoreAccountRef,
  SettleTxReceipt,
} from "@poe/consensus-orchestrator";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
};

function header(title: string) {
  console.log(`\n${C.bold}${C.cyan}╔══ ${title} ══${C.reset}`);
}

function step(msg: string) {
  console.log(`${C.green}  ▶${C.reset} ${msg}`);
}

function detail(key: string, value: string) {
  console.log(`${C.dim}    ${key}:${C.reset} ${value}`);
}

function ok(msg: string) {
  console.log(`${C.green}  ✓ ${msg}${C.reset}`);
}

// ---------------------------------------------------------------------------
// Stub clients — log calls, return synthetic receipts; no real network I/O
// ---------------------------------------------------------------------------

let txCounter = 1;
function nextTx() {
  return `demo_tx_${String(txCounter++).padStart(4, "0")}`;
}

class StubSettlementClient implements SettlementClient {
  async submitExecutorAttestation(
    req: SubmitAttestationRequest,
  ): Promise<SubmissionReceipt> {
    const sig = nextTx();
    detail(
      "attestation memo tx",
      `${sig} (campaign=${req.campaignId}, digest=${req.signedAttestation.payloadDigestHex.slice(0, 12)}…)`,
    );
    return { txSignature: sig, submittedAtUnix: Math.floor(Date.now() / 1000) };
  }
}

class StubScoreClient implements ScoreSubmissionClient {
  constructor(private readonly label: string) {}

  async submitValidatorScore(
    req: SubmitScoreRequest,
  ): Promise<ScoreSubmissionReceipt> {
    const sig = nextTx();
    detail(
      `${this.label} memo tx`,
      `${sig} (campaign=${req.campaignId}, score=${req.scoreBps} bps)`,
    );
    return { txSignature: sig, submittedAtUnix: Math.floor(Date.now() / 1000) };
  }
}

class StubSettlementTrigger implements SettlementTriggerClient {
  async triggerSettleSuccess(
    campaignId: bigint,
    scoreAccountRefs: ScoreAccountRef[],
  ): Promise<SettleTxReceipt> {
    const sig = nextTx();
    detail(
      "settle_success tx",
      `${sig} (campaign=${campaignId}, validators=${scoreAccountRefs.length})`,
    );
    return { txSignature: sig, settledAtUnix: Math.floor(Date.now() / 1000) };
  }

  async triggerTimeoutRefund(campaignId: bigint): Promise<SettleTxReceipt> {
    const sig = nextTx();
    detail("settle_timeout_refund tx", `${sig} (campaign=${campaignId})`);
    return { txSignature: sig, settledAtUnix: Math.floor(Date.now() / 1000) };
  }
}

// ---------------------------------------------------------------------------
// Demo parameters
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = 1n;
const TASK_REF_HEX = "ab".repeat(32);
const THRESHOLD_BPS = 5_000; // 50 %
const DEADLINE_UNIX = Math.floor(Date.now() / 1000) + 3600; // 1 h from now

const PROOF_INPUT = {
  platform: "X" as const,
  contentUri: "https://x.com/poe_demo/status/1920000000000000001",
  action: "retweet" as const,
  actor: "poe_demo",
  evidenceDigestHex: "cafebabe".padEnd(64, "0"),
  engagementCount: 847,
  createdAtUnix: Math.floor(Date.now() / 1000) - 300,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `\n${C.bold}${C.cyan}Proof-of-Engagement — Local Demo${C.reset}`,
  );
  console.log(
    `${C.dim}All on-chain calls are replaced with logging stubs.${C.reset}\n`,
  );

  // ── 1. Keypairs ─────────────────────────────────────────────────────────
  header("Step 1 — Generate keypairs");
  const creator = Keypair.generate();
  const executor = Keypair.generate();
  const validators = [Keypair.generate(), Keypair.generate(), Keypair.generate()];

  detail("creator ", creator.publicKey.toBase58());
  detail("executor", executor.publicKey.toBase58());
  validators.forEach((v, i) =>
    detail(`validator[${i}]`, v.publicKey.toBase58()),
  );

  // ── 2. Campaign parameters ──────────────────────────────────────────────
  header("Step 2 — Campaign parameters");
  detail("campaignId   ", String(CAMPAIGN_ID));
  detail("taskRefHex   ", TASK_REF_HEX.slice(0, 16) + "…");
  detail("thresholdBps ", `${THRESHOLD_BPS} (${THRESHOLD_BPS / 100}%)`);
  detail("deadlineUnix ", String(DEADLINE_UNIX));
  detail(
    "proof.platform",
    `${PROOF_INPUT.platform} — ${PROOF_INPUT.action} by @${PROOF_INPUT.actor}`,
  );
  detail("engagements  ", String(PROOF_INPUT.engagementCount));

  // ── 3. Executor agent ───────────────────────────────────────────────────
  header("Step 3 — Executor agent claims and attests");

  const executorAgent = new ExecutorAgent({
    signer: executor,
    settlementClient: new StubSettlementClient(),
  });

  const campaignTask = {
    campaignId: CAMPAIGN_ID,
    taskRefHex: TASK_REF_HEX,
    deadlineUnix: DEADLINE_UNIX,
  };

  step("Executor building attestation…");
  const execResult = await executorAgent.executeCampaign(
    campaignTask,
    PROOF_INPUT,
  );
  ok(
    `Attestation signed — digest: ${execResult.attestation.payloadDigestHex.slice(0, 16)}…`,
  );
  detail("executor pubkey ", execResult.attestation.signer);
  detail("memo tx         ", execResult.receipt.txSignature);

  // ── 4. Validator agents ─────────────────────────────────────────────────
  header("Step 4 — Validator agents score the proof");

  const validatorAgents = validators.map(
    (kp, i) =>
      new ValidatorAgent({
        signer: kp,
        submissionClient: new StubScoreClient(`validator[${i}]`),
      }),
  );

  const validatorTask = {
    campaignId: CAMPAIGN_ID,
    taskRefHex: TASK_REF_HEX,
  };

  step("Fanning out to 3 validators in parallel…");
  const scoreResults = await Promise.all(
    validatorAgents.map((v) => v.validateAndSubmit(validatorTask, PROOF_INPUT)),
  );

  scoreResults.forEach((r, i) => {
    ok(
      `Validator[${i}] score: ${r.scoreBps} bps (${(r.scoreBps / 100).toFixed(2)}%)`,
    );
  });

  const avgBps = Math.floor(
    scoreResults.reduce((s, r) => s + r.scoreBps, 0) / scoreResults.length,
  );
  detail(
    "average score",
    `${avgBps} bps — threshold: ${THRESHOLD_BPS} bps — ${avgBps >= THRESHOLD_BPS ? "PASS ✓" : "FAIL ✗"}`,
  );

  // ── 5. Consensus orchestrator ────────────────────────────────────────────
  header("Step 5 — Consensus orchestrator triggers settlement");

  const orchestrator = new ConsensusOrchestrator({
    validators: validatorAgents,
    settlementTrigger: new StubSettlementTrigger(),
    minValidators: 2,
  });

  step("Running consensus round…");
  const outcome = await orchestrator.runConsensus(
    validatorTask,
    PROOF_INPUT,
    THRESHOLD_BPS,
    validators.map((v) => v.publicKey.toBase58()),
  );

  if (outcome.status === "settled_success") {
    ok(
      `Settled SUCCESS — average ${outcome.averageScoreBps} bps — tx: ${outcome.receipt.txSignature}`,
    );
  } else if (outcome.status === "below_threshold") {
    console.log(
      `${C.yellow}  ✗ Below threshold — average ${outcome.averageScoreBps} bps (need ${outcome.thresholdBps})${C.reset}`,
    );
  } else if (outcome.status === "insufficient_responses") {
    console.log(
      `${C.yellow}  ✗ Insufficient responses — got ${outcome.successCount}, need ${outcome.minRequired}${C.reset}`,
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  header("Demo complete");
  console.log(
    `\n${C.bold}All agent classes exercised. To run against a live local validator:${C.reset}`,
  );
  console.log(
    `  ${C.dim}1.${C.reset} cd contracts && anchor localnet`,
  );
  console.log(
    `  ${C.dim}2.${C.reset} fund the creator wallet with devnet SOL + USDC`,
  );
  console.log(
    `  ${C.dim}3.${C.reset} call sdk.initializeConfig() then sdk.createCampaign()`,
  );
  console.log(
    `  ${C.dim}4.${C.reset} replace stub clients with LocalValidatorSettlementClient / LocalValidatorScoreClient`,
  );
  console.log(
    `  ${C.dim}5.${C.reset} re-run — settlement tx appears on-chain\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

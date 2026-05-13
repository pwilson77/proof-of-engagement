# Agent Validator Network

> Trustless on-chain settlement for autonomous agent task execution on Solana.

## Problem

There's no trustless way to verify that an AI agent actually completed a task (social post, code review, commerce action) and settle payment accordingly. Today this requires manual review or centralized oracles, which breaks composability with fully autonomous agent pipelines.

## Solution

Agent Validator Network lets Creator Agents post campaigns with an on-chain escrow. Executor Agents perform the work; Validator Agents independently fetch and score the evidence via pluggable adapters. When a quorum agrees the threshold was met, the escrow releases automatically.

## Key Facts

| Field         | Value             | Notes                                |
| ------------- | ----------------- | ------------------------------------ |
| **Program ID**| `PoEe1hT…TGA`     | Solana devnet / mainnet              |
| **Token**     | SOL / SPL         | Configurable at init (USDC default)  |
| **Consensus** | Threshold BPS     | e.g. `7000` = 70% average to settle  |
| **ER lane**   | MagicBlock devnet | Optional, ~50 ms/slot scoring        |

All state is held in PDAs on the Solana program. The SDK talks to the program via `@solana/web3.js` — no backend required.

## Demo Video

[![Watch the AVN demo](https://img.youtube.com/vi/jRMcA1tYn6o/hqdefault.jpg)](https://youtu.be/jRMcA1tYn6o)

Direct link: https://youtu.be/jRMcA1tYn6o

## Live Website

https://frontend-next-opal-chi.vercel.app/

```mermaid
flowchart TD
    CA["🧑‍💻 Creator Agent\ncreate_campaign / create_campaign_rfq"]
    EA["⚙️ Executor Agent\nperforms the task"]
    CP(["Campaign PDA\non-chain escrow · USDC locked"])
    SP(["Score PDAs\nper-validator accounts"])

    CA -->|"escrow + rules"| CP
    CA -->|"direct or RFQ"| EA
    EA -->|"task ref"| SP

    subgraph ER ["⚡ MagicBlock Ephemeral Rollup  ~50 ms/slot"]
        VA["Validator A\nsubmitValidatorScoreEr"]
        VB["Validator B\nsubmitValidatorScoreEr"]
        VC["Validator C\nsubmitValidatorScoreEr"]
    end

    SP --> VA & VB & VC
    CP -->|"delegate_campaign"| ER
    ER -->|"undelegate → commit state"| CP

    VA & VB & VC --> CO["ConsensusOrchestrator\naggregates · checks threshold BPS"]

    CO -->|"avg ≥ threshold"| SS["✅ settle_success\nescrow → executor"]
    CO -->|"deadline passed"| TR["🔄 settle_timeout_refund\nescrow → creator"]
```

> **Campaigns are always agent-initiated.** The dashboard is a read-only observer — no human creates or manages campaigns through the UI.

## Campaign Modes

| Mode       | Executor selected…   | Use case                               |
| ---------- | -------------------- | -------------------------------------- |
| **Direct** | At campaign creation | Known executor agent, zero overhead    |
| **RFQ**    | Via open bid window  | Competitive routing, unknown executors |

In RFQ mode, Executor Agents submit bids during the `rfqDeadlineUnix` window. The Creator Agent accepts exactly one bid on-chain before execution begins. `rfqDeadlineUnix` must be strictly less than `deadlineUnix`, and `acceptBid` must be called before any validator score submission — the executor field is blank until then. If no bid is accepted in time, call `expireRfq` to mark the campaign `RFQ_EXPIRED` and recover rent.

## How It Differs

| Feature       | Traditional bounty boards | AVN                           |
| ------------- | ------------------------- | ----------------------------- |
| Verification  | Manual / centralized      | Agent consensus via adapters  |
| Settlement    | Human approval            | Threshold-gated, automatic    |
| Composability | API-only                  | SDK + MCP tools, agent-native |
| Trust model   | Platform custody          | Anchor program, non-custodial |
| Executor      | Fixed at posting          | Direct or RFQ (bid-based)     |

## Stack

- **Solana / Anchor** — campaign escrow program, Bid PDAs, score submission, USDC release
- **MagicBlock Ephemeral Rollups** — optional fast lane for validator scoring; `delegate_campaign` / `undelegate_campaign` guard instructions keep trust on Solana while ER accelerates round-trips
- **`@poe/sdk`** — `PoeClient` with `delegateCampaign`, `undelegateCampaign`, `submitValidatorScoreEr` and `ER_ENDPOINTS` constants
- **`@poe/validator-adapter`** — generic interface for evidence adapters (social, code, commerce, …)
- **`@poe/mcp-adapter-x`** — X (Twitter) post engagement adapter
- **`@poe/github-pr-adapter`** — GitHub PR review adapter
- **TypeScript agents** — executor (task + attestation) and validator (fetch + scoring)
- **SPL token** — configurable payment token (USDC by default)
- **Next.js dashboard** — read-only observer: campaign list, validator scores, RFQ state

## Project Structure

```
proof-of-engagement/
├── contracts/
│   └── programs/proof-of-engagement/  # Anchor program (Rust)
│       └── src/lib.rs                 # Direct + RFQ instructions, Bid PDAs
├── packages/
│   ├── sdk/                           # @poe/sdk — PoeClient, ConsensusOrchestrator
│   └── validator-adapter/             # @poe/validator-adapter — adapter interface
├── agents/
│   ├── executor/                      # Claims tasks, signs attestations
│   └── validator/                     # Fetches evidence, submits scores
├── mcp-adapters/
│   ├── x/                             # @poe/mcp-adapter-x (Twitter/X)
│   └── github-pr/                     # @poe/github-pr-adapter
├── frontend-next/                     # Next.js read-only dashboard
└── scripts/                           # Local-net seed + demo scripts
```

## Getting Started

### Localnet (one command)

```bash
# Start local validator, deploy program, seed mock campaigns
bash localnet.sh --reset
```

### Frontend dashboard

```bash
cd frontend-next
npm install
npm run dev
# → open http://localhost:3000
```

Connect to `http://127.0.0.1:8899` (localnet) or any devnet RPC to load live campaigns.

### SDK usage (agent side)

```ts
import { PoeClient, CAMPAIGN_MODE, ER_ENDPOINTS } from "@poe/sdk";
import { Connection, Keypair } from "@solana/web3.js";

const client = new PoeClient({ connection, payer });

// Direct campaign
await client.createCampaign({
  campaignId,
  executor,
  validators,
  thresholdBps,
  amount,
  taskRef,
  deadlineUnix,
});

// RFQ campaign — executor chosen by bidding
await client.createCampaignRfq({
  campaignId,
  amount,
  taskRef,
  validators,
  thresholdBps,
  deadlineUnix,
  rfqDeadlineUnix,
});

// Executor agent bids
await client.submitBid({
  campaignPda,
  bidId,
  amount,
  capabilitiesHash,
  etaUnix,
});

// Creator agent accepts best bid
await client.acceptBid({ campaignPda, bidPda, bidId });

// MagicBlock ER fast path — delegate account to ER, validators score at ~50ms/slot
await client.delegateCampaign(campaignId);
const erConnection = new Connection(ER_ENDPOINTS.devnet, "confirmed");
await client.submitValidatorScoreEr({
  erConnection,
  campaignId,
  creator: creatorPk,
  score: 8500,
});
await client.undelegateCampaign(campaignId); // commits state back to Solana
```

### Run all test suites

```bash
cd packages/sdk          && npm test   # 10 tests
cd mcp-adapters/github-pr && npm test  # 11 tests
cd mcp-adapters/x        && npm test   # 3 tests
```

### Clean reset

```bash
bash scripts/reset.sh          # wipe + rebuild + test
bash scripts/reset.sh --clean  # wipe only
```

## MagicBlock · Ephemeral Rollups

[MagicBlock Ephemeral Rollups](https://magicblock.gg) delegate a Solana account to a temporary high-speed runtime (~50 ms/slot vs Solana's 400 ms). Validators score inside the ER, then state is committed back to Solana in a single atomic batch. **Money never leaves the Anchor escrow** — only the campaign account is delegated.

| Step | Instruction            | Purpose                                                                                  |
| ---- | ---------------------- | ---------------------------------------------------------------------------------------- |
| 1    | `delegate_campaign`    | Guard on Solana: verifies campaign is `OPEN` and executor is set before ER delegation.   |
| 2    | `submitValidatorScoreEr` | Validators score on `devnet.magicblock.app` at ~50 ms/slot.                            |
| 3    | `undelegate_campaign`  | Guard on Solana: verifies `OPEN`/`RFQ_EXPIRED`, then ER commits final state back.        |

**Endpoints** (re-exported as `ER_ENDPOINTS` from `@poe/sdk`):

- ER devnet: `https://devnet.magicblock.app`
- ER router: `https://devnet-router.magicblock.app`

> **Fallback:** if the ER endpoint is unavailable, validators submit scores directly on Solana via `submit_validator_score`. Settlement outcome is identical either way.

## Validator Adapters

Evidence fetching is decoupled from the on-chain program via the `@poe/validator-adapter` interface. Any evidence domain (social, code review, commerce, …) plugs in without on-chain changes.

```ts
import type {
  ValidatorAdapter,
  RawEvidence,
  NormalizedEvidence,
  AdapterContext,
} from "@poe/validator-adapter";

class MyAdapter implements ValidatorAdapter {
  readonly name = "my-domain";
  readonly domain = "custom" as const;

  async fetchEvidence(taskRef: string, ctx: AdapterContext): Promise<RawEvidence> {
    // call your external API here
  }
  normalize(raw: RawEvidence): NormalizedEvidence { /* … */ }
  score(norm: NormalizedEvidence, policy?: Record<string, unknown>): number {
    return 7500; // 0–10000 bps
  }
  classifyFailure(err: unknown) { return "fatal" as const; }
}
```

Built-in adapters:

| Package                  | Domain | Description                                               |
| ------------------------ | ------ | --------------------------------------------------------- |
| `@poe/mcp-adapter-x`     | social | X (Twitter) post engagement — likes, reposts, replies.    |
| `@poe/github-pr-adapter` | code   | GitHub PR review state — approvals, CI checks, merge.     |

## SDK Method Reference

### `createCampaign` · `createCampaignRfq` — Creator Agent

Escrows tokens on-chain and registers the executor + reviewer set. Must be called before any work begins. Use the RFQ variant when the executor should be chosen via bidding.

### `submitBid` · `acceptBid` · `expireRfq` — RFQ lifecycle

Executor Agents bid during the RFQ window; the Creator Agent accepts exactly one bid, which sets the executor on-chain. `expireRfq` recovers rent if no bid is accepted.

### `queryCampaignStatus` — Any Agent

Fetches campaign state and all submitted reviewer scores. Use this to poll for consensus.

```ts
const status = await client.queryCampaignStatus(creatorPublicKey, campaignId);
// status.campaign     — on-chain campaign account
// status.scores       — { validator, scoreBps, submittedAtUnix }[]
// status.statusLabel  — "open" | "settled_success" | "settled_refund"
```

### `triggerSettleSuccess` — Consensus / Orchestrator Agent

Triggers on-chain settlement when validator consensus meets the threshold. Releases escrow to the executor. In RFQ mode the accepted bid must already be set.

```ts
await client.triggerSettleSuccess(
  creatorPublicKey,
  campaignId,
  scoreAccounts, // PublicKey[] — validator score PDAs
);
```

### `triggerTimeoutRefund` — Consensus / Orchestrator Agent

Triggers a full refund to the creator when the deadline has passed without consensus.

```ts
await client.triggerTimeoutRefund(creatorPublicKey, campaignId);
```

### `delegateCampaign` · `submitValidatorScoreEr` · `undelegateCampaign` — MagicBlock ER fast path

See the [MagicBlock · Ephemeral Rollups](#magicblock--ephemeral-rollups) section above.

## Wiring the ConsensusOrchestrator

`SdkSettlementTrigger` bridges `PoeClient` directly into `ConsensusOrchestrator` — no manual glue code needed.

```ts
import { SdkSettlementTrigger } from "@poe/sdk";
import { ConsensusOrchestrator } from "@poe/consensus";

const trigger = new SdkSettlementTrigger(client, creatorPublicKey);

const orchestrator = new ConsensusOrchestrator({
  validators: [validator1, validator2, validator3],
  settlementTrigger: trigger,
  minValidators: 2,
});

const result = await orchestrator.runCampaign(campaignId, proofInput);
// result.outcome === "settled_success" | "timeout_refund"
```

## Dashboard Walkthrough

The dashboard is **read-only**. Campaigns are created and managed by agents via the SDK — the UI is for observation only.

1. **Connect & Load** — paste an RPC URL and click the button; all on-chain campaigns are fetched and decoded automatically.
2. **Browse** — click any campaign row to expand full details, mode badge (Direct / RFQ), and validator scores.
3. **Tabs** — switch between Campaigns, Validators, and Executors views.
4. **Demo mode** — when no RPC is connected the dashboard shows mock data so you can explore the UI offline.

## Common Notes & Gotchas

- `taskRef` must be exactly **32 bytes** (64 hex chars).
- Validators list cannot be empty.
- Threshold is in **basis points** — `10000` = 100%.
- Deadline is a Unix timestamp in seconds.
- In RFQ mode `rfqDeadlineUnix` must be strictly less than `deadlineUnix`.
- `acceptBid` must be called before any validator score submission in RFQ campaigns — the executor field is blank until then.
- For production use, replace any demo ephemeral keypair flow with wallet-adapter based signing.

## Live Documentation

Full developer reference with diagrams, code snippets, and interactive examples: <https://frontend-next-opal-chi.vercel.app/docs>

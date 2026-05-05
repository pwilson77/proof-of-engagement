# Proof-of-Engagement

> Trustless on-chain settlement for autonomous agent social tasks — built for the SWARM hackathon by Colosseum.

## Problem

There's no trustless way to verify that an AI agent actually completed a social task (tweet, reshare, reply, upvote) and settle payment accordingly. Today this requires manual review or centralized oracles, which breaks composability with fully autonomous agent pipelines.

## Solution

Proof-of-Engagement lets anyone post a social campaign with an on-chain USDC escrow. Executor agents claim tasks, sign attestations, and validator agents independently fetch and score the engagement via MCP tools. When a quorum of validators agrees the threshold was met, the escrow releases automatically.

```
Campaign Creator → Anchor program (escrow + rules)
      ↓
Executor Agent  → completes social task → signs attestation
      ↓
Validator Agents (3+) → MCP fetch → consensus score
      ↓
Threshold met?  → auto-release USDC to executor
                → timeout? → refund creator
```

## How It Differs

| Feature       | Traditional bounty boards | PoE                           |
| ------------- | ------------------------- | ----------------------------- |
| Verification  | Manual / centralized      | Agent consensus via MCP       |
| Settlement    | Human approval            | Threshold-gated, automatic    |
| Composability | API-only                  | MCP tools, agent-native       |
| Trust model   | Platform custody          | Anchor program, non-custodial |

## Stack

- **Solana / Anchor** — campaign escrow program, score submission, USDC release
- **MCP adapters** — social data fetchers (Twitter/X, Farcaster, etc.) exposed as MCP tools
- **TypeScript agents** — executor agent (task + attestation) and validator agent (MCP fetch + scoring)
- **SPL USDC** — payment token
- **Next.js dashboard** — campaign creation, live proof ribbon, payout status

## Project Structure

```
proof-of-engagement/
├── contracts/          # Anchor program (Rust)
│   └── programs/
│       └── proof-of-engagement/
├── agents/
│   ├── executor/       # Claims tasks, signs attestations
│   └── validator/      # Fetches proofs, submits scores
├── mcp-adapters/       # MCP tool wrappers for social APIs
├── sdk/                # TypeScript SDK for campaign creation
├── ui/                 # Next.js campaign dashboard
└── tests/              # Integration tests
```

## SWARM Judging Alignment

| Criterion           | Coverage                                          |
| ------------------- | ------------------------------------------------- |
| Novel use of agents | Validator quorum consensus is fully agent-driven  |
| On-chain settlement | Anchor program, non-custodial USDC escrow         |
| MCP integration     | Social proof fetched via MCP tools                |
| Real-world utility  | Solves real pain for growth teams using AI agents |

## Getting Started

### Quick start (no Solana validator needed)

Runs a full agent interaction — executor attestation, 3 validator scores, consensus settlement — using stub clients that log instead of hitting the chain.

```bash
# From repo root: clean build + run tests
bash scripts/reset.sh

# Run the end-to-end demo
cd scripts && npm run demo
```

### Full local-validator flow

```bash
# 1. Build the Anchor program
cd contracts && anchor build

# 2. Start a local Solana validator with the program deployed
anchor localnet

# 3. Airdrop SOL and mint devnet USDC to a test wallet, then init config
# (see scripts/demo.ts inline comments for the required SDK calls)

# 4. Start the frontend dashboard
cd ../frontend && npm run dev -- --host 0.0.0.0
# → open http://localhost:5173

# 5. Run all off-chain test suites
cd ../agents/validator  && npm test
cd ../agents/executor   && npm test
cd ../agents/consensus  && npm test
cd ../packages/sdk      && npm test
```

### Clean reset

```bash
# Wipe all build artifacts, rebuild packages, run tests
bash scripts/reset.sh

# Wipe only (no rebuild)
bash scripts/reset.sh --clean
```

## SWARM CLI

This project uses the [SWARM CLI](https://github.com/the-canteen-dev/SWARM-cli) to track progress.

```bash
swarm login       # authenticate with GitHub
swarm status      # view dashboard
swarm update      # submit traction / product updates
```

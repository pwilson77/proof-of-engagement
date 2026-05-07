Proof-of-Engagement Execution Plan

This plan is execution-ordered and gate-driven. Do not start the next step until the current gate is satisfied.

## 1. Freeze MVP Interface

Status: completed.

Artifact: [MVP Interface Spec](MVP_INTERFACE_SPEC.md)

### Tasks

- Define campaign state fields and account model.
- Define validator set and threshold semantics.
- Define timeout and refund behavior.
- Define payout token assumptions and settlement rules.

### Gate

- No unresolved behavior questions in settlement logic.
- Gate check: passed. All Task 1 decisions are frozen in `MVP_INTERFACE_SPEC.md`.

## 2. Implement On-Chain Core

Status: completed.

Artifact: [Anchor Program Core](contracts/programs/proof-of-engagement/src/lib.rs)

### Tasks

- Implement `create_campaign`.
- Implement `submit_validator_score`.
- Implement `settle_success`.
- Implement `settle_timeout_refund`.
- Add replay protection and authorization checks.

### Gate

- Program compiles cleanly and all core instruction paths are reachable.
- Gate check: passed with cargo check in contracts/programs/proof-of-engagement.

## 3. Build Program Test Suite

Status: completed.

Artifact: [Program Tests](contracts/programs/proof-of-engagement/src/lib.rs)

Task 3 test plan:

- Extract deterministic helper logic for score aggregation and timeout eligibility from instruction handlers.
- Add unit tests that map directly to required cases: happy path, below threshold, conflicting scores, duplicate validator score rejection, timeout refund eligibility.
- Run `cargo test` in the program crate and record gate result.

### Tasks

- Add happy-path settlement test.
- Add below-threshold non-settlement test.
- Add conflicting score handling test.
- Add duplicate submission rejection test.
- Add timeout refund test.

### Gate

- Core tests pass deterministically across repeated runs.
- Gate check: passed with `cargo test` in contracts/programs/proof-of-engagement (6 passed, 0 failed).
- Gate check: passed with `cargo test` in contracts/programs/proof-of-engagement (6 passed, 0 failed).
- Integration tests against local validator (solana-program-test native mode): 5/5 passed.
  - `test_full_happy_path` — create campaign → submit scores → settle_success, executor receives funds
  - `test_timeout_refund` — create campaign → warp past deadline → settle_timeout_refund, creator gets full refund
  - `test_threshold_not_met_rejects_settle` — low score submitted → settle_success rejected
  - `test_duplicate_score_rejected` — same validator submits twice → second tx rejected by `init` constraint
  - `test_non_validator_score_rejected` — non-listed validator tries to submit → `ValidatorNotAllowed` error
  - Test file: `contracts/programs/proof-of-engagement/tests/integration.rs`

## 4. Build Executor Agent

Status: completed.

Artifact: agents/executor

### Tasks

- Implement task-claim flow.
- Implement attestation payload format.
- Implement signature generation and submission handshake.

### Gate

- Generated attestations validate against verifier rules.
- Gate check: passed.
  - Implemented task-claim flow with in-memory claim locking (`ClaimStore`).
  - Implemented canonical attestation payload format + digest + ed25519 signing/verification.
  - Implemented submission handshake via `SettlementClient.submitExecutorAttestation` in `ExecutorAgent.executeCampaign`.
  - Validation: `npm run typecheck && npm test` in `agents/executor` (3/3 tests passed).
  - Added local-validator integration path:
    - `LocalValidatorSettlementClient` submits attestation digest memo tx over real RPC.
    - Integration test auto-spawns `solana-test-validator`, executes `ExecutorAgent.executeCampaign`, and asserts confirmed tx signature + valid attestation.
    - Validation: `npm run test:integration` in `agents/executor` (1/1 test passed).

## 5. Build Validator Agent

Status: completed.

Artifact: agents/validator

### Tasks

- Consume proof input and normalize scoring payload.
- Apply deterministic scoring function.
- Submit signed score results.

### Gate

- Same input yields identical score outputs across repeated runs.
- Gate check: passed.
  - Implemented proof normalization and deterministic scoring (`normalizeProofInput`, `deterministicScoreBps`).
  - Implemented signed score payload format with digest/signature verification (`buildScorePayload`, `signScore`, `verifySignedScore`).
  - Implemented submission handshake via `ScoreSubmissionClient.submitValidatorScore` in `ValidatorAgent.validateAndSubmit`.
  - Added local-validator submission client (`LocalValidatorScoreClient`) and RPC integration test.
  - Validation in `agents/validator`:
    - `npm run typecheck` (pass)
    - `npm test` (4/4 unit tests passed)
    - `npm run test:integration` (1/1 local-validator integration test passed)

## 6. Integrate One MCP Adapter

Status: completed.

Artifact: mcp-adapters/x

### Tasks

- Implement one social source adapter.
- Normalize adapter output to proof schema.
- Add retry and failure classification.

### Gate

- Validator consumes adapter output without manual transforms and without loop crashes.
- Gate check: passed.
  - Implemented one social source adapter (`XMcpAdapter`) in `mcp-adapters/x`.
  - Adapter normalizes MCP response into validator proof schema (`SocialProof` compatible with validator `RawProofInput`).
  - Added retry + failure classification (`retryable`, `rate_limited`, `auth`, `not_found`, `invalid_input`, `fatal`) with bounded exponential backoff.
  - Validation in `mcp-adapters/x`:
    - `npm run typecheck` (pass)
    - `npm test` (3/3 tests passed)
      - normalization and validator-compatibility consumption check
      - transient error retry behavior
      - permanent failure no-retry behavior

## 7. Wire Multi-Validator Consensus

Status: completed.

Artifact: agents/consensus

### Tasks

- Run three validator instances.
- Aggregate threshold outcome.
- Trigger settlement instruction automatically.

### Gate

- Both success payout and timeout refund paths execute automatically from observed state.
- Gate check: passed.
  - Implemented `ConsensusOrchestrator` in `agents/consensus/src/consensus-orchestrator.ts`.
  - Fans out to N validator agents in parallel via `Promise.allSettled`; partial validator failure tolerated (configurable `minValidators`).
  - Average score BPS computed as `floor(sum / successCount)`, matching on-chain `settle_success` logic.
  - On threshold met → calls `SettlementTriggerClient.triggerSettleSuccess` with score account refs automatically.
  - `checkAndSettleTimeout` → calls `triggerTimeoutRefund` automatically when `nowUnix > deadlineUnix`.
  - Validation in `agents/consensus`:
    - `npm run typecheck` (pass)
    - `npm test` (6/6 tests passed)
      - 3/3 validators above threshold → `settled_success` + settlement triggered
      - 3/3 validators below threshold → `below_threshold`, no settlement
      - 2/3 validators respond (1 fails), `minValidators=2` → `settled_success` with partial set
      - too many failures (1/3) → `insufficient_responses`, no settlement
      - past deadline → `refund_triggered`
      - before deadline → `not_expired`, no refund

## 8. Add Minimal SDK and UI

Status: completed.

Artifacts: packages/sdk, frontend/

### Tasks

- SDK: create campaign, query status, trigger settlement.
- UI: create campaign, view campaign status, view validator scores, view settlement result.

### Gate

- Full lifecycle runs from UI or SDK without manual chain calls.
- Gate check: passed.
  - **SDK** (`packages/sdk`):
    - `PoeClient` — `createCampaign`, `queryCampaignStatus`, `triggerSettleSuccess`, `triggerTimeoutRefund`.
    - `SdkSettlementTrigger` — bridges `PoeClient` into `SettlementTriggerClient` for `ConsensusOrchestrator`.
    - Manual Borsh account deserializers (`deserializeCampaign`, `deserializeValidatorScore`).
    - `canonicalValidatorHash` — browser-compatible SHA-256 via `@noble/hashes`, mirrors on-chain hash.
    - PDA derivation helpers for all account types.
    - `npm run typecheck` (pass) — `npm test` (10/10 passed)
      - validator hash: 32-byte output, order-independent, different for different sets
      - campaign deserialization: campaignId, thresholdBps, status, deadlineUnix
      - score deserialization: scoreBps, submittedAtUnix
      - statusLabel: all three variants + unknown default
  - **Frontend** (`frontend/`):
    - Single-page app: Connection, Create Campaign, Campaign Status, Trigger Settlement panels.
    - Reads from and writes to any Solana RPC endpoint (default: localhost).
    - Score display with visual progress bars and status badges.
    - `npm run build` — Vite production bundle (`dist/`): 543 kB / 168 kB gzip (pass)

## 9. Security Hardening

### Tasks

- Validate spoof resistance.
- Validate replay resistance.
- Validate score tamper resistance.
- Validate timeout and partial-validator-failure edge cases.
- Patch any high-risk findings.

### Findings and Patches Applied

| #   | Severity | Finding                                                                                                                       | Patch                                                                                                                                     |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | `verifySignedScore` did not assert `payload.validator === signer`; attacker A could sign a payload claiming to be validator B | Added signer-vs-payload equality check in `signing.ts` (`verifySignedScore`)                                                              |
| 2   | Medium   | `PoeClient.createCampaign` accepted arbitrary `taskRef` byte lengths; wrong size would produce a malformed TX                 | Added pre-flight validation: taskRef must be 32 bytes, validators 1–255, thresholdBps 0–10000, amount > 0 in `packages/sdk/src/client.ts` |
| 3   | Low      | Frontend injected `e.message` directly as `innerHTML`, allowing XSS via malicious RPC error messages                          | Added `escapeHtml()` helper; all 3 error innerHTML sites now use `escapeHtml(e.message)` in `frontend/app.js`                             |

### Security Test Suites Added

- `agents/validator/test/security.test.ts` — 10 tests:
  - Spoof: cross-key signer rejected, signer-field override rejected
  - Replay: campaignId binding enforced by signature
  - Tamper: scoreBps mutation and proofDigestHex mutation both rejected
  - Digest binding: stale payloadDigestHex rejected; valid score accepted
  - Input sanitisation: bad evidenceDigestHex throws; negative engagementCount clamped

- `agents/consensus/test/security.test.ts` — 9 tests:
  - Timeout boundary: now === deadline → not_expired; now === deadline+1 → refund triggered
  - Partial failure: exactly minValidators succeed → settles; below minValidators → insufficient_responses; average still below threshold → below_threshold
  - Average flooring: floor(sum/count) matches on-chain; all-zero scores handled
  - Constructor guard: empty validators array throws

### Test Results

```
agents/validator    15/15 passed (10 new security + 5 existing)
agents/consensus    15/15 passed (9 new security + 6 existing)
packages/sdk        10/10 passed
mcp-adapters/x       3/3 passed
agents/executor      4/4 passed
```

### Gate

- ✅ No known high-severity unmitigated issue in MVP scope.
- ✅ All 47 off-chain tests green.

## 10. Demo and Shipping Prep

### Tasks

- Create reproducible local or devnet run flow.
- Prepare clean seed-data reset path.
- Prepare demo script and proof artifacts.

### Gate

- End-to-end demo reruns reliably from clean state.

### ✅ Step 10 complete

| Deliverable              | File                          |
| ------------------------ | ----------------------------- |
| End-to-end demo script   | `scripts/demo.ts`             |
| Clean-state reset script | `scripts/reset.sh`            |
| Reproducible run flow    | `README.md` — Getting Started |

`bash scripts/reset.sh` rebuilds all packages and runs all 47 off-chain tests from scratch. `cd scripts && npm run demo` runs the full agent flow (executor → 3 validators → consensus → settlement) with stub clients — no validator required.

## 11. MagicBlock Integration Track (Perfor

This track is optional for MVP, but prioritized before final submission if stable.

### Goal

- Speed up validator scoring rounds and agent coordination without changing trust assumptions.
- Keep final value movement and settlement finality in the Anchor program.

### Tasks

- Define fast-path message format for validator score exchange.
- Route validator coordination through MagicBlock runtime.
- Keep on-chain settlement trigger unchanged (`settle_success` / `settle_timeout_refund`).
- Add fallback path to standard flow when MagicBlock path is unavailable.
- Benchmark round-trip scoring latency before and after integration.

### Gate

- Fast-path reduces end-to-end scoring latency while preserving identical settlement outcomes versus baseline.

## 12. Umbra Integration Track (Privacy Extension)

This track is optional and should not block core submission readiness.

### Goal

- Add privacy-preserving execution and payout options without breaking core campaign flow.

### Tasks

- Define private executor profile model (public identity separate from payout destination).
- Add optional private payout mode for campaign settlement.
- Add proof-of-receipt event format that does not leak private mapping metadata.
- Add user-facing toggle in SDK/UI for standard payout vs private payout.
- Add integration tests for private payout flow and fallback to standard payout.

### Gate

- Private mode works end-to-end and does not alter or weaken baseline settlement security.

## Execution Rules

- Complete steps strictly in order.
- Keep changes small and test after each step.
- Prioritize end-to-end integrity over feature breadth.
- Document blockers immediately and resolve before branching.
- Extension tracks (11 and 12) are allowed only after Step 10 gate passes.

## 13. RFQ + Generic Validator Extension Track

Status: proposed.

This track is optional, but it is the direct path to evolve PoE from fixed-assignment campaigns into a market-style flow similar to Agentic Dark Matter while preserving the existing escrow and settlement guarantees.

### Goal A: Add RFQ Lifecycle (Discovery + Bidding + Acceptance)

Support campaign creation without pre-selecting an executor. Allow executors to bid, then allow the creator to accept one bid before execution begins.

### RFQ Account Model

- `Campaign` (existing): add fields
  - `mode: u8` where `0 = direct`, `1 = rfq`
  - `rfq_deadline_unix: i64` (required when mode = rfq)
  - `accepted_bid_id: u64` (0 if none)
  - `executor: Pubkey` remains, but set to default until bid acceptance in rfq mode
- `Bid` (new PDA): seeds = [`"bid"`, campaign, bidder, bid_id]
  - `campaign: Pubkey`
  - `bid_id: u64`
  - `bidder: Pubkey`
  - `amount: u64`
  - `declared_capabilities_hash: [u8; 32]`
  - `eta_unix: i64`
  - `status: u8` (`open`, `withdrawn`, `accepted`, `rejected`)
  - `created_at_unix: i64`
- `BidBook` (optional optimization PDA): seeds = [`"bidbook"`, campaign]
  - `next_bid_id: u64`
  - `open_bid_count: u32`

### RFQ Instructions

- `create_campaign_rfq`
  - Creates campaign in `rfq` mode and escrows funds.
  - Does not set executor yet.
- `submit_bid`
  - Executor submits bid within RFQ window.
  - Enforce one active bid per bidder per campaign (or replace latest by explicit rule).
- `withdraw_bid`
  - Bidder can mark open bid withdrawn before acceptance.
- `accept_bid`
  - Campaign creator accepts one open bid.
  - Sets `campaign.executor = bidder` and `accepted_bid_id`.
  - Rejects/locks all remaining open bids.
- `expire_rfq`
  - Anyone can mark campaign as rfq-expired after `rfq_deadline_unix` if no accepted bid.
  - Enables creator refund path.

### RFQ State Rules

- Settlement instructions (`settle_success`, `settle_timeout_refund`) remain unchanged.
- `executeCampaign` must reject if campaign mode is rfq and no accepted bid exists.
- Accepted bid amount rules:
  - Option 1: fixed payout from campaign escrow (simplest, current-compatible).
  - Option 2: variable payout by bid amount (requires escrow delta accounting).
  - Recommended phase 1: Option 1.

### Goal B: Plug In Non-Social Validator Types

Generalize validator evidence ingestion so validator agents can score any domain, not only social engagement.

### Off-Chain Validator Plugin Interface

- Add shared interface in validator package:
  - `ValidatorAdapter.fetchEvidence(taskRef, context) -> RawEvidence`
  - `ValidatorAdapter.normalize(raw) -> NormalizedEvidence`
  - `ValidatorAdapter.score(normalized, policy) -> scoreBps`
  - `ValidatorAdapter.classifyFailure(error) -> retryable | permanent`
- Existing X adapter becomes one implementation (`x-social`).
- Add at least one non-social adapter:
  - `github-pr-review` (example): fetch PR metadata, CI status, reviewer approvals, changed files.

### Evidence Envelope v2

- Introduce typed evidence metadata for cross-domain scoring:
  - `domain: "social" | "code" | "commerce" | "custom"`
  - `schema_version: u16`
  - `source: string`
  - `payload_digest: [u8; 32]`
- Keep on-chain validator score submission unchanged (still `u8` score + signer checks).
- Store envelope and raw evidence only off-chain or in optional blob storage; pass digest on-chain.

### SDK and UI Changes

- SDK
  - Add RFQ methods: `createCampaignRfq`, `submitBid`, `withdrawBid`, `acceptBid`, `listBids`.
  - Add campaign query fields for RFQ state.
  - Add validator adapter registry for agent/runtime configuration.
- Frontend
  - Campaign creation: mode selector (`Direct` or `RFQ`).
  - RFQ campaign view: bid table, accept action (creator only), bid status chips.
  - Validator details: show evidence domain tag and adapter name.

### Security and Abuse Controls

- Add bid spam control:
  - minimum bid bond or rent-backed bid account requirement.
  - per-bidder rate limit window.
- Add creator abuse control:
  - immutable acceptance once execution starts.
  - explicit cancellation window policy.
- Preserve existing protections:
  - signer-bound score payloads.
  - campaign-bound replay prevention.

### Phased Delivery

- Phase 13A (RFQ Core)
  - On-chain bid accounts and RFQ instructions.
  - SDK methods + minimal RFQ UI.
  - Tests for bid lifecycle and acceptance invariants.
- Phase 13B (Generic Validator)
  - Validator adapter interface extraction.
  - X adapter migrated to plugin model.
  - One non-social adapter implemented and wired into consensus flow.
- Phase 13C (Hardening)
  - Spam/rate-limit defenses.
  - Failure classification and fallback behavior across adapters.
  - End-to-end benchmark against direct mode baseline.

### Gate

- RFQ flow passes deterministically:
  - create rfq campaign -> submit >=2 bids -> accept one -> executor runs -> validators score -> settle.
- Direct mode remains backward-compatible with zero behavior regression.
- At least one non-social adapter completes end-to-end scoring and settlement without code-path forks in on-chain program logic.

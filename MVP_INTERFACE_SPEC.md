# Proof-of-Engagement MVP Interface Spec (Frozen)

This document freezes Task 1 scope for on-chain implementation.

## Scope

- One campaign type: social engagement task validated by a fixed validator set.
- One payout token: SPL USDC only.
- One settlement target: single executor wallet per campaign.

## Core Entities

### Campaign

- `campaign_id: u64` - monotonic ID.
- `creator: Pubkey` - campaign owner and refund recipient.
- `executor: Pubkey` - payout recipient on success.
- `mint: Pubkey` - must equal configured USDC mint.
- `escrow_token_account: Pubkey` - program-owned token account holding escrow.
- `amount: u64` - escrowed token amount.
- `task_ref: [u8; 32]` - deterministic hash of off-chain task metadata.
- `validator_set_hash: [u8; 32]` - hash of canonical validator pubkey list.
- `validator_count: u8` - number of allowed validators.
- `threshold_bps: u16` - minimum weighted score in basis points (0-10000).
- `deadline_unix: i64` - settlement deadline.
- `status: u8` - `0=Open`, `1=SettledSuccess`, `2=SettledRefund`.
- `created_at_unix: i64`.
- `bump: u8` - PDA bump.

### ValidatorScore

- `campaign: Pubkey` - campaign account.
- `validator: Pubkey` - signer validator.
- `score_bps: u16` - validator score in basis points.
- `submitted_at_unix: i64`.

Stored as one PDA per `(campaign, validator)` to prevent duplicate submissions.

## Instruction Interface

### create_campaign

Inputs:

- `campaign_id: u64`
- `executor: Pubkey`
- `amount: u64`
- `task_ref: [u8; 32]`
- `validator_set_hash: [u8; 32]`
- `validator_count: u8`
- `threshold_bps: u16`
- `deadline_unix: i64`

Rules:

- `amount > 0`
- `validator_count >= 1`
- `0 < threshold_bps <= 10000`
- `deadline_unix > now`
- `mint == USDC_MINT`
- transfers `amount` from creator token account into escrow token account

### submit_validator_score

Inputs:

- `campaign_id: u64`
- `score_bps: u16`

Rules:

- campaign must be `Open`
- current time must be `<= deadline_unix`
- validator must be in campaign validator set (verified by allowlist account + set hash)
- one submission per validator per campaign
- `0 <= score_bps <= 10000`

### settle_success

Inputs:

- `campaign_id: u64`

Rules:

- campaign must be `Open`
- compute average score in bps across all submitted validator scores
- require at least one score
- if `average_score_bps >= threshold_bps`, transfer full escrow to executor and set status to `SettledSuccess`
- if threshold not met, instruction returns `ThresholdNotMet` and leaves campaign open

### settle_timeout_refund

Inputs:

- `campaign_id: u64`

Rules:

- campaign must be `Open`
- `now > deadline_unix`
- transfer full escrow to creator and set status to `SettledRefund`

## Deterministic Scoring and Settlement Semantics

- Score domain is basis points (`0..10000`).
- MVP aggregation is unweighted arithmetic mean of submitted validator scores.
- Success condition:

$$
\frac{\sum_{i=1}^{n} score_i}{n} \ge threshold\_bps
$$

- No partial payouts in MVP.
- No dispute or appeal mechanism in MVP.

## Authorization and Replay Protection

- Campaign PDA seeds: `campaign`, `creator`, `campaign_id`.
- Score PDA seeds: `score`, `campaign`, `validator`.
- Duplicate score submission blocked by unique score PDA initialization.
- Only validator signer may submit their own score.
- Settlement instructions are permissionless but state-gated.

## Timeout and Refund Behavior

- Before deadline: only score submissions and optional success settlement checks.
- After deadline: refund path always available when still `Open`.
- Once settled (`SettledSuccess` or `SettledRefund`), campaign is terminal and immutable for value transfer.

## Unresolved Items

- None for MVP Task 1 freeze.

## Out of Scope (MVP)

- Weighted validator reputation.
- Multi-asset payouts.
- Partial payouts or tranche logic.
- Appeals/challenges.
- Slashing or validator bonding.

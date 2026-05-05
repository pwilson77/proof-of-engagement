use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use std::collections::BTreeSet;

declare_id!("PoEe1hTQghtjuxrbR628JjpNPfLxEDN5GagwqUvJTGA");

const MAX_VALIDATORS: usize = 16;
const STATUS_OPEN: u8 = 0;
const STATUS_SETTLED_SUCCESS: u8 = 1;
const STATUS_SETTLED_REFUND: u8 = 2;
const BPS_DENOMINATOR: u16 = 10_000;

#[program]
pub mod proof_of_engagement {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, usdc_mint: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.usdc_mint = usdc_mint;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn create_validator_set(
        ctx: Context<CreateValidatorSet>,
        campaign_id: u64,
        validators: Vec<Pubkey>,
    ) -> Result<()> {
        require!(!validators.is_empty(), PoeError::EmptyValidatorSet);
        require!(validators.len() <= MAX_VALIDATORS, PoeError::TooManyValidators);

        let validator_set = &mut ctx.accounts.validator_set;
        validator_set.creator = ctx.accounts.creator.key();
        validator_set.campaign_id = campaign_id;
        validator_set.validators = validators;
        validator_set.validator_count = validator_set.validators.len() as u8;
        validator_set.validator_set_hash = canonical_validator_hash(&validator_set.validators);
        validator_set.bump = ctx.bumps.validator_set;

        Ok(())
    }

    pub fn create_campaign(ctx: Context<CreateCampaign>, args: CreateCampaignArgs) -> Result<()> {
        require!(args.amount > 0, PoeError::InvalidAmount);
        require!(args.validator_count > 0, PoeError::InvalidValidatorCount);
        require!(args.threshold_bps > 0, PoeError::InvalidThreshold);
        require!(args.threshold_bps <= BPS_DENOMINATOR, PoeError::InvalidThreshold);

        let now = Clock::get()?.unix_timestamp;
        require!(args.deadline_unix > now, PoeError::InvalidDeadline);

        let config = &ctx.accounts.config;
        require!(ctx.accounts.mint.key() == config.usdc_mint, PoeError::InvalidMint);

        let validator_set = &ctx.accounts.validator_set;
        require!(validator_set.creator == ctx.accounts.creator.key(), PoeError::InvalidValidatorSet);
        require!(validator_set.campaign_id == args.campaign_id, PoeError::InvalidValidatorSet);
        require!(validator_set.validator_count == args.validator_count, PoeError::InvalidValidatorCount);
        require!(validator_set.validator_set_hash == args.validator_set_hash, PoeError::InvalidValidatorSetHash);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            args.amount,
        )?;

        let campaign = &mut ctx.accounts.campaign;
        campaign.campaign_id = args.campaign_id;
        campaign.creator = ctx.accounts.creator.key();
        campaign.executor = args.executor;
        campaign.mint = ctx.accounts.mint.key();
        campaign.escrow_token_account = ctx.accounts.escrow_token_account.key();
        campaign.amount = args.amount;
        campaign.task_ref = args.task_ref;
        campaign.validator_set_hash = args.validator_set_hash;
        campaign.validator_count = args.validator_count;
        campaign.threshold_bps = args.threshold_bps;
        campaign.deadline_unix = args.deadline_unix;
        campaign.status = STATUS_OPEN;
        campaign.created_at_unix = now;
        campaign.bump = ctx.bumps.campaign;

        Ok(())
    }

    pub fn submit_validator_score(
        ctx: Context<SubmitValidatorScore>,
        _campaign_id: u64,
        score_bps: u16,
    ) -> Result<()> {
        require!(score_bps <= BPS_DENOMINATOR, PoeError::InvalidScore);

        let now = Clock::get()?.unix_timestamp;
        let campaign = &ctx.accounts.campaign;
        require!(campaign.status == STATUS_OPEN, PoeError::CampaignNotOpen);
        require!(now <= campaign.deadline_unix, PoeError::CampaignExpired);

        let validator_set = &ctx.accounts.validator_set;
        require!(validator_set.validator_set_hash == campaign.validator_set_hash, PoeError::InvalidValidatorSetHash);
        require!(validator_set.validator_count == campaign.validator_count, PoeError::InvalidValidatorCount);

        let validator = ctx.accounts.validator.key();
        require!(validator_set.validators.contains(&validator), PoeError::ValidatorNotAllowed);

        let score = &mut ctx.accounts.validator_score;
        score.campaign = campaign.key();
        score.validator = validator;
        score.score_bps = score_bps;
        score.submitted_at_unix = now;
        score.bump = ctx.bumps.validator_score;

        Ok(())
    }

    pub fn settle_success(ctx: Context<SettleSuccess>, _campaign_id: u64) -> Result<()> {
        let campaign_creator = ctx.accounts.campaign.creator;
        let campaign_id = ctx.accounts.campaign.campaign_id;
        let campaign_bump = ctx.accounts.campaign.bump;
        let campaign_threshold_bps = ctx.accounts.campaign.threshold_bps;
        let campaign_key = ctx.accounts.campaign.key();

        require!(ctx.accounts.campaign.status == STATUS_OPEN, PoeError::CampaignNotOpen);

        let mut score_inputs: Vec<ScoreInput> = Vec::new();

        for score_info in ctx.remaining_accounts.iter() {
            require!(score_info.owner == &crate::ID, PoeError::InvalidScoreAccount);

            let mut data_slice: &[u8] = &score_info.try_borrow_data()?;
            let score_account = ValidatorScore::try_deserialize(&mut data_slice)?;

            require!(score_account.campaign == campaign_key, PoeError::InvalidScoreAccount);

            score_inputs.push(ScoreInput {
                validator: score_account.validator,
                score_bps: score_account.score_bps,
            });
        }

        let average_bps = compute_average_score_bps(&score_inputs).map_err(|e| error!(e))?;
        require!(average_bps >= campaign_threshold_bps, PoeError::ThresholdNotMet);

        let signer_seeds: &[&[u8]] = &[
            b"campaign",
            campaign_creator.as_ref(),
            &campaign_id.to_le_bytes(),
            &[campaign_bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.executor_token_account.to_account_info(),
                    authority: ctx.accounts.campaign.to_account_info(),
                },
                &[signer_seeds],
            ),
            ctx.accounts.escrow_token_account.amount,
        )?;

        ctx.accounts.campaign.status = STATUS_SETTLED_SUCCESS;

        Ok(())
    }

    pub fn settle_timeout_refund(ctx: Context<SettleTimeoutRefund>, _campaign_id: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let campaign_creator = ctx.accounts.campaign.creator;
        let campaign_id = ctx.accounts.campaign.campaign_id;
        let campaign_bump = ctx.accounts.campaign.bump;

        ensure_timeout_refund_allowed(ctx.accounts.campaign.status, now, ctx.accounts.campaign.deadline_unix)
            .map_err(|e| error!(e))?;

        let signer_seeds: &[&[u8]] = &[
            b"campaign",
            campaign_creator.as_ref(),
            &campaign_id.to_le_bytes(),
            &[campaign_bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.creator_refund_token_account.to_account_info(),
                    authority: ctx.accounts.campaign.to_account_info(),
                },
                &[signer_seeds],
            ),
            ctx.accounts.escrow_token_account.amount,
        )?;

        ctx.accounts.campaign.status = STATUS_SETTLED_REFUND;

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateCampaignArgs {
    pub campaign_id: u64,
    pub executor: Pubkey,
    pub amount: u64,
    pub task_ref: [u8; 32],
    pub validator_set_hash: [u8; 32],
    pub validator_count: u8,
    pub threshold_bps: u16,
    pub deadline_unix: i64,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Config::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct CreateValidatorSet<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = ValidatorSet::LEN,
        seeds = [b"validator_set", creator.key().as_ref(), &campaign_id.to_le_bytes()],
        bump
    )]
    pub validator_set: Account<'info, ValidatorSet>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: CreateCampaignArgs)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = creator_token_account.owner == creator.key(),
        constraint = creator_token_account.mint == mint.key(),
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"validator_set", creator.key().as_ref(), &args.campaign_id.to_le_bytes()],
        bump = validator_set.bump,
    )]
    pub validator_set: Account<'info, ValidatorSet>,
    #[account(
        init,
        payer = creator,
        space = Campaign::LEN,
        seeds = [b"campaign", creator.key().as_ref(), &args.campaign_id.to_le_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,
    #[account(
        init,
        payer = creator,
        token::mint = mint,
        token::authority = campaign,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct SubmitValidatorScore<'info> {
    #[account(mut)]
    pub validator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"campaign", campaign.creator.as_ref(), &campaign_id.to_le_bytes()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,
    #[account(
        seeds = [b"validator_set", campaign.creator.as_ref(), &campaign_id.to_le_bytes()],
        bump = validator_set.bump,
    )]
    pub validator_set: Account<'info, ValidatorSet>,
    #[account(
        init,
        payer = validator,
        space = ValidatorScore::LEN,
        seeds = [b"score", campaign.key().as_ref(), validator.key().as_ref()],
        bump
    )]
    pub validator_score: Account<'info, ValidatorScore>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct SettleSuccess<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"campaign", campaign.creator.as_ref(), &campaign_id.to_le_bytes()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut,
        constraint = escrow_token_account.key() == campaign.escrow_token_account,
        constraint = escrow_token_account.mint == campaign.mint,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = executor_token_account.owner == campaign.executor,
        constraint = executor_token_account.mint == campaign.mint,
    )]
    pub executor_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct SettleTimeoutRefund<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"campaign", campaign.creator.as_ref(), &campaign_id.to_le_bytes()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut,
        constraint = escrow_token_account.key() == campaign.escrow_token_account,
        constraint = escrow_token_account.mint == campaign.mint,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = creator_refund_token_account.owner == campaign.creator,
        constraint = creator_refund_token_account.mint == campaign.mint,
    )]
    pub creator_refund_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 8 + 32 + 32 + 1;
}

#[account]
pub struct ValidatorSet {
    pub creator: Pubkey,
    pub campaign_id: u64,
    pub validators: Vec<Pubkey>,
    pub validator_count: u8,
    pub validator_set_hash: [u8; 32],
    pub bump: u8,
}

impl ValidatorSet {
    pub const LEN: usize = 8 + 32 + 8 + 4 + (32 * MAX_VALIDATORS) + 1 + 32 + 1;
}

#[account]
pub struct Campaign {
    pub campaign_id: u64,
    pub creator: Pubkey,
    pub executor: Pubkey,
    pub mint: Pubkey,
    pub escrow_token_account: Pubkey,
    pub amount: u64,
    pub task_ref: [u8; 32],
    pub validator_set_hash: [u8; 32],
    pub validator_count: u8,
    pub threshold_bps: u16,
    pub deadline_unix: i64,
    pub status: u8,
    pub created_at_unix: i64,
    pub bump: u8,
}

impl Campaign {
    pub const LEN: usize = 8 + 8 + (32 * 4) + 8 + 32 + 32 + 1 + 2 + 8 + 1 + 8 + 1;
}

#[account]
pub struct ValidatorScore {
    pub campaign: Pubkey,
    pub validator: Pubkey,
    pub score_bps: u16,
    pub submitted_at_unix: i64,
    pub bump: u8,
}

#[derive(Clone, Copy)]
struct ScoreInput {
    validator: Pubkey,
    score_bps: u16,
}

impl ValidatorScore {
    pub const LEN: usize = 8 + 32 + 32 + 2 + 8 + 1;
}

#[error_code]
pub enum PoeError {
    #[msg("invalid amount")]
    InvalidAmount,
    #[msg("invalid validator count")]
    InvalidValidatorCount,
    #[msg("invalid threshold")]
    InvalidThreshold,
    #[msg("invalid deadline")]
    InvalidDeadline,
    #[msg("invalid mint")]
    InvalidMint,
    #[msg("empty validator set")]
    EmptyValidatorSet,
    #[msg("too many validators")]
    TooManyValidators,
    #[msg("invalid validator set")]
    InvalidValidatorSet,
    #[msg("invalid validator set hash")]
    InvalidValidatorSetHash,
    #[msg("invalid score")]
    InvalidScore,
    #[msg("campaign is not open")]
    CampaignNotOpen,
    #[msg("campaign deadline reached")]
    CampaignExpired,
    #[msg("validator not allowed")]
    ValidatorNotAllowed,
    #[msg("invalid score account")]
    InvalidScoreAccount,
    #[msg("no scores submitted")]
    NoScoresSubmitted,
    #[msg("threshold not met")]
    ThresholdNotMet,
    #[msg("deadline not reached")]
    DeadlineNotReached,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("duplicate validator score")]
    DuplicateValidatorScore,
}

fn compute_average_score_bps(scores: &[ScoreInput]) -> std::result::Result<u16, PoeError> {
    if scores.is_empty() {
        return Err(PoeError::NoScoresSubmitted);
    }

    let mut validators_seen = BTreeSet::new();
    let mut sum: u64 = 0;

    for score in scores {
        if score.score_bps > BPS_DENOMINATOR {
            return Err(PoeError::InvalidScore);
        }
        if !validators_seen.insert(score.validator) {
            return Err(PoeError::DuplicateValidatorScore);
        }
        sum = sum
            .checked_add(score.score_bps as u64)
            .ok_or(PoeError::MathOverflow)?;
    }

    let average = sum
        .checked_div(scores.len() as u64)
        .ok_or(PoeError::MathOverflow)?;

    u16::try_from(average).map_err(|_| PoeError::MathOverflow)
}

fn ensure_timeout_refund_allowed(
    status: u8,
    now_unix: i64,
    deadline_unix: i64,
) -> std::result::Result<(), PoeError> {
    if status != STATUS_OPEN {
        return Err(PoeError::CampaignNotOpen);
    }
    if now_unix <= deadline_unix {
        return Err(PoeError::DeadlineNotReached);
    }
    Ok(())
}

fn canonical_validator_hash(validators: &[Pubkey]) -> [u8; 32] {
    let mut validator_bytes: Vec<[u8; 32]> = validators.iter().map(|v| v.to_bytes()).collect();
    validator_bytes.sort_unstable();

    let chunks: Vec<&[u8]> = validator_bytes.iter().map(|b| b.as_slice()).collect();
    hashv(&chunks).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn score(validator_seed: u8, score_bps: u16) -> ScoreInput {
        ScoreInput {
            validator: Pubkey::new_from_array([validator_seed; 32]),
            score_bps,
        }
    }

    #[test]
    fn settlement_happy_path_average_meets_threshold() {
        let scores = vec![score(1, 8_500), score(2, 9_000), score(3, 8_000)];
        let avg = compute_average_score_bps(&scores).expect("average should compute");
        assert!(avg >= 8_000);
    }

    #[test]
    fn settlement_below_threshold_fails() {
        let scores = vec![score(1, 4_000), score(2, 5_000), score(3, 5_500)];
        let avg = compute_average_score_bps(&scores).expect("average should compute");
        assert!(avg < 6_000);
    }

    #[test]
    fn settlement_conflicting_scores_is_deterministic() {
        let scores = vec![score(1, 10_000), score(2, 0), score(3, 10_000)];
        let avg = compute_average_score_bps(&scores).expect("average should compute");
        assert_eq!(avg, 6_666);
    }

    #[test]
    fn duplicate_validator_submission_is_rejected() {
        let duplicate_validator = Pubkey::new_from_array([7; 32]);
        let scores = vec![
            ScoreInput {
                validator: duplicate_validator,
                score_bps: 7_000,
            },
            ScoreInput {
                validator: duplicate_validator,
                score_bps: 8_000,
            },
        ];

        let err = compute_average_score_bps(&scores).expect_err("duplicate validator should fail");
        assert!(matches!(err, PoeError::DuplicateValidatorScore));
    }

    #[test]
    fn timeout_refund_eligibility_behaves_correctly() {
        ensure_timeout_refund_allowed(STATUS_OPEN, 200, 100).expect("refund should be allowed");

        let not_reached = ensure_timeout_refund_allowed(STATUS_OPEN, 100, 100)
            .expect_err("refund should fail before timeout");
        assert!(matches!(not_reached, PoeError::DeadlineNotReached));

        let not_open = ensure_timeout_refund_allowed(STATUS_SETTLED_SUCCESS, 200, 100)
            .expect_err("refund should fail for closed campaign");
        assert!(matches!(not_open, PoeError::CampaignNotOpen));
    }
}

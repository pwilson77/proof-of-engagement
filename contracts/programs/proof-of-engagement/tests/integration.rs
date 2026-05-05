/// Integration tests for the Proof-of-Engagement program.
///
/// These run using `solana-program-test` in native mode — no BPF build is
/// required.  The program entry point is registered via `processor!(entry)`,
/// so every test exercises the full Anchor instruction-dispatch path against a
/// simulated local validator (BanksClient).
use std::str::FromStr;

use anchor_lang::{InstructionData, ToAccountMetas};
use solana_program_test::{processor, tokio, BanksClient, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    program_option::COption,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
    system_instruction,
    transaction::Transaction,
};
use spl_token::state::{AccountState, Mint};

use proof_of_engagement::{
    entry,
    instruction as poe_ix,
    CreateCampaignArgs, ID as POE_ID,
};

// ── helpers ──────────────────────────────────────────────────────────────────

/// Thin wrapper that gives `entry` the `for<'a, 'b, 'c> fn(...)` signature
/// required by `processor!`.  Anchor's `entry` couples the slice and
/// AccountInfo lifetimes (`&'info [AccountInfo<'info>]`), which prevents it
/// from being used directly as a `ProcessInstruction` fn-pointer.
///
/// SAFETY: In solana-program-test native mode the accounts are always valid
/// for the entire instruction call ('b == 'c in practice).  We use transmute
/// to bridge the invariant lifetime gap — only the annotation changes, not
/// the underlying memory layout.
fn poe_entry(
    program_id: &solana_sdk::pubkey::Pubkey,
    accounts: &[solana_sdk::account_info::AccountInfo],
    instruction_data: &[u8],
) -> solana_sdk::entrypoint::ProgramResult {
    let accounts: &[solana_sdk::account_info::AccountInfo] =
        unsafe { std::mem::transmute(accounts) };
    entry(program_id, accounts, instruction_data)
}

fn program_test() -> ProgramTest {
    ProgramTest::new("proof_of_engagement", POE_ID, processor!(poe_entry))
}

/// Create a fresh SPL-Token mint account and return its pubkey.
async fn create_mint(
    ctx: &mut ProgramTestContext,
    authority: &Keypair,
    decimals: u8,
) -> Pubkey {
    let mint_keypair = Keypair::new();
    let rent = ctx.banks_client.get_rent().await.unwrap();
    let mint_rent = rent.minimum_balance(Mint::LEN);

    let create_ix = system_instruction::create_account(
        &ctx.payer.pubkey(),
        &mint_keypair.pubkey(),
        mint_rent,
        Mint::LEN as u64,
        &spl_token::ID,
    );
    let init_ix = spl_token::instruction::initialize_mint(
        &spl_token::ID,
        &mint_keypair.pubkey(),
        &authority.pubkey(),
        None,
        decimals,
    )
    .unwrap();

    let tx = Transaction::new_signed_with_payer(
        &[create_ix, init_ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &mint_keypair],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
    mint_keypair.pubkey()
}

/// Create an associated-style token account (keypair-based) and return its
/// pubkey.  `owner` is the wallet that will own the token account.
async fn create_token_account(
    ctx: &mut ProgramTestContext,
    mint: Pubkey,
    owner: Pubkey,
) -> Keypair {
    let ta_keypair = Keypair::new();
    let rent = ctx.banks_client.get_rent().await.unwrap();
    let ta_rent = rent.minimum_balance(spl_token::state::Account::LEN);

    let create_ix = system_instruction::create_account(
        &ctx.payer.pubkey(),
        &ta_keypair.pubkey(),
        ta_rent,
        spl_token::state::Account::LEN as u64,
        &spl_token::ID,
    );
    let init_ix = spl_token::instruction::initialize_account(
        &spl_token::ID,
        &ta_keypair.pubkey(),
        &mint,
        &owner,
    )
    .unwrap();

    let tx = Transaction::new_signed_with_payer(
        &[create_ix, init_ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &ta_keypair],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
    ta_keypair
}

/// Mint `amount` tokens to a token account.
async fn mint_to(
    ctx: &mut ProgramTestContext,
    mint: Pubkey,
    dest: Pubkey,
    mint_authority: &Keypair,
    amount: u64,
) {
    let ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        &mint,
        &dest,
        &mint_authority.pubkey(),
        &[],
        amount,
    )
    .unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, mint_authority],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
}

/// Derive the canonical `[u8; 32]` hash for a validator set the same way the
/// on-chain program does it (sorted pubkeys → sha256).
fn canonical_validator_hash(validators: &[Pubkey]) -> [u8; 32] {
    let mut sorted: Vec<&[u8]> = validators.iter().map(|v| v.as_ref()).collect();
    sorted.sort();
    use anchor_lang::solana_program::hash::hashv;
    hashv(&sorted).to_bytes()
}

/// Call `initialize_config` and return the config PDA.
async fn initialize_config(
    ctx: &mut ProgramTestContext,
    authority: &Keypair,
    usdc_mint: Pubkey,
) -> Pubkey {
    let (config_pda, _) = Pubkey::find_program_address(&[b"config"], &POE_ID);

    let ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::InitializeConfig {
            authority: authority.pubkey(),
            config: config_pda,
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: poe_ix::InitializeConfig { usdc_mint }.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, authority],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
    config_pda
}

/// Call `create_validator_set` and return the PDA.
async fn create_validator_set(
    ctx: &mut ProgramTestContext,
    creator: &Keypair,
    campaign_id: u64,
    validators: Vec<Pubkey>,
) -> Pubkey {
    let (vs_pda, _) = Pubkey::find_program_address(
        &[
            b"validator_set",
            creator.pubkey().as_ref(),
            &campaign_id.to_le_bytes(),
        ],
        &POE_ID,
    );

    let ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::CreateValidatorSet {
            creator: creator.pubkey(),
            validator_set: vs_pda,
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: poe_ix::CreateValidatorSet {
            campaign_id,
            validators,
        }
        .data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, creator],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
    vs_pda
}

// ── full happy-path test ──────────────────────────────────────────────────────

#[tokio::test]
async fn test_full_happy_path() {
    let mut ctx = program_test().start_with_context().await;

    let authority = Keypair::new();
    let creator = Keypair::new();
    let executor = Keypair::new();
    let validator_a = Keypair::new();
    let validator_b = Keypair::new();

    // Airdrop SOL to participants
    for kp in [&authority, &creator, &executor, &validator_a, &validator_b] {
        let ix = system_instruction::transfer(
            &ctx.payer.pubkey(),
            &kp.pubkey(),
            2_000_000_000,
        );
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer],
            ctx.last_blockhash,
        );
        ctx.banks_client.process_transaction(tx).await.unwrap();
    }

    // Create USDC mint
    let usdc_mint = create_mint(&mut ctx, &authority, 6).await;

    // Create token accounts
    let creator_ta = create_token_account(&mut ctx, usdc_mint, creator.pubkey()).await;
    let executor_ta = create_token_account(&mut ctx, usdc_mint, executor.pubkey()).await;

    // Fund creator with 1000 USDC
    mint_to(&mut ctx, usdc_mint, creator_ta.pubkey(), &authority, 1_000_000).await;

    // initialize_config
    let config_pda = initialize_config(&mut ctx, &authority, usdc_mint).await;

    // create_validator_set
    let campaign_id: u64 = 1;
    let validators = vec![validator_a.pubkey(), validator_b.pubkey()];
    let vs_hash = canonical_validator_hash(&validators);
    let vs_pda =
        create_validator_set(&mut ctx, &creator, campaign_id, validators.clone()).await;

    // create_campaign — escrow keypair is new
    let escrow_kp = Keypair::new();
    let (campaign_pda, _) = Pubkey::find_program_address(
        &[b"campaign", creator.pubkey().as_ref(), &campaign_id.to_le_bytes()],
        &POE_ID,
    );

    // Deadline = current slot + 3600 seconds (well in the future)
    let clock = ctx.banks_client.get_sysvar::<solana_sdk::sysvar::clock::Clock>().await.unwrap();
    let deadline = clock.unix_timestamp + 3600;

    let args = CreateCampaignArgs {
        campaign_id,
        executor: executor.pubkey(),
        amount: 500_000,
        task_ref: [0u8; 32],
        validator_set_hash: vs_hash,
        validator_count: 2,
        threshold_bps: 6_000, // 60 %
        deadline_unix: deadline,
    };

    let create_campaign_ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::CreateCampaign {
            creator: creator.pubkey(),
            config: config_pda,
            mint: usdc_mint,
            creator_token_account: creator_ta.pubkey(),
            validator_set: vs_pda,
            campaign: campaign_pda,
            escrow_token_account: escrow_kp.pubkey(),
            token_program: spl_token::ID,
            system_program: solana_sdk::system_program::ID,
            rent: solana_sdk::sysvar::rent::ID,
        }
        .to_account_metas(None),
        data: poe_ix::CreateCampaign { args }.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[create_campaign_ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &creator, &escrow_kp],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();

    // submit_validator_score from both validators
    for (validator_kp, score) in [(&validator_a, 8_000u16), (&validator_b, 9_000u16)] {
        let (score_pda, _) = Pubkey::find_program_address(
            &[
                b"score",
                campaign_pda.as_ref(),
                validator_kp.pubkey().as_ref(),
            ],
            &POE_ID,
        );

        let ix = Instruction {
            program_id: POE_ID,
            accounts: proof_of_engagement::accounts::SubmitValidatorScore {
                validator: validator_kp.pubkey(),
                campaign: campaign_pda,
                validator_set: vs_pda,
                validator_score: score_pda,
                system_program: solana_sdk::system_program::ID,
            }
            .to_account_metas(None),
            data: poe_ix::SubmitValidatorScore {
                _campaign_id: campaign_id,
                score_bps: score,
            }
            .data(),
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer, validator_kp],
            ctx.last_blockhash,
        );
        ctx.banks_client.process_transaction(tx).await.unwrap();
    }

    // settle_success — pass both score PDAs as remaining_accounts
    let (score_a_pda, _) = Pubkey::find_program_address(
        &[b"score", campaign_pda.as_ref(), validator_a.pubkey().as_ref()],
        &POE_ID,
    );
    let (score_b_pda, _) = Pubkey::find_program_address(
        &[b"score", campaign_pda.as_ref(), validator_b.pubkey().as_ref()],
        &POE_ID,
    );

    let caller = Keypair::new();
    let ix_settle = system_instruction::transfer(&ctx.payer.pubkey(), &caller.pubkey(), 1_000_000);
    let tx = Transaction::new_signed_with_payer(
        &[ix_settle],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();

    let mut settle_metas = proof_of_engagement::accounts::SettleSuccess {
        caller: caller.pubkey(),
        campaign: campaign_pda,
        escrow_token_account: escrow_kp.pubkey(),
        executor_token_account: executor_ta.pubkey(),
        token_program: spl_token::ID,
    }
    .to_account_metas(None);
    // Add remaining_accounts (score PDAs) as non-signer, non-writable
    settle_metas.push(solana_sdk::instruction::AccountMeta::new_readonly(
        score_a_pda, false,
    ));
    settle_metas.push(solana_sdk::instruction::AccountMeta::new_readonly(
        score_b_pda, false,
    ));

    let settle_ix = Instruction {
        program_id: POE_ID,
        accounts: settle_metas,
        data: poe_ix::SettleSuccess { _campaign_id: campaign_id }.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[settle_ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &caller],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();

    // Assert executor received the funds
    let executor_ta_account = ctx
        .banks_client
        .get_account(executor_ta.pubkey())
        .await
        .unwrap()
        .unwrap();
    let executor_ta_state =
        spl_token::state::Account::unpack(&executor_ta_account.data).unwrap();
    assert_eq!(executor_ta_state.amount, 500_000, "executor should have received 500_000 tokens");
}

// ── timeout refund test ───────────────────────────────────────────────────────

#[tokio::test]
async fn test_timeout_refund() {
    let mut ctx = program_test().start_with_context().await;

    let authority = Keypair::new();
    let creator = Keypair::new();
    let executor = Keypair::new();
    let validator = Keypair::new();

    for kp in [&authority, &creator, &executor, &validator] {
        let ix = system_instruction::transfer(
            &ctx.payer.pubkey(),
            &kp.pubkey(),
            2_000_000_000,
        );
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer],
            ctx.last_blockhash,
        );
        ctx.banks_client.process_transaction(tx).await.unwrap();
    }

    let usdc_mint = create_mint(&mut ctx, &authority, 6).await;
    let creator_ta = create_token_account(&mut ctx, usdc_mint, creator.pubkey()).await;
    mint_to(&mut ctx, usdc_mint, creator_ta.pubkey(), &authority, 1_000_000).await;

    let config_pda = initialize_config(&mut ctx, &authority, usdc_mint).await;

    let campaign_id: u64 = 42;
    let validators = vec![validator.pubkey()];
    let vs_hash = canonical_validator_hash(&validators);
    let vs_pda = create_validator_set(&mut ctx, &creator, campaign_id, validators).await;

    let escrow_kp = Keypair::new();
    let (campaign_pda, _) = Pubkey::find_program_address(
        &[b"campaign", creator.pubkey().as_ref(), &campaign_id.to_le_bytes()],
        &POE_ID,
    );

    // Deadline only 10 seconds from now so we can warp past it
    let clock = ctx.banks_client.get_sysvar::<solana_sdk::sysvar::clock::Clock>().await.unwrap();
    let deadline = clock.unix_timestamp + 10;

    let args = CreateCampaignArgs {
        campaign_id,
        executor: executor.pubkey(),
        amount: 200_000,
        task_ref: [0u8; 32],
        validator_set_hash: vs_hash,
        validator_count: 1,
        threshold_bps: 5_000,
        deadline_unix: deadline,
    };

    let ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::CreateCampaign {
            creator: creator.pubkey(),
            config: config_pda,
            mint: usdc_mint,
            creator_token_account: creator_ta.pubkey(),
            validator_set: vs_pda,
            campaign: campaign_pda,
            escrow_token_account: escrow_kp.pubkey(),
            token_program: spl_token::ID,
            system_program: solana_sdk::system_program::ID,
            rent: solana_sdk::sysvar::rent::ID,
        }
        .to_account_metas(None),
        data: poe_ix::CreateCampaign { args }.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &creator, &escrow_kp],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();

    // Record creator balance before refund
    let before = spl_token::state::Account::unpack(
        &ctx.banks_client.get_account(creator_ta.pubkey()).await.unwrap().unwrap().data,
    )
    .unwrap()
    .amount;

    // Warp past the deadline
    ctx.warp_to_slot(10_000).unwrap();
        // Get current slot, then warp well past the deadline.
        // DEFAULT_NS_PER_SLOT = 400ms, so 100_000 extra slots = 40_000 seconds.
        let pre_warp_clock = ctx
            .banks_client
            .get_sysvar::<solana_sdk::sysvar::clock::Clock>()
            .await
            .unwrap();
        let target_slot = pre_warp_clock.slot + 100_000;
        ctx.warp_to_slot(target_slot).unwrap();

    let caller = Keypair::new();
    // Ensure caller has lamports (payer covers fee)
    let refund_ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::SettleTimeoutRefund {
            caller: ctx.payer.pubkey(),
            campaign: campaign_pda,
            escrow_token_account: escrow_kp.pubkey(),
            creator_refund_token_account: creator_ta.pubkey(),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: poe_ix::SettleTimeoutRefund { _campaign_id: campaign_id }.data(),
    };

    // Need fresh blockhash after warp
    ctx.last_blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();

    let tx = Transaction::new_signed_with_payer(
        &[refund_ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();

    let after = spl_token::state::Account::unpack(
        &ctx.banks_client.get_account(creator_ta.pubkey()).await.unwrap().unwrap().data,
    )
    .unwrap()
    .amount;

    assert_eq!(after - before, 200_000, "creator should get full refund");
}

// ── threshold not met ─────────────────────────────────────────────────────────

#[tokio::test]
async fn test_threshold_not_met_rejects_settle() {
    let mut ctx = program_test().start_with_context().await;

    let authority = Keypair::new();
    let creator = Keypair::new();
    let executor = Keypair::new();
    let validator = Keypair::new();

    for kp in [&authority, &creator, &executor, &validator] {
        let ix = system_instruction::transfer(
            &ctx.payer.pubkey(),
            &kp.pubkey(),
            2_000_000_000,
        );
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer],
            ctx.last_blockhash,
        );
        ctx.banks_client.process_transaction(tx).await.unwrap();
    }

    let usdc_mint = create_mint(&mut ctx, &authority, 6).await;
    let creator_ta = create_token_account(&mut ctx, usdc_mint, creator.pubkey()).await;
    let executor_ta = create_token_account(&mut ctx, usdc_mint, executor.pubkey()).await;
    mint_to(&mut ctx, usdc_mint, creator_ta.pubkey(), &authority, 1_000_000).await;

    let config_pda = initialize_config(&mut ctx, &authority, usdc_mint).await;

    let campaign_id: u64 = 7;
    let validators = vec![validator.pubkey()];
    let vs_hash = canonical_validator_hash(&validators);
    let vs_pda = create_validator_set(&mut ctx, &creator, campaign_id, validators).await;

    let escrow_kp = Keypair::new();
    let (campaign_pda, _) = Pubkey::find_program_address(
        &[b"campaign", creator.pubkey().as_ref(), &campaign_id.to_le_bytes()],
        &POE_ID,
    );

    let clock = ctx.banks_client.get_sysvar::<solana_sdk::sysvar::clock::Clock>().await.unwrap();
    let deadline = clock.unix_timestamp + 3600;

    let args = CreateCampaignArgs {
        campaign_id,
        executor: executor.pubkey(),
        amount: 100_000,
        task_ref: [0u8; 32],
        validator_set_hash: vs_hash,
        validator_count: 1,
        threshold_bps: 8_000, // 80 % required
        deadline_unix: deadline,
    };

    let ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::CreateCampaign {
            creator: creator.pubkey(),
            config: config_pda,
            mint: usdc_mint,
            creator_token_account: creator_ta.pubkey(),
            validator_set: vs_pda,
            campaign: campaign_pda,
            escrow_token_account: escrow_kp.pubkey(),
            token_program: spl_token::ID,
            system_program: solana_sdk::system_program::ID,
            rent: solana_sdk::sysvar::rent::ID,
        }
        .to_account_metas(None),
        data: poe_ix::CreateCampaign { args }.data(),
    };
    ctx.banks_client
        .process_transaction(Transaction::new_signed_with_payer(
            &[ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer, &creator, &escrow_kp],
            ctx.last_blockhash,
        ))
        .await
        .unwrap();

    // Submit a LOW score (50 % < 80 % threshold)
    let (score_pda, _) = Pubkey::find_program_address(
        &[b"score", campaign_pda.as_ref(), validator.pubkey().as_ref()],
        &POE_ID,
    );
    let submit_ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::SubmitValidatorScore {
            validator: validator.pubkey(),
            campaign: campaign_pda,
            validator_set: vs_pda,
            validator_score: score_pda,
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: poe_ix::SubmitValidatorScore {
            _campaign_id: campaign_id,
            score_bps: 5_000,
        }
        .data(),
    };
    ctx.banks_client
        .process_transaction(Transaction::new_signed_with_payer(
            &[submit_ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer, &validator],
            ctx.last_blockhash,
        ))
        .await
        .unwrap();

    // settle_success should fail
    let mut settle_metas = proof_of_engagement::accounts::SettleSuccess {
        caller: ctx.payer.pubkey(),
        campaign: campaign_pda,
        escrow_token_account: escrow_kp.pubkey(),
        executor_token_account: executor_ta.pubkey(),
        token_program: spl_token::ID,
    }
    .to_account_metas(None);
    settle_metas.push(solana_sdk::instruction::AccountMeta::new_readonly(
        score_pda, false,
    ));

    let settle_ix = Instruction {
        program_id: POE_ID,
        accounts: settle_metas,
        data: poe_ix::SettleSuccess { _campaign_id: campaign_id }.data(),
    };

    let result = ctx
        .banks_client
        .process_transaction(Transaction::new_signed_with_payer(
            &[settle_ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer],
            ctx.last_blockhash,
        ))
        .await;

    assert!(result.is_err(), "settle_success must fail when threshold is not met");
}

// ── duplicate validator score ─────────────────────────────────────────────────

#[tokio::test]
async fn test_duplicate_score_rejected() {
    let mut ctx = program_test().start_with_context().await;

    let authority = Keypair::new();
    let creator = Keypair::new();
    let executor = Keypair::new();
    let validator = Keypair::new();

    for kp in [&authority, &creator, &executor, &validator] {
        let ix = system_instruction::transfer(
            &ctx.payer.pubkey(),
            &kp.pubkey(),
            2_000_000_000,
        );
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer],
            ctx.last_blockhash,
        );
        ctx.banks_client.process_transaction(tx).await.unwrap();
    }

    let usdc_mint = create_mint(&mut ctx, &authority, 6).await;
    let creator_ta = create_token_account(&mut ctx, usdc_mint, creator.pubkey()).await;
    mint_to(&mut ctx, usdc_mint, creator_ta.pubkey(), &authority, 500_000).await;

    let config_pda = initialize_config(&mut ctx, &authority, usdc_mint).await;

    let campaign_id: u64 = 99;
    let validators = vec![validator.pubkey()];
    let vs_hash = canonical_validator_hash(&validators);
    let vs_pda = create_validator_set(&mut ctx, &creator, campaign_id, validators).await;

    let escrow_kp = Keypair::new();
    let (campaign_pda, _) = Pubkey::find_program_address(
        &[b"campaign", creator.pubkey().as_ref(), &campaign_id.to_le_bytes()],
        &POE_ID,
    );

    let clock = ctx.banks_client.get_sysvar::<solana_sdk::sysvar::clock::Clock>().await.unwrap();
    let deadline = clock.unix_timestamp + 3600;

    let args = CreateCampaignArgs {
        campaign_id,
        executor: executor.pubkey(),
        amount: 100_000,
        task_ref: [0u8; 32],
        validator_set_hash: vs_hash,
        validator_count: 1,
        threshold_bps: 5_000,
        deadline_unix: deadline,
    };

    let ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::CreateCampaign {
            creator: creator.pubkey(),
            config: config_pda,
            mint: usdc_mint,
            creator_token_account: creator_ta.pubkey(),
            validator_set: vs_pda,
            campaign: campaign_pda,
            escrow_token_account: escrow_kp.pubkey(),
            token_program: spl_token::ID,
            system_program: solana_sdk::system_program::ID,
            rent: solana_sdk::sysvar::rent::ID,
        }
        .to_account_metas(None),
        data: poe_ix::CreateCampaign { args }.data(),
    };
    ctx.banks_client
        .process_transaction(Transaction::new_signed_with_payer(
            &[ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer, &creator, &escrow_kp],
            ctx.last_blockhash,
        ))
        .await
        .unwrap();

    // First submit succeeds
    let (score_pda, _) = Pubkey::find_program_address(
        &[b"score", campaign_pda.as_ref(), validator.pubkey().as_ref()],
        &POE_ID,
    );
    let submit_ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::SubmitValidatorScore {
            validator: validator.pubkey(),
            campaign: campaign_pda,
            validator_set: vs_pda,
            validator_score: score_pda,
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: poe_ix::SubmitValidatorScore {
            _campaign_id: campaign_id,
            score_bps: 7_000,
        }
        .data(),
    };
    ctx.banks_client
        .process_transaction(Transaction::new_signed_with_payer(
            &[submit_ix.clone()],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer, &validator],
            ctx.last_blockhash,
        ))
        .await
        .unwrap();

    // Second submit: refresh blockhash so it's a NEW distinct transaction.
    // The `init` constraint rejects it because the score PDA already exists.
    ctx.last_blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let result = ctx
        .banks_client
        .process_transaction(Transaction::new_signed_with_payer(
            &[submit_ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer, &validator],
            ctx.last_blockhash,
        ))
        .await;

    assert!(result.is_err(), "duplicate score submission must be rejected");
}

// ── non-validator score rejected ──────────────────────────────────────────────

#[tokio::test]
async fn test_non_validator_score_rejected() {
    let mut ctx = program_test().start_with_context().await;

    let authority = Keypair::new();
    let creator = Keypair::new();
    let executor = Keypair::new();
    let real_validator = Keypair::new();
    let impostor = Keypair::new();

    for kp in [&authority, &creator, &executor, &real_validator, &impostor] {
        let ix = system_instruction::transfer(
            &ctx.payer.pubkey(),
            &kp.pubkey(),
            2_000_000_000,
        );
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer],
            ctx.last_blockhash,
        );
        ctx.banks_client.process_transaction(tx).await.unwrap();
    }

    let usdc_mint = create_mint(&mut ctx, &authority, 6).await;
    let creator_ta = create_token_account(&mut ctx, usdc_mint, creator.pubkey()).await;
    mint_to(&mut ctx, usdc_mint, creator_ta.pubkey(), &authority, 500_000).await;

    let config_pda = initialize_config(&mut ctx, &authority, usdc_mint).await;

    let campaign_id: u64 = 55;
    // Only real_validator is in the set — impostor is NOT
    let validators = vec![real_validator.pubkey()];
    let vs_hash = canonical_validator_hash(&validators);
    let vs_pda = create_validator_set(&mut ctx, &creator, campaign_id, validators).await;

    let escrow_kp = Keypair::new();
    let (campaign_pda, _) = Pubkey::find_program_address(
        &[b"campaign", creator.pubkey().as_ref(), &campaign_id.to_le_bytes()],
        &POE_ID,
    );

    let clock = ctx.banks_client.get_sysvar::<solana_sdk::sysvar::clock::Clock>().await.unwrap();
    let deadline = clock.unix_timestamp + 3600;

    let args = CreateCampaignArgs {
        campaign_id,
        executor: executor.pubkey(),
        amount: 100_000,
        task_ref: [0u8; 32],
        validator_set_hash: vs_hash,
        validator_count: 1,
        threshold_bps: 5_000,
        deadline_unix: deadline,
    };

    let ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::CreateCampaign {
            creator: creator.pubkey(),
            config: config_pda,
            mint: usdc_mint,
            creator_token_account: creator_ta.pubkey(),
            validator_set: vs_pda,
            campaign: campaign_pda,
            escrow_token_account: escrow_kp.pubkey(),
            token_program: spl_token::ID,
            system_program: solana_sdk::system_program::ID,
            rent: solana_sdk::sysvar::rent::ID,
        }
        .to_account_metas(None),
        data: poe_ix::CreateCampaign { args }.data(),
    };
    ctx.banks_client
        .process_transaction(Transaction::new_signed_with_payer(
            &[ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer, &creator, &escrow_kp],
            ctx.last_blockhash,
        ))
        .await
        .unwrap();

    // Impostor tries to submit a score — score PDA is seeded with impostor key
    let (impostor_score_pda, _) = Pubkey::find_program_address(
        &[b"score", campaign_pda.as_ref(), impostor.pubkey().as_ref()],
        &POE_ID,
    );
    let submit_ix = Instruction {
        program_id: POE_ID,
        accounts: proof_of_engagement::accounts::SubmitValidatorScore {
            validator: impostor.pubkey(),
            campaign: campaign_pda,
            validator_set: vs_pda,
            validator_score: impostor_score_pda,
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: poe_ix::SubmitValidatorScore {
            _campaign_id: campaign_id,
            score_bps: 10_000,
        }
        .data(),
    };

    let result = ctx
        .banks_client
        .process_transaction(Transaction::new_signed_with_payer(
            &[submit_ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer, &impostor],
            ctx.last_blockhash,
        ))
        .await;

    assert!(result.is_err(), "non-validator must not be able to submit a score");
}

use crate::{constants::*, errors::MachineError, events::Initialized, params, state::*, util::*};
use anchor_lang::prelude::*;
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitParams {
    pub admin: Pubkey,
    pub guardians: [Pubkey; 2],
    pub keeper: Pubkey,
    pub executor: Pubkey,
    pub intake_signer: Pubkey,
    pub quote_signer: Pubkey,
    pub launch_wallet: Pubkey,
    pub team_wallet: Pubkey,
    pub team_wallets: [Pubkey; 8],
    pub token_mint: Pubkey,
    pub vrf_queue: Pubkey,
    pub rent_buffer_lamports: u64,
}
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(constraint=program.programdata_address()?==Some(program_data.key()))]
    pub program: Program<'info, crate::program::Onepercent>,
    pub program_data: Account<'info, ProgramData>,
    #[account(init,payer=authority,space=CONFIG_SIZE,seeds=[CONFIG_SEED],bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(init,payer=authority,space=MACHINE_SIZE,seeds=[MACHINE_SEED],bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(init,payer=authority,space=params::ACCOUNT_SIZES_DECK_HEADER as usize,seeds=[DECK_SEED],bump)]
    pub deck: AccountLoader<'info, Deck>,
    /// CHECK: System-owned PDA; initialized only by a funding transfer.
    #[account(mut,seeds=[FEE_IN_SEED],bump,owner=anchor_lang::system_program::ID)]
    pub fee_in: UncheckedAccount<'info>,
    /// CHECK: The queue address and VRF ownership are checked in the handler.
    pub vrf_queue: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
pub fn handler(ctx: Context<Initialize>, p: InitParams) -> Result<()> {
    require!(
        ctx.accounts.program_data.upgrade_authority_address == Some(ctx.accounts.authority.key()),
        MachineError::Unauthorized
    );
    require!(
        p.admin != Pubkey::default()
            && p.guardians.iter().all(|x| *x != Pubkey::default())
            && p.intake_signer != Pubkey::default()
            && p.team_wallet != Pubkey::default()
            && p.token_mint != Pubkey::default(),
        MachineError::InvalidArgument
    );
    require_keys_eq!(
        ctx.accounts.vrf_queue.key(),
        p.vrf_queue,
        MachineError::QueueNotAllowed
    );
    require_keys_eq!(
        *ctx.accounts.vrf_queue.owner,
        params::PROGRAM_IDS_MAGICBLOCK_VRF,
        MachineError::QueueNotAllowed
    );
    let mut c = ctx.accounts.config.load_init()?;
    c.admin = p.admin;
    c.guardians = p.guardians;
    c.keeper = p.keeper;
    c.executor = p.executor;
    c.intake_signer = p.intake_signer;
    c.quote_signer = p.quote_signer;
    c.launch_wallet = p.launch_wallet;
    c.team_wallet = p.team_wallet;
    c.team_wallets = p.team_wallets;
    c.token_mint = p.token_mint;
    if let Some(queue) = c.vrf_queues.first_mut() {
        *queue = p.vrf_queue;
    }
    c.version = 1;
    c.bump = ctx.bumps.config;
    c.vrf_program = params::PROGRAM_IDS_MAGICBLOCK_VRF;
    let mut m = ctx.accounts.machine.load_init()?;
    m.keeper_history_version = 1;
    m.version = 1;
    m.bump = ctx.bumps.machine;
    m.next_seq = 1;
    m.vault_auth_bump = Pubkey::find_program_address(&[VAULT_AUTH_SEED], &crate::ID).1;
    m.deck_bump = ctx.bumps.deck;
    m.config_bump = ctx.bumps.config;
    m.fee_in_bump = ctx.bumps.fee_in;
    let mut d = ctx.accounts.deck.load_init()?;
    d.version = 1;
    d.bump = ctx.bumps.deck;
    d.header_rent = rent_min(params::ACCOUNT_SIZES_DECK_HEADER as usize)?;
    drop(c);
    drop(m);
    drop(d);
    transfer(
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.machine.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        p.rent_buffer_lamports,
    )?;
    transfer(
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.fee_in.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        rent_min(0)?.saturating_sub(ctx.accounts.fee_in.lamports()),
    )?;
    emit!(Initialized {
        version: 1,
        admin: p.admin
    });
    Ok(())
}

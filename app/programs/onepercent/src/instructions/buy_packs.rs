use crate::{
    checks::{hold_message, validate_expiry, verify_ed25519},
    constants::*,
    errors::MachineError,
    events::{OnePctLive, PullOpened},
    math, params,
    state::views::*,
    state::*,
    util::*,
};
use anchor_lang::{prelude::*, Discriminator};
use ephemeral_vrf_sdk::{
    anchor::vrf,
    instructions::{create_request_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct HoldProof {
    pub expiry: i64,
    pub att_ix: u8,
}
// Anchor runs init constraints before ordinary account constraints. Check the
// payer while computing init space so the System CPI cannot precede NotWallet.
fn checked_pull_size(
    buyer: &Signer<'_>,
    machine: &AccountLoader<'_, Machine>,
    qty: u8,
) -> Result<usize> {
    require_keys_eq!(
        *buyer.owner,
        anchor_lang::system_program::ID,
        MachineError::NotWallet
    );
    let machine = machine.load()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    Ok(pull_size(qty))
}
#[vrf]
#[derive(Accounts)]
#[instruction(edition:u8,qty:u8,pull_nonce:u32)]
pub struct BuyPacks<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds=[CONFIG_SEED],bump=config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut,seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(seeds=[DECK_SEED],bump=deck.load()?.bump)]
    pub deck: AccountLoader<'info, Deck>,
    /// CHECK: Donation-safe creation and validation in the handler.
    #[account(mut,seeds=[BINDER_SEED,buyer.key().as_ref()],bump)]
    pub binder: UncheckedAccount<'info>,
    #[account(init,payer=buyer,space=checked_pull_size(&buyer,&machine,qty)?,seeds=[PULL_SEED,buyer.key().as_ref(),&pull_nonce.to_le_bytes()],bump)]
    pub pull: AccountLoader<'info, Pull>,
    /// CHECK: VRF program ownership and active allow-list entry are checked.
    #[account(mut,owner=params::PROGRAM_IDS_MAGICBLOCK_VRF @ MachineError::QueueNotAllowed)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: Canonical instruction sysvar.
    #[account(address=anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
pub fn handler(
    ctx: Context<BuyPacks>,
    edition: u8,
    qty: u8,
    pull_nonce: u32,
    min_live_flags: u8,
    referrer: Option<Pubkey>,
    hold: Option<HoldProof>,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let now = Clock::get()?.unix_timestamp;
    let c = ctx.accounts.config.load()?;
    let mut machine = ctx.accounts.machine.load_mut()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    require!(
        (c.admin_paused | c.guardian_paused) & params::PAUSE_BITS_RIP == 0,
        MachineError::Paused
    );
    require!(machine.phase == PHASE_ON_AIR, MachineError::WrongPhase);
    require!(now < machine.end_ts, MachineError::SeasonOver);
    let price = *params::PACK_EDITIONS_PRICE_LAMPORTS
        .get(usize::from(edition))
        .ok_or(MachineError::InvalidEdition)?;
    let limit = *params::PACK_EDITIONS_MAX_PER_RIP
        .get(usize::from(edition))
        .ok_or(MachineError::InvalidEdition)?;
    let escrow = price
        .checked_mul(u64::from(qty))
        .ok_or(MachineError::MathOverflow)?;
    require!(
        qty > 0 && u32::from(qty) <= limit && escrow <= params::MAX_LIST_PER_RIP_LAMPORTS,
        MachineError::InvalidQuantity
    );
    require_keys_eq!(
        *ctx.accounts.buyer.owner,
        anchor_lang::system_program::ID,
        MachineError::NotWallet
    );
    require!(
        !c.is_team(&ctx.accounts.buyer.key()),
        MachineError::TeamWallet
    );
    if let Some((index, release_ts)) = math::specials::promote_onepct(&mut machine, now) {
        emit!(OnePctLive {
            index,
            release_ts,
            ts: now
        });
    }
    let (live_now, _) = math::specials::live_flags(&machine, price, now);
    require!(
        min_live_flags & !live_now == 0,
        MachineError::LiveFlagsChanged
    );
    let queue = *c
        .vrf_queues
        .get(usize::from(c.active_queue))
        .ok_or(MachineError::QueueNotAllowed)?;
    require!(
        queue != Pubkey::default() && queue == ctx.accounts.oracle_queue.key(),
        MachineError::QueueNotAllowed
    );
    let binder = ctx.accounts.binder.to_account_info();
    let buyer = ctx.accounts.buyer.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();
    ensure_binder(&binder, buyer.key, &buyer, &system)?;
    let mut bh = *header::<Binder>(&binder.try_borrow_data()?)?;
    require!(pull_nonce == bh.pull_nonce, MachineError::InvalidArgument);
    let holder = if let Some(proof) = hold {
        require!(c.disabled_roles & (1 << 5) == 0, MachineError::RoleDisabled);
        verify_ed25519(
            &ctx.accounts.instructions.to_account_info(),
            proof.att_ix,
            &c.intake_signer,
            &hold_message(buyer.key, proof.expiry),
        )?;
        validate_expiry(now, proof.expiry, params::ATTESTATIONS_HOLD_TTL_SECONDS)?;
        true
    } else {
        false
    };
    let dust = u64::from(params::CARDS_PER_PACK_DUST)
        .checked_mul(u64::from(qty))
        .ok_or(MachineError::MathOverflow)?;
    let required = machine
        .reserved_dust
        .checked_add(dust)
        .and_then(|x| x.checked_add(u64::from(params::COVERAGE_DUST_BUFFER)))
        .ok_or(MachineError::MathOverflow)?;
    require!(
        u64::from(ctx.accounts.deck.load()?.len) >= required,
        MachineError::MachineHungry
    );
    let mut buckets = machine.buckets.map(|b| math::BucketInput {
        class: b.class,
        enabled: b.enabled != 0,
        amount: b.amount,
        cost: b.cost,
        reserved: b.reserved,
    });
    let backing = math::coverage(price, qty, &mut buckets).ok_or(MachineError::Refilling)?;
    for (bucket, draft) in machine.buckets.iter_mut().zip(buckets) {
        bucket.reserved = draft.reserved;
    }
    if bh.referrer == Pubkey::default() && bh.season_spend == 0 {
        if let Some(r) = referrer {
            if r != Pubkey::default() && r != *buyer.key {
                bh.referrer = r;
            }
        }
    }
    bh.pull_nonce = bh
        .pull_nonce
        .checked_add(1)
        .ok_or(MachineError::MathOverflow)?;
    *header_mut::<Binder>(&mut binder.try_borrow_mut_data()?)? = bh;
    let slots = params::CARDS_PER_PACK_DUST
        .checked_add(params::CARDS_PER_PACK_HIT)
        .and_then(|x| x.checked_mul(u32::from(qty)))
        .ok_or(MachineError::MathOverflow)?;
    grow_binder(
        &binder,
        &buyer,
        &system,
        u16::try_from(slots).map_err(|_| error!(MachineError::BinderFull))?,
    )?;
    let seq = machine.next_seq;
    {
        let mut p = ctx.accounts.pull.load_init()?;
        p.seq = seq;
        p.buyer = *buyer.key;
        p.referrer = bh.referrer;
        p.created_ts = now;
        p.price = price;
        p.buyer_nonce = pull_nonce;
        p.edition = edition;
        p.qty = qty;
        p.status = PULL_PENDING;
        p.holder = u8::from(holder);
        p.bump = ctx.bumps.pull;
        p.version = 1;
    }
    let pull = ctx.accounts.pull.to_account_info();
    let mut event_backing = [TIER_NOT_DRAWN; 10];
    {
        let mut data = pull.try_borrow_mut_data()?;
        let packs = tail_mut::<PackRecord>(&mut data, PULL_HEADER)?;
        for ((pack, bucket), event) in packs
            .iter_mut()
            .zip(backing.iter())
            .zip(event_backing.iter_mut())
        {
            pack.backing = *bucket;
            pack.tier = TIER_NOT_DRAWN;
            pack.carved_bucket = TIER_NOT_DRAWN;
            *event = *bucket;
        }
    }
    transfer(&buyer, &pull, &system, escrow)?;
    machine.next_seq = machine
        .next_seq
        .checked_add(1)
        .ok_or(MachineError::MathOverflow)?;
    machine.reserved_dust = machine
        .reserved_dust
        .checked_add(dust)
        .ok_or(MachineError::MathOverflow)?;
    machine.pending_pulls = machine
        .pending_pulls
        .checked_add(1)
        .ok_or(MachineError::MathOverflow)?;
    drop(machine);
    drop(c);
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: *buyer.key,
        oracle_queue: queue,
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ConsumeRandomness::DISCRIMINATOR.to_vec(),
        caller_seed: math::caller_seed(&crate::ID.to_bytes(), seq, &buyer.key.to_bytes()),
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: ctx.accounts.pull.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.machine.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.deck.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.binder.key(),
                is_signer: false,
                is_writable: true,
            },
        ]),
        callback_args: Some(seq.to_le_bytes().to_vec()),
    });
    ctx.accounts.invoke_signed_vrf(&buyer, &ix)?;
    emit!(PullOpened {
        pull: ctx.accounts.pull.key(),
        seq,
        buyer: *buyer.key,
        edition,
        qty,
        price,
        referrer: bh.referrer,
        holder,
        queue,
        created_ts: now,
        backing: event_backing
    });
    Ok(())
}

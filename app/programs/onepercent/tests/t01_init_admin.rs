#[path = "common/intake_cases.rs"]
mod cases;
mod common;
use anchor_lang::{prelude::Pubkey, AnchorSerialize, InstructionData, ToAccountMetas};
use cases::*;
use common::*;
use onepercent::{
    instructions::{AdminAction, GuardianAction},
    params,
    state::{Config, Deck, Machine, MintLedger},
};
use solana_account::Account;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn admin(env: &Env, action: AdminAction) -> solana_instruction::Instruction {
    env.admin_ix(action.try_to_vec().unwrap())
}
fn guardian(env: &Env, action: GuardianAction) -> solana_instruction::Instruction {
    env.guardian_ix(action.try_to_vec().unwrap())
}
fn init() -> Env {
    let mut env = Env::empty(false);
    env.send(&[env.initialize_ix()], &[]).unwrap();
    env
}
fn queue(env: &mut Env) -> Pubkey {
    let at = Pubkey::new_unique();
    env.put(
        at,
        Account {
            lamports: env.rent_min(8),
            data: vec![0; 8],
            owner: addr(&vrf()),
            ..Default::default()
        },
    );
    at
}
fn add_queue(env: &Env, at: Pubkey) -> solana_instruction::Instruction {
    let mut ix = admin(env, AdminAction::AddVrfQueue { queue: at });
    ix.accounts.push(meta(at, false, false));
    ix
}

#[test]
fn t01_01_init_by_upgrade_authority() {
    let env = init();
    let c = env.state::<Config>(env.config);
    let m = env.state::<Machine>(env.machine);
    let d = env.state::<Deck>(env.deck);
    assert_eq!(c.admin, pubkey(&env.authority.pubkey()));
    assert_eq!(c.intake_signer, pubkey(&env.intake.pubkey()));
    assert_eq!(c.vrf_program, vrf());
    assert_eq!(c.vrf_queues[0], env.queue);
    assert_eq!(m.phase, 0);
    assert_eq!(m.next_seq, 1);
    assert_eq!(
        env.account(env.machine).lamports,
        env.rent_min(3808) + 50_000_000
    );
    assert_eq!((d.len, d.cap), (0, 0));
    assert_eq!(env.account(env.deck).data.len(), 64);
    assert_eq!(env.account(env.fee_in).lamports, env.rent_min(0));
    assert_eq!(
        event_bytes(&env.transactions[0].logs, "Initialized").len(),
        1
    );
}
#[test]
fn t01_02_init_rejects_other_signer() {
    let mut env = Env::empty(false);
    let other = env.user();
    let mut ix = env.initialize_ix();
    ix.accounts[0] = meta(pubkey(&other.pubkey()), true, true);
    assert_error(env.send(&[ix], &[&other]), "Unauthorized");
}
#[test]
fn t01_03_init_twice_fails() {
    let mut env = init();
    assert!(env.send(&[env.initialize_ix()], &[]).is_err());
}
#[test]
fn t01_04_set_role_rotates_and_reenables() {
    let mut env = Env::new();
    let guard = env.guardian.insecure_clone();
    env.send(
        &[guardian(&env, GuardianAction::DisableRole { role: 5 })],
        &[&guard],
    )
    .unwrap();
    let replacement = Keypair::new();
    env.send(
        &[admin(
            &env,
            AdminAction::SetRole {
                role: 5,
                key: pubkey(&replacement.pubkey()),
            },
        )],
        &[],
    )
    .unwrap();
    let c = env.state::<Config>(env.config);
    assert_eq!(c.disabled_roles & (1 << 5), 0);
    assert_eq!(c.intake_signer, pubkey(&replacement.pubkey()));
    env.intake = replacement;
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    env.feed(&user, &bag, 1000, 0).unwrap();
}
#[test]
fn t01_05_admin_actions_reject_non_admin() {
    let mut env = init();
    let stranger = env.user();
    let guard = env.guardian.insecure_clone();
    let actions = [
        AdminAction::SetRole {
            role: 5,
            key: Pubkey::new_unique(),
        },
        AdminAction::SetTeam {
            team_wallet: Pubkey::new_unique(),
            team_wallets: [Pubkey::default(); 8],
        },
        AdminAction::SetSeason {
            snapshot_slot: 1,
            snapshot_ts: env.now() - 1,
            stock_up_ts: env.now() + 1,
        },
        AdminAction::SetTokenMint {
            mint: Pubkey::new_unique(),
        },
        AdminAction::AddVrfQueue { queue: env.queue },
        AdminAction::UpdateBucket {
            index: 0,
            enabled: true,
            cap: 1,
        },
        AdminAction::SetPause {
            bits: 2,
            paused: true,
        },
    ];
    for signer in [&stranger, &guard] {
        for action in actions.iter().cloned() {
            let queue = matches!(&action, AdminAction::AddVrfQueue { .. });
            let mut ix = admin(&env, action);
            if queue {
                ix.accounts.push(meta(env.queue, false, false));
            }
            ix.accounts[0] = meta(pubkey(&signer.pubkey()), false, true);
            assert_error(env.send(&[ix], &[signer]), "Unauthorized");
        }
    }
}
#[test]
fn t01_06_set_season_rules() {
    let mut env = init();
    let clock = env.svm.get_sysvar::<Clock>();
    let good = AdminAction::SetSeason {
        snapshot_slot: clock.slot,
        snapshot_ts: clock.unix_timestamp - 1,
        stock_up_ts: clock.unix_timestamp + 10,
    };
    env.send(&[admin(&env, good.clone())], &[]).unwrap();
    assert_error(
        env.send(&[admin(&env, good.clone())], &[]),
        "SeasonAlreadySet",
    );
    config(&mut env, |c| c.season_set = 0);
    env.inject_phase(1);
    assert_error(env.send(&[admin(&env, good)], &[]), "WrongPhase");
    env.inject_phase(0);
    assert_error(
        env.send(
            &[admin(
                &env,
                AdminAction::SetSeason {
                    snapshot_slot: clock.slot + 1,
                    snapshot_ts: clock.unix_timestamp - 1,
                    stock_up_ts: clock.unix_timestamp + 10,
                },
            )],
            &[],
        ),
        "InvalidArgument",
    );
}
#[test]
fn t01_07_set_token_mint_only_in_setup() {
    let mut env = Env::new();
    assert_error(
        env.send(
            &[admin(
                &env,
                AdminAction::SetTokenMint {
                    mint: Pubkey::new_unique(),
                },
            )],
            &[],
        ),
        "WrongPhase",
    );
}
#[test]
fn t01_08_add_vrf_queue_rules() {
    let mut env = init();
    let wrong = Pubkey::new_unique();
    env.fund(wrong, 1_000_000);
    assert_error(env.send(&[add_queue(&env, wrong)], &[]), "QueueNotAllowed");
    assert_error(
        env.send(&[add_queue(&env, env.queue)], &[]),
        "InvalidArgument",
    );
    for _ in 0..3 {
        let next = queue(&mut env);
        env.send(&[add_queue(&env, next)], &[]).unwrap();
    }
    let extra = queue(&mut env);
    assert_error(env.send(&[add_queue(&env, extra)], &[]), "InvalidArgument");
}
#[test]
fn t01_09_list_mint_happy() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    env.token_account(env.vault_auth, &bag, 0);
    env.send(&[env.list_ix(&bag, 1, params::LAMPORTS_PER_SOL)], &[])
        .unwrap();
    let m = env.state::<Machine>(env.machine);
    assert_eq!(m.buckets[0].mint, bag.mint);
    assert_eq!(
        (m.buckets[0].decimals, m.buckets[0].token_program),
        (bag.decimals, 0)
    );
    let l = env.state::<MintLedger>(pda(&[b"ledger", bag.mint.as_ref()]).0);
    assert_eq!(l.payer, pubkey(&env.authority.pubkey()));
}
#[test]
fn t01_10_list_mint_rejections() {
    for mode in 0..5 {
        let mut env = Env::new();
        let mut bag = env.new_pump_mint(false);
        env.token_account(env.vault_auth, &bag, 0);
        let error = match mode {
            0 => {
                env.mutate(bag.mint, |a| write_u32(&mut a.data, 0, 1));
                "MintNotSafe"
            }
            1 => {
                config(&mut env, |c| c.token_mint = bag.mint);
                "MintForbidden"
            }
            2 => {
                let a = env.account(bag.mint);
                bag.mint = params::WSOL_MINT;
                env.put(bag.mint, a);
                env.token_account(env.vault_auth, &bag, 0);
                "MintForbidden"
            }
            3 => {
                env.send(&[env.list_ix(&bag, 1, 1)], &[]).unwrap();
                "BucketExists"
            }
            _ => {
                let missing = env.new_pump_mint(false);
                bag = missing;
                "VaultMismatch"
            }
        };
        assert_error(env.send(&[env.list_ix(&bag, 1, 1)], &[]), error);
    }
    for (class, count, error) in [(1, 16, "BucketsFull"), (2, 4, "TrendingLimit")] {
        let mut env = Env::new();
        for index in 0..count {
            let b = env.new_pump_mint(false);
            env.seed_bucket(index, &b, class, 1, 1);
        }
        let b = env.new_pump_mint(false);
        env.token_account(env.vault_auth, &b, 0);
        assert_error(env.send(&[env.list_ix(&b, class, 1)], &[]), error);
    }
}
#[test]
fn t01_11_guardian_powers_bounded() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    env.seed_bucket(0, &bag, 1, 1000, 1000);
    let guard = env.guardian.insecure_clone();
    for action in [
        GuardianAction::SetPause {
            bits: 1,
            paused: true,
        },
        GuardianAction::SetPause {
            bits: 1,
            paused: false,
        },
        GuardianAction::LowerCap { index: 0, cap: 100 },
        GuardianAction::DisableBucket { index: 0 },
        GuardianAction::DisableRole { role: 3 },
        GuardianAction::SelectVrfQueue { index: 0 },
    ] {
        env.send(&[guardian(&env, action)], &[&guard]).unwrap();
    }
    for (action, error) in [
        (
            GuardianAction::LowerCap { index: 0, cap: 101 },
            "InvalidArgument",
        ),
        (GuardianAction::DisableRole { role: 0 }, "InvalidRole"),
        (
            GuardianAction::SelectVrfQueue { index: 1 },
            "QueueNotAllowed",
        ),
    ] {
        assert_error(env.send(&[guardian(&env, action)], &[&guard]), error);
    }
    let other = env.user();
    let mut ix = guardian(
        &env,
        GuardianAction::SetPause {
            bits: 1,
            paused: true,
        },
    );
    ix.accounts[0] = meta(pubkey(&other.pubkey()), false, true);
    assert_error(env.send(&[ix], &[&other]), "Unauthorized");
}
#[test]
fn t01_12_guardian_cannot_clear_admin_pause() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    let guard = env.guardian.insecure_clone();
    env.send(
        &[admin(
            &env,
            AdminAction::SetPause {
                bits: 2,
                paused: true,
            },
        )],
        &[],
    )
    .unwrap();
    env.send(
        &[guardian(
            &env,
            GuardianAction::SetPause {
                bits: 2,
                paused: false,
            },
        )],
        &[&guard],
    )
    .unwrap();
    assert_error(env.feed(&user, &bag, 1000, 0), "Paused");
    env.send(
        &[admin(
            &env,
            AdminAction::SetPause {
                bits: 2,
                paused: false,
            },
        )],
        &[],
    )
    .unwrap();
    env.feed(&user, &bag, 1000, 0).unwrap();
}
#[test]
fn t01_13_pause_mask_enforced() {
    let mut env = Env::new();
    let guard = env.guardian.insecure_clone();
    assert_error(
        env.send(
            &[admin(
                &env,
                AdminAction::SetPause {
                    bits: 0x20,
                    paused: true,
                },
            )],
            &[],
        ),
        "InvalidArgument",
    );
    assert_error(
        env.send(
            &[guardian(
                &env,
                GuardianAction::SetPause {
                    bits: 0x20,
                    paused: true,
                },
            )],
            &[&guard],
        ),
        "InvalidArgument",
    );
}
#[test]
fn t01_14_advance_phase_rules() {
    let mut env = init();
    let now = env.now();
    let slot = env.svm.get_sysvar::<Clock>().slot;
    env.send(
        &[admin(
            &env,
            AdminAction::SetSeason {
                snapshot_slot: slot,
                snapshot_ts: now - 10,
                stock_up_ts: now + 10,
            },
        )],
        &[],
    )
    .unwrap();
    let advance = instruction(
        "advance_phase",
        vec![
            meta(env.config, false, false),
            meta(env.machine, true, false),
        ],
        &[],
    );
    env.send(&[advance.clone()], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, 0);
    env.warp(11);
    env.send(&[advance.clone()], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, 1);
    env.send(&[advance.clone()], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, 1);
    env.inject_phase(2);
    env.send(&[advance.clone()], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, 3);
    env.warp(params::SEASON_DURATION_SECONDS + 1);
    env.send(&[advance.clone()], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, 4);
    env.send(&[advance], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, 4);
}
#[test]
fn t01_15_stubs_return_not_implemented() {
    let mut env = Env::new();
    for name in ["spotlight_deposit", "spotlight_take_back"] {
        assert_error(
            env.send(
                &[instruction(
                    name,
                    vec![meta(pubkey(&env.authority.pubkey()), false, true)],
                    &[],
                )],
                &[],
            ),
            "NotImplemented",
        );
    }
}

fn anchor_instruction<D: InstructionData, A: ToAccountMetas>(
    data: D,
    accounts: A,
) -> solana_instruction::Instruction {
    ix(anchor_lang::solana_program::instruction::Instruction {
        program_id: onepercent::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    })
}

#[test]
fn t01_16_m2_exec_requires_pairing_and_binder_exits_are_live() {
    for mainnet in [false, true] {
        for token_2022 in [false, true] {
            let mut env = Env::with_mainnet(mainnet);
            env.inject_phase(onepercent::constants::PHASE_ON_AIR);
            let owner = pubkey(&env.authority.pubkey());
            let bag = env.new_pump_mint(token_2022);
            env.seed_bucket(
                0,
                &bag,
                onepercent::constants::BUCKET_MAJOR,
                1000,
                50_000_000,
            );
            let mint = bag.mint;
            let token_program = bag.token_program;
            let ledger = pda(&[b"ledger", mint.as_ref()]).0;
            let vault = ata(&env.vault_auth, &mint, &token_program);
            let src = env.token_account(owner, &bag, 0);
            let wsol = Bag {
                mint: params::WSOL_MINT,
                token_program: token(),
                curve: system(),
                decimals: 9,
            };
            let sol_dest = env.token_account(env.vault_auth, &wsol, 0);
            let native_reserve = env.rent_min(165);
            env.mutate(sol_dest, |account| {
                write_u32(&mut account.data, 109, 1);
                write_u64(&mut account.data, 113, native_reserve);
            });
            let card = onepercent::state::Card {
                mint,
                amount: 1000,
                value: 50_000_000,
                kind: onepercent::constants::KIND_SILVER,
                edition: 0,
                flags: 0,
                _pad: 0,
                seq_lo: 0,
            };
            let binder = env.binder(owner, &[card], 0, 1);
            let mut instructions = vec![
                anchor_instruction(
                    onepercent::instruction::ExecBegin {
                        kind: onepercent::constants::EXEC_KIND_STOCK_SELL,
                        bucket: 0,
                        amount: 1,
                    },
                    onepercent::accounts::ExecBegin {
                        signer: owner,
                        config: env.config,
                        machine: env.machine,
                        mint,
                        ledger,
                        vault,
                        vault_auth: env.vault_auth,
                        src,
                        sol_dest,
                        oracle_0: system(),
                        oracle_1: system(),
                        oracle_2: system(),
                        oracle_3: system(),
                        token_program,
                        spl_token_program: token(),
                        instructions: instructions_sysvar(),
                    },
                ),
                anchor_instruction(
                    onepercent::instruction::ExecEnd {
                        kind: onepercent::constants::EXEC_KIND_STOCK_SELL,
                    },
                    onepercent::accounts::ExecEnd {
                        signer: owner,
                        config: env.config,
                        machine: env.machine,
                        mint,
                        ledger,
                        vault,
                        vault_auth: env.vault_auth,
                        sol_dest,
                        token_program,
                        spl_token_program: token(),
                        system_program: system(),
                    },
                ),
                anchor_instruction(
                    onepercent::instruction::SellBack {
                        cards: vec![onepercent::SellBackCard {
                            index: 0,
                            amount: 1000,
                        }],
                        quote_lamports: 5_000_000,
                        expiry: env.now(),
                        nonce: 0,
                        att_ix: 0,
                    },
                    onepercent::accounts::SellBack {
                        owner,
                        config: env.config,
                        machine: env.machine,
                        binder,
                        mint,
                        ledger,
                        vault,
                        instructions: instructions_sysvar(),
                    },
                ),
                anchor_instruction(
                    onepercent::instruction::FeedBack {
                        card_indices: vec![0],
                    },
                    onepercent::accounts::FeedBack {
                        owner,
                        config: env.config,
                        machine: env.machine,
                        deck: env.deck,
                        binder,
                        system_program: system(),
                    },
                ),
            ];
            // Anchor's static metas leave sol_dest readonly. StockSell callers
            // must explicitly request writable access; buy kinds use System.
            let read_only_stock_sell = instructions[..2].to_vec();
            assert!(!instructions[0].accounts[8].is_writable);
            assert!(!instructions[1].accounts[7].is_writable);
            instructions[0].accounts[8].is_writable = true;
            instructions[1].accounts[7].is_writable = true;
            for kind in [
                onepercent::constants::EXEC_KIND_STOCK_BUY,
                onepercent::constants::EXEC_KIND_BURN,
                onepercent::constants::EXEC_KIND_JACKPOT_BUY,
            ] {
                let mut begin = read_only_stock_sell[0].clone();
                begin.accounts[8].pubkey = addr(&system());
                begin.data = onepercent::instruction::ExecBegin {
                    kind,
                    bucket: if kind == onepercent::constants::EXEC_KIND_STOCK_BUY {
                        0
                    } else {
                        u8::MAX
                    },
                    amount: 1,
                }
                .data();
                let mut end = read_only_stock_sell[1].clone();
                end.accounts[7].pubkey = addr(&system());
                end.data = onepercent::instruction::ExecEnd { kind }.data();
                assert!(!begin.accounts[8].is_writable);
                assert!(!end.accounts[7].is_writable);
                instructions.extend([begin, end]);
            }
            let unchanged = [
                env.config,
                env.machine,
                env.deck,
                binder,
                mint,
                ledger,
                vault,
                src,
                sol_dest,
            ];
            for (instruction, expected_error) in read_only_stock_sell
                .into_iter()
                .map(|instruction| (instruction, "ExecPairing"))
                .chain(
                    instructions
                        .into_iter()
                        .enumerate()
                        // Real Sell and Feed back behavior is covered by T13/T14.
                        .filter(|(index, _)| *index != 2 && *index != 3)
                        .map(|(_, instruction)| (instruction, "ExecPairing")),
                )
            {
                let before: Vec<_> = unchanged.iter().map(|key| env.account(*key)).collect();
                assert_error(env.send(&[instruction], &[]), expected_error);
                for (key, expected) in unchanged.iter().zip(before) {
                    assert_eq!(
                        env.account(*key),
                        expected,
                        "{key} changed after an instruction refusal"
                    );
                }
            }
            env.binder(owner, &[], 0, 0);
            for instruction in [
                anchor_instruction(
                    onepercent::instruction::WithdrawOwed {},
                    onepercent::accounts::WithdrawOwed { owner, binder },
                ),
                anchor_instruction(
                    onepercent::instruction::CloseBinder {},
                    onepercent::accounts::CloseBinder { owner, binder },
                ),
            ] {
                env.send(&[instruction], &[]).unwrap();
            }
        }
    }
}

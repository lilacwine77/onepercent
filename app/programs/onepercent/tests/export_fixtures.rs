mod common;
#[path = "common/launch_cases.rs"]
mod launch_cases;
#[path = "common/mycards.rs"]
mod mycards;
#[path = "common/reference.rs"]
mod reference;
#[path = "common/specials_cases.rs"]
mod specials;
use anchor_lang::__private::base64::{engine::general_purpose::STANDARD, Engine};
use common::{pack_cases::*, *};
use serde_json::json;
use solana_signer::Signer;
use std::path::PathBuf;

/// Runtime-generated test signers and state. The destination must be ignored target/ or temporary.
#[test]
fn export_fixtures() {
    let Ok(directory) = std::env::var("FIXTURE_DIR") else {
        return;
    };
    if std::env::var("FIXTURE_FLOW").as_deref() == Ok("exec") {
        return;
    }
    let directory = PathBuf::from(directory);
    std::fs::create_dir_all(&directory).unwrap();
    let flow = std::env::var("FIXTURE_FLOW").unwrap_or_else(|_| "rip".into());
    let now: i64 = std::env::var("FIXTURE_NOW")
        .unwrap_or_else(|_| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
                .to_string()
        })
        .parse()
        .unwrap();
    let (mut e, buyer, launch_bag) = if flow == "power-on" {
        let (mut env, bag) = launch_cases::setup();
        let buyer = env.user();
        (env, buyer, Some(bag))
    } else {
        let (env, buyer, _, _) = setup(false);
        (env, buyer, None)
    };
    // The property harness varies rent; validator fixtures must use its genesis default.
    let validator_rent = solana_rent::Rent::default();
    e.set_rent(validator_rent.lamports_per_byte);
    let deck_len: u32 = std::env::var("FIXTURE_DECK_LEN")
        .unwrap_or_else(|_| "100".into())
        .parse()
        .unwrap();
    assert!([100, 120_000].contains(&deck_len));
    if deck_len != 100 {
        e.inject_deck(deck_len);
    }
    let extra_count: usize = std::env::var("FIXTURE_EXTRA_BUYERS")
        .unwrap_or_else(|_| "0".into())
        .parse()
        .unwrap();
    assert!(extra_count <= 32);
    let extra_buyers: Vec<_> = (0..extra_count).map(|_| e.user()).collect();
    let existing: Vec<_> = e.tracked.iter().copied().collect();
    for at in existing {
        let Some(mut account) = e.svm.get_account(&addr(&at)) else {
            continue;
        };
        if account.lamports == 0
            || account.executable
            || at == e.program_data
            || account.owner == addr(&anchor_lang::solana_program::sysvar::ID)
        {
            continue;
        }
        account.lamports = account
            .lamports
            .max(validator_rent.minimum_balance(account.data.len()));
        e.put(at, account);
    }
    // All stored timestamps are relative to the actual validator launch.
    let delta = now - e.now();
    e.warp(delta);
    e.mutate(e.config, |a| {
        for off in [712, 720] {
            let ts = read_u64(&a.data, off) as i64;
            write_u64(&mut a.data, off, (ts + delta) as u64)
        }
    });
    e.inject_phase(if flow == "feed" || flow == "power-on" {
        1
    } else {
        3
    });
    let season_mint = if flow == "season" {
        let bag = specials::inject(
            &mut e,
            [0; 4],
            50_000_000_000,
            onepercent::params::PACK_EDITIONS_PRICE_LAMPORTS[0]
                * u64::from(onepercent::params::JACKPOT_MIN_POT_PRICE_MULTIPLE),
        );
        Some(bag.mint.to_string())
    } else {
        None
    };
    if flow == "season-closed" {
        specials::machine(&mut e, |m| {
            m.phase = 3;
            m.end_ts = now - 1;
        });
    }
    if flow == "power-on" {
        // launch_cases starts empty; the existing export manifest records this Deck.
        assert_eq!(
            e.state::<onepercent::state::Machine>(e.machine).power_on_ts,
            0
        );
    }
    let depositor = e.user();
    let who = pubkey(&depositor.pubkey());
    let feed = if flow == "feed" {
        // Feed fixtures have an empty Deck; remove the stock test's preloaded claims.
        let h = e.state::<onepercent::state::Deck>(e.deck);
        let old = e.account(e.deck);
        let mint = read_key(&old.data, 64 + 32);
        let ledger = pda(&[b"ledger", mint.as_ref()]).0;
        e.mutate(ledger, |a| write_u64(&mut a.data, 72, 0));
        let mut h = h;
        h.len = 0;
        h.cap = 0;
        h.total_fed = 0;
        e.set_state(e.deck, &h, &[], 0);
        let bag = e.new_pump_mint(false);
        e.token_account(who, &bag, 1000);
        e.mutate(bag.mint, |a| write_u64(&mut a.data, 36, 1000));
        Some(
            json!({"mint":bag.mint.to_string(),"source":ata(&who,&bag.mint,&bag.token_program).to_string(),"amount":"1000","decimals":bag.decimals,"tokenProgram":bag.token_program.to_string(),"vaultExists":false}),
        )
    } else {
        None
    };
    let pull = if flow == "refund" {
        let (p, _) = e.buy(&buyer, 0, 1).unwrap();
        e.mutate(p, |a| write_u64(&mut a.data, 112, (now - 301) as u64));
        Some(p.to_string())
    } else {
        None
    };
    let mut settle_pulls = Vec::new();
    if flow == "settle-closed" {
        let who = pubkey(&buyer.pubkey());
        let referrer = pubkey(&e.user().pubkey());
        let buyer_binder = e.binder(who, &[], 0, 0);
        e.mutate(buyer_binder, |a| write_key(&mut a.data, 40, &referrer));
        // One single-pack transaction, then two independently closing Pulls.
        // No depositor Binder is exported: each valid PDA is System-owned/empty.
        for _ in 0..3 {
            let (pull, _) = e.buy(&buyer, 0, 1).unwrap();
            e.fulfill(pull, [1; 32]).unwrap();
            for slot in 0..4 {
                let depositor = pubkey(&e.user().pubkey());
                e.mutate(pull, |a| {
                    write_key(&mut a.data, 176 + slot * 48, &depositor);
                    a.data[176 + 196] = 15;
                });
            }
            settle_pulls.push(pull.to_string());
        }
    }
    if flow == "sellback" {
        seed_mycards_fixture(&mut e, &buyer);
    }
    let mut programs = Vec::new();
    for (name, at) in [
        ("token", token()),
        ("token2022", token2022()),
        ("ata", anchor_spl::associated_token::ID),
        ("memo", key("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")),
    ] {
        let a = e.account(at);
        let bytes = if a.data.starts_with(b"\x7fELF") {
            a.data
        } else {
            assert_eq!(read_u32(&a.data, 0), 2);
            let pd = read_key(&a.data, 4);
            e.account(pd).data[45..].to_vec()
        };
        assert!(bytes.starts_with(b"\x7fELF"));
        let file = format!("{name}.so");
        std::fs::write(directory.join(&file), bytes).unwrap();
        programs.push(json!({"address":at.to_string(),"file":file}));
    }
    let mut accounts = Vec::new();
    for at in e.tracked.iter().copied() {
        if at == onepercent::ID || at == e.program_data || at == vrf() {
            continue;
        }
        let Some(a) = e.svm.get_account(&addr(&at)) else {
            continue;
        };
        if a.lamports == 0
            || a.executable
            || a.owner == addr(&anchor_lang::solana_program::sysvar::ID)
        {
            continue;
        }
        let file = format!("{at}.json");
        let value = json!({"pubkey":at.to_string(),"account":{"lamports":a.lamports,"data":[STANDARD.encode(&a.data),"base64"],"owner":a.owner.to_string(),"executable":a.executable,"rentEpoch":a.rent_epoch,"space":a.data.len()}});
        std::fs::write(
            directory.join(&file),
            serde_json::to_vec_pretty(&value).unwrap(),
        )
        .unwrap();
        accounts.push(json!({"address":at.to_string(),"file":file}));
    }
    let wallet = |k: &solana_keypair::Keypair| json!({"publicKey":k.pubkey().to_string(),"secretKey":k.to_bytes().to_vec()});
    let manifest = json!({"scenario":flow,"baseTime":now,"queue":e.queue.to_string(),"deckLen":e.state::<onepercent::state::Deck>(e.deck).len,"buyers":extra_buyers.iter().map(wallet).collect::<Vec<_>>(),"programs":programs,"accounts":accounts,"wallets":{"buyer":wallet(&buyer),"depositor":wallet(&depositor),"intake":wallet(&e.intake),"payer":wallet(&e.authority)},"pull":pull,"settlePulls":settle_pulls,"feed":feed,"launchMint":launch_bag.map(|b| b.mint.to_string()),"seasonMint":season_mint});
    let path = directory.join("manifest.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    println!("Exported {} fixture accounts for {flow}", e.tracked.len());
}

#[test]
fn export_exec_fixtures() {
    if std::env::var("FIXTURE_FLOW").as_deref() != Ok("exec") {
        return;
    }
    let Ok(directory) = std::env::var("FIXTURE_DIR") else {
        return;
    };
    let directory = PathBuf::from(directory);
    std::fs::create_dir_all(&directory).unwrap();
    let now: i64 = std::env::var("FIXTURE_NOW")
        .unwrap_or_else(|_| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
                .to_string()
        })
        .parse()
        .unwrap();
    let mut fixture = common::exec_cases::ExecFixture::new(1, 2, false, false);
    let buy_amount = 1_000_000_000;
    let (_, buy_delta) = common::exec_cases::expected(&fixture, buy_amount);
    let sell_amount = buy_delta;
    fixture.kind = 2;
    let (_, sell_delta) = common::exec_cases::expected(&fixture, sell_amount);
    fixture.kind = 1;
    let mint_signer = solana_keypair::Keypair::new();
    let launch_mint = pubkey(&mint_signer.pubkey());
    let signer_key = pubkey(&fixture.signer.pubkey());
    let e = &mut fixture.e;
    let guards = std::env::var("FIXTURE_GUARDS").as_deref() == Ok("1");
    if guards {
        e.inject_deck(100);
        let anchor = e.new_pump_mint(false);
        e.seed_bucket(1, &anchor, 1, 1_000_000_000_000, 300_000_000_000);
    }
    common::exec_cases::config(e, |config| config.token_mint = launch_mint);
    common::exec_cases::machine(e, |machine| machine.token_mint = launch_mint);
    e.set_state(
        pda(&[b"ledger", launch_mint.as_ref()]).0,
        &onepercent::state::MintLedger {
            mint: launch_mint,
            payer: signer_key,
            accounted: 0,
        },
        &[],
        0,
    );
    let rent = solana_rent::Rent::default();
    e.set_rent(rent.lamports_per_byte);
    let delta = now - e.now();
    e.warp(delta);
    e.inject_phase(3);
    common::exec_cases::machine(e, |m| {
        if guards {
            m.stock_sol = 5_000_000_000;
            m.sb_paid_hour = 5_000_000_000;
            m.bucket_history[0].listed_ts = now - onepercent::params::HIT_LIST_TRENDING_NOTICE_SECONDS + 120;
        }
        m.hour_index = now as u64 / 3600;
        m.stock_hour_index = m.hour_index;
        m.buckets[0].trend_hour_index = u32::try_from(m.hour_index).unwrap_or(u32::MAX);
    });
    let mut programs = Vec::new();
    for (name, at) in [
        ("token", token()),
        ("token2022", token2022()),
        ("ata", anchor_spl::associated_token::ID),
        ("memo", key("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")),
    ] {
        let account = e.account(at);
        let bytes = if account.data.starts_with(b"\x7fELF") {
            account.data
        } else {
            e.account(read_key(&account.data, 4)).data[45..].to_vec()
        };
        let file = format!("{name}.so");
        std::fs::write(directory.join(&file), bytes).unwrap();
        programs.push(json!({"address":at.to_string(),"file":file}));
    }
    let mut accounts = Vec::new();
    for at in e.tracked.iter().copied() {
        if [onepercent::ID, e.program_data, vrf()].contains(&at) {
            continue;
        }
        let Some(mut account) = e.svm.get_account(&addr(&at)) else {
            continue;
        };
        if account.lamports == 0
            || account.executable
            || account.owner == addr(&anchor_lang::solana_program::sysvar::ID)
        {
            continue;
        }
        account.lamports = account
            .lamports
            .max(rent.minimum_balance(account.data.len()));
        if account.data.len() == 165 && read_key(&account.data, 0) == onepercent::params::WSOL_MINT
        {
            let amount = read_u64(&account.data, 64);
            let minimum = rent.minimum_balance(165);
            write_u64(&mut account.data, 113, minimum);
            account.lamports = amount + minimum;
        }
        let file = format!("{at}.json");
        let value = json!({"pubkey":at.to_string(),"account":{"lamports":account.lamports,"data":[STANDARD.encode(&account.data),"base64"],"owner":account.owner.to_string(),"executable":false,"rentEpoch":account.rent_epoch,"space":account.data.len()}});
        std::fs::write(
            directory.join(&file),
            serde_json::to_vec_pretty(&value).unwrap(),
        )
        .unwrap();
        accounts.push(json!({"address":at.to_string(),"file":file}));
    }
    let wallet = |k: &solana_keypair::Keypair| json!({"publicKey":k.pubkey().to_string(),"secretKey":k.to_bytes().to_vec()});
    let manifest = json!({"scenario":"exec","baseTime":now,"queue":e.queue.to_string(),"deckLen":0,"buyers":[],"programs":programs,"accounts":accounts,"wallets":{"buyer":wallet(&fixture.signer),"depositor":wallet(&fixture.market),"intake":wallet(&e.intake),"payer":wallet(&e.authority)},"pull":null,"settlePulls":[],"feed":null,"exec":{"guards":guards,"mintSigner":wallet(&mint_signer),"signer":wallet(&fixture.signer),"market":wallet(&fixture.market),"mint":fixture.bag.mint.to_string(),"tokenProgram":fixture.bag.token_program.to_string(),"decimals":fixture.bag.decimals,"oracles":fixture.oracles.map(|a|a.to_string()),"marketToken":fixture.market_token.to_string(),"marketNative":fixture.market_native.to_string(),"buyAmount":buy_amount.to_string(),"buyDelta":buy_delta.to_string(),"sellAmount":sell_amount.to_string(),"sellDelta":sell_delta.to_string()}});
    let path = directory.join("manifest.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    println!("Exported {} fixture accounts for exec", accounts.len());
}

/// Local-only P2 state: every card kind, two full eight-card batches, and accrued SOL.
fn seed_mycards_fixture(e: &mut Env, buyer: &solana_keypair::Keypair) {
    use bytemuck::Zeroable;
    use onepercent::{params, state::*};
    let owner = pubkey(&buyer.pubkey());
    let bag = e.new_pump_mint(false);
    let cards: Vec<Card> = (0..25)
        .map(|index| {
            let kind = if index < 9 {
                index as u8
            } else if index < 17 {
                ((index - 9) % 5) as u8
            } else {
                (1 + (index - 17) % 4) as u8
            };
            let mut card = Card::zeroed();
            card.mint = bag.mint;
            card.amount = 1000;
            card.kind = kind;
            if (1..=4).contains(&kind) {
                card.value = params::PACK_EDITIONS_PRICE_LAMPORTS[0]
                    * u64::from(params::HIT_TIERS_VALUE_BPS[usize::from(kind - 1)])
                    / u64::from(params::BPS_DENOMINATOR);
            }
            card
        })
        .collect();
    let binder = e.binder(owner, &cards, 0, cards.len() as u16);
    mycards::edit::<Binder>(e, binder, |b| b.sol_owed = 100_000);
    e.mutate(binder, |a| a.lamports += 100_000);
    e.seed_bucket(1, &bag, 1, 1_000_000, 1_000_000_000);
    let total = 1_000_000 + cards.iter().map(|card| card.amount).sum::<u64>();
    let vault = ata(&e.vault_auth, &bag.mint, &bag.token_program);
    e.mutate(vault, |a| write_u64(&mut a.data, 64, total));
    e.mutate(bag.mint, |a| write_u64(&mut a.data, 36, total));
    mycards::edit::<MintLedger>(e, pda(&[b"ledger", bag.mint.as_ref()]).0, |l| {
        l.accounted = total
    });
    let signer = pubkey(&e.intake.pubkey());
    mycards::edit::<Config>(e, e.config, |c| c.quote_signer = signer);
    let now = e.now();
    mycards::edit::<Machine>(e, e.machine, |m| {
        m.stock_sol = params::STOCK_TARGET_BASE_LAMPORTS;
        m.sol_at_hour_start = m.stock_sol;
        m.hour_index = now.max(0) as u64 / 3600;
        m.end_ts = now + 100_000;
    });
    mycards::fund_machine(e);
}

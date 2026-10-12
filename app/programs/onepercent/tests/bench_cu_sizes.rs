mod common;
#[path = "common/intake_cases.rs"]
mod intake_cases;
use common::{pack_cases::*, *};
use serde_json::json;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_instruction::Instruction;
use solana_signer::Signer;
fn budget() -> Vec<Instruction> {
    vec![
        ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
        ComputeBudgetInstruction::set_compute_unit_price(1),
    ]
}
fn measured(e: &mut Env, ixs: Vec<Instruction>, signers: &[&solana_keypair::Keypair]) -> u64 {
    let mut all = budget();
    all.extend(ixs);
    e.send(&all, signers).unwrap().compute_units_consumed
}
fn limit(c: u64) -> u64 {
    (c * 125).div_ceil(100_000) * 1000
}
fn measure_corpus(corpus: &str) -> serde_json::Value {
    Env::deterministic_bench_signers(20261008);
    let mut feeds = Vec::new();
    for n in 1..=6 {
        let mut max = 0;
        for t22 in [false, true].into_iter().cycle().take(64) {
            let mut e = Env::new();
            let u = e.user();
            let who = pubkey(&u.pubkey());
            let bags: Vec<_> = (0..n)
                .map(|_| {
                    let b = if t22 {
                        intake_cases::metadata_bag(&mut e)
                    } else {
                        e.new_pump_mint(false)
                    };
                    e.token_account(who, &b, 1000);
                    b
                })
                .collect();
            let refs: Vec<_> = bags.iter().map(|b| (b, 1000)).collect();
            let mut ixs = e.feed_ixs(who, &refs, 0);
            *ixs.last_mut().unwrap().data.last_mut().unwrap() = 2;
            for b in &bags {
                ixs.push(intake_cases::close_user_ix(who, b));
            }
            let cu = measured(&mut e, ixs, &[&u]);
            println!("feed n={n} token2022={t22}: {cu}");
            max = max.max(cu);
        }
        feeds.push(max);
    }
    let mut take = 0;
    for t22 in [false, true].into_iter().cycle().take(64) {
        let mut e = Env::new();
        let bag = if t22 {
            intake_cases::metadata_bag(&mut e)
        } else {
            e.new_pump_mint(false)
        };
        let u = e.user_with_bag(&bag, 1000);
        let who = pubkey(&u.pubkey());
        e.feed(&u, &bag, 1000, 0).unwrap();
        e.send(&[intake_cases::close_user_ix(who, &bag)], &[&u])
            .unwrap();
        let i = e.take_back_ix(who, &bag, 0, 1000);
        let create = e.create_ata_ix(who, &bag, who);
        take = take.max(measured(&mut e, vec![create, i], &[&u]));
    }
    let mut buys = [0u64; 2];
    let mut details = Vec::new();
    for count in [100, 120000].into_iter().cycle().take(64) {
        for (edition, qty) in [(0, 1), (0, 10), (3, 5)] {
            let (mut e, u, _, _) = setup(false);
            if count != 100 {
                e.inject_deck(count);
            }
            let who = pubkey(&u.pubkey());
            let expiry = e.now() + 590;
            let mut msg = onepercent::params::ATTESTATIONS_HOLD_DOMAIN.to_vec();
            msg.extend_from_slice(onepercent::ID.as_ref());
            msg.extend_from_slice(who.as_ref());
            msg.extend_from_slice(&expiry.to_le_bytes());
            let mut buy = e.buy_ix(who, edition, qty, 0, None);
            buy.data.pop();
            buy.data.push(1);
            buy.data.extend_from_slice(&expiry.to_le_bytes());
            buy.data.push(2);
            let att = e.attest_ix(&msg);
            let cu = measured(&mut e, vec![att, buy], &[&u]);
            buys[usize::from(qty > 1)] = buys[usize::from(qty > 1)].max(cu);
            details.push(
                json!({"instruction":"buy","deck":count,"edition":edition,"qty":qty,"cu":cu}),
            );
        }
    }
    let mut settles = [0u64; 2];
    let settle_shapes: &[(u8, u8)] = if matches!(
        corpus,
        "sdk-expanded" | "g1-redirected" | "g1-closed-binders"
    ) {
        &[(1, 2), (1, 1), (2, 2), (2, 1)]
    } else {
        &[(1, 2), (2, 2)]
    };
    for &(n, pull_qty) in settle_shapes.iter().cycle().take(settle_shapes.len() * 32) {
        let (mut e, u, _, _) = setup(false);
        let who = pubkey(&u.pubkey());
        let referrer = e.user();
        let b = e.binder(who, &[], 0, 0);
        e.mutate(b, |a| {
            write_key(&mut a.data, 40, &pubkey(&referrer.pubkey()))
        });
        if corpus == "g1-redirected" {
            e.make_program(pubkey(&referrer.pubkey()));
        }
        let pull_count = if pull_qty == 1 { n } else { 1 };
        let mut ixs = Vec::new();
        let mut sequences = Vec::new();
        for _ in 0..pull_count {
            let (p, _) = e.buy(&u, 0, pull_qty).unwrap();
            e.fulfill(p, [1; 32]).unwrap();
            let royalty_packs = if corpus == "legacy-selected-payees" {
                n
            } else {
                pull_qty
            };
            for k in 0..usize::from(royalty_packs) {
                for slot in 0..4 {
                    let payee = e.user();
                    let at = pubkey(&payee.pubkey());
                    let b = e.binder(at, &[], 0, 0);
                    e.mutate(b, |a| write_u16(&mut a.data, 102, 1));
                    if corpus == "g1-closed-binders" {
                        // The valid empty PDA requires an on-chain address derivation.
                        // Four different FRESH depositors exercise all four checks.
                        e.fund(b, 0);
                    }
                    if corpus == "g1-redirected" {
                        e.make_program(at);
                    }
                    e.mutate(p, |a| {
                        write_key(&mut a.data, 176 + k * 200 + slot * 48, &at);
                        a.data[176 + k * 200 + 196] = 15;
                    });
                }
            }
            sequences.push(e.state::<onepercent::state::Pull>(p).seq);
            ixs.extend((0..n.min(pull_qty)).map(|k| e.settle_ix(p, k)));
        }
        // Match the SDK instruction order and Memo count. The fixture keeps its
        // real Pull sequences; these independent Memo payloads conservatively
        // measure the maximum 20-digit width without changing on-chain state.
        for (index, _) in sequences.iter().enumerate() {
            let mut data = onepercent::params::DRAW_TAGS_ROYALTY_MEMO_PREFIX.to_vec();
            data.extend_from_slice((u64::MAX - index as u64).to_string().as_bytes());
            ixs.push(Instruction {
                program_id: addr(&onepercent::params::PROGRAM_IDS_MEMO),
                accounts: vec![],
                data,
            });
        }
        let cu = measured(&mut e, ixs, &[]);
        settles[n as usize - 1] = settles[n as usize - 1].max(cu);
        details.push(json!({"instruction":"settle","packs":n,"pullQty":pull_qty,"memoCount":sequences.len(),"memoDigits":20,"memoMeasurement":"conservative full-width payload; Pull sequences unchanged","closedFreshBinders":if corpus == "g1-closed-binders" { 4 * n } else { 0 },"cu":cu}));
    }
    let (mut e, u, _, _) = setup(false);
    let (p, _) = e.buy(&u, 0, 10).unwrap();
    e.warp(300);
    let ix = e.refund_ix(p);
    let refund = measured(&mut e, vec![ix], &[]);
    let mut redeems = [0u64; 2];
    for n in [1, 8] {
        for t22 in [false, true].into_iter().cycle().take(64) {
            use bytemuck::Zeroable;
            let mut e = Env::new();
            let u = e.user();
            let who = pubkey(&u.pubkey());
            let mut bags = Vec::new();
            let mut cards = Vec::new();
            for _ in 0..n {
                let bag = if t22 {
                    intake_cases::metadata_bag(&mut e)
                } else {
                    e.new_pump_mint(false)
                };
                e.token_account(e.vault_auth, &bag, 1000);
                e.mutate(bag.mint, |a| write_u64(&mut a.data, 36, 1000));
                e.set_state(
                    pda(&[b"ledger", bag.mint.as_ref()]).0,
                    &onepercent::state::MintLedger {
                        mint: bag.mint,
                        payer: who,
                        accounted: 1000,
                    },
                    &[],
                    0,
                );
                let mut card = onepercent::state::Card::zeroed();
                card.mint = bag.mint;
                card.amount = 1000;
                cards.push(card);
                bags.push(bag);
            }
            e.binder(who, &cards, 0, n as u16);
            let mut ixs = Vec::new();
            for i in (0..n).rev() {
                ixs.push(e.create_ata_ix(who, &bags[i], who));
                ixs.push(e.redeem_ix(who, &bags[i], i as u16, 1000));
            }
            let cu = measured(&mut e, ixs, &[&u]);
            redeems[usize::from(n > 1)] = redeems[usize::from(n > 1)].max(cu);
        }
    }
    json!({"name":corpus,"fixtureSeed":20261008,"samplesPerVariant":32,"measured":{"feed":feeds,"takeBack":take,"buyPacks":buys,"settle":settles,"refundPull":refund,"redeem":redeems},"cases":details})
}

fn maximum(values: Vec<serde_json::Value>) -> serde_json::Value {
    match &values[0] {
        serde_json::Value::Number(_) => {
            json!(values.iter().map(|v| v.as_u64().unwrap()).max().unwrap())
        }
        serde_json::Value::Array(items) => json!((0..items.len())
            .map(|i| maximum(values.iter().map(|v| v[i].clone()).collect()))
            .collect::<Vec<_>>()),
        _ => unreachable!("measured CU values are numbers or arrays"),
    }
}

#[test]
fn bench_cu_sizes() {
    if let Ok(corpus) = std::env::var("M1_CU_CORPUS") {
        let report = measure_corpus(&corpus);
        std::fs::write(
            std::env::var_os("M1_CU_CORPUS_REPORT").unwrap(),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        return;
    }

    // Both signer seeds and Pubkey::new_unique counters start afresh per corpus.
    // Retain both historical Settle fixture shapes so adding SDK-shaped cases
    // cannot discard a previously measured expensive Redeem address sample.
    let mut corpora = Vec::new();
    for corpus in [
        "legacy-selected-payees",
        "legacy-all-payees",
        "sdk-expanded",
        "g1-redirected",
        "g1-closed-binders",
    ] {
        let path = std::env::temp_dir().join(format!(
            "onepercent-cu-{}-{corpus}.json",
            std::process::id()
        ));
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "bench_cu_sizes", "--nocapture"])
            .env("M1_CU_CORPUS", corpus)
            .env("M1_CU_CORPUS_REPORT", &path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "CU corpus {corpus} failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let report: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        std::fs::remove_file(path).unwrap();
        println!("{corpus}: {}", report["measured"]);
        corpora.push(report);
    }
    let measured: serde_json::Map<String, serde_json::Value> = corpora[0]["measured"]
        .as_object()
        .unwrap()
        .keys()
        .map(|key| {
            (
                key.clone(),
                maximum(corpora.iter().map(|c| c["measured"][key].clone()).collect()),
            )
        })
        .collect();
    let m = serde_json::Value::Object(measured);
    let limits = json!({"feed":m["feed"].as_array().unwrap().iter().map(|v| limit(v.as_u64().unwrap())).collect::<Vec<_>>(),"takeBack":limit(m["takeBack"].as_u64().unwrap()),"buyPacks":{"x1":limit(m["buyPacks"][0].as_u64().unwrap()),"x10":limit(m["buyPacks"][1].as_u64().unwrap())},"settle":m["settle"].as_array().unwrap().iter().map(|v| limit(v.as_u64().unwrap())).collect::<Vec<_>>(),"refundPull":limit(m["refundPull"].as_u64().unwrap()),"redeem":{"x1":limit(m["redeem"][0].as_u64().unwrap()),"x8":limit(m["redeem"][1].as_u64().unwrap())}});
    let report = json!({"runtime":"LiteSVM 0.16.0, sBPFv3, default feature set","fixtureSeed":20261008,"samplesPerVariant":32,"corpusIsolation":"fresh process per corpus; signer seed and unique-address counter reset","corpora":corpora,"measured":m,"limits":limits});
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/reports");
    if std::env::var_os("UPDATE_REPORT").is_some() {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("cu.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
    } else {
        let stored: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("cu.json")).unwrap()).unwrap();
        assert_eq!(
            report, stored,
            "CU report drift; remeasure and synchronize CU_LIMITS"
        );
    }
}

#[path = "common/launch_cases.rs"]
mod launch_cases;

fn m4_measure_corpus() -> serde_json::Value {
    use onepercent::{params, state::MintLedger};
    Env::deterministic_bench_signers(20261009);
    let mut cases = Vec::new();
    let mut power_max = 0;
    let mut collect_max = 0;
    let mut power_size = 0;
    let mut collect_size = 0;
    let mut claim_max = [0u64; 3];
    let mut chain_max = [0u64; 3];
    let mut claim_size = [0usize; 3];
    let mut chain_size = [0usize; 3];
    for sample in 0..32 {
        for ledger in ["new", "prefunded", "existing"] {
            for rate in [5080, 6960] {
                let (mut e, bag) = launch_cases::setup();
                let ledger_address = pda(&[b"ledger", bag.mint.as_ref()]).0;
                match ledger {
                    "prefunded" => e.donate_lamports(ledger_address, 1),
                    "existing" => e.set_state(
                        ledger_address,
                        &MintLedger {
                            mint: bag.mint,
                            payer: pubkey(&e.authority.pubkey()),
                            accounted: 0,
                        },
                        &[],
                        0,
                    ),
                    _ => (),
                }
                e.set_rent(rate);
                let instruction = launch_cases::power_ix(&e, &bag);
                let mut ixs = budget();
                ixs.push(instruction.clone());
                let size = 1
                    + 64
                    + solana_message::Message::new(&ixs, Some(&e.authority.pubkey()))
                        .serialize()
                        .len();
                let cu = measured(&mut e, vec![instruction], &[]);
                power_max = power_max.max(cu);
                power_size = power_size.max(size);
                cases.push(json!({"instruction":"powerOn","sample":sample,"ledger":ledger,"rentPerByte":rate,"cu":cu,"bytes":size}));
            }
        }
        for (phase, stock) in [
            (2, 0),
            (2, params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS),
            (3, 0),
            (3, params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS),
            (4, 0),
            (5, 0),
            (6, 0),
        ] {
            for native in [false, true] {
                let (mut e, bag) = launch_cases::setup();
                e.send(&[launch_cases::power_ix(&e, &bag)], &[]).unwrap();
                launch_cases::machine(&mut e, |m| {
                    m.phase = phase;
                    m.stock_sol = stock;
                });
                e.donate_lamports(e.machine, stock);
                e.donate_lamports(e.fee_in, 1_000_000_007);
                if native {
                    launch_cases::seed_fee_wsol(&mut e, 5_000_000);
                }
                let instruction = launch_cases::collect_ix(&e, pubkey(&e.authority.pubkey()));
                let mut ixs = budget();
                ixs.push(instruction.clone());
                let size = 1
                    + 64
                    + solana_message::Message::new(&ixs, Some(&e.authority.pubkey()))
                        .serialize()
                        .len();
                let cu = measured(&mut e, vec![instruction], &[]);
                collect_max = collect_max.max(cu);
                collect_size = collect_size.max(size);
                cases.push(json!({"instruction":"collectCreatorFees","sample":sample,"phase":phase,"stock":stock,"nativeWsol":native,"cu":cu,"bytes":size}));
            }
        }
    }
    for sample in 0..32 {
        for kind in 0..3usize {
            for existing in [false, true] {
                for chain in [false, true] {
                    let (mut env, instruction, mint) = if kind == 1 {
                        let case = common::launch_fee_cases::PoolClaimCase::new(
                            123,
                            1_000_000_007,
                            token2022(),
                        );
                        let instruction = case.claim();
                        (case.env, instruction, case.bag.mint)
                    } else {
                        let mut case = common::launch_fee_cases::DbcClaimCase::new(1_000_000_007);
                        if kind == 2 {
                            case.env.mutate(case.bag.curve, |a| {
                                write_u64(&mut a.data, 240, 1_000_000_007)
                            });
                        }
                        let instruction = case.claim(kind as u8);
                        (case.env, instruction, case.bag.mint)
                    };
                    if existing {
                        launch_cases::seed_fee_wsol(&mut env, 7);
                        if kind == 1 {
                            let bag = Bag {
                                mint,
                                token_program: token(),
                                curve: Default::default(),
                                decimals: 6,
                            };
                            env.token_account(env.fee_in, &bag, 11);
                        }
                    }
                    let mut instructions = vec![instruction];
                    if chain {
                        instructions.push(launch_cases::collect_ix(
                            &env,
                            pubkey(&env.authority.pubkey()),
                        ));
                    }
                    let mut transaction = budget();
                    transaction.extend(instructions.clone());
                    let bytes = 1
                        + 64
                        + solana_message::Message::new(&transaction, Some(&env.authority.pubkey()))
                            .serialize()
                            .len();
                    let cu = measured(&mut env, instructions, &[]);
                    if chain {
                        chain_max[kind] = chain_max[kind].max(cu);
                        chain_size[kind] = chain_size[kind].max(bytes);
                    } else {
                        claim_max[kind] = claim_max[kind].max(cu);
                        claim_size[kind] = claim_size[kind].max(bytes);
                    }
                    cases.push(json!({"instruction":if chain {"feeChainTx"} else {"claimLaunchFees"},"kind":(["curve","pool","surplus"][kind]),"sample":sample,"existingAtas":existing,"cu":cu,"bytes":bytes}));
                }
            }
        }
    }
    let claims = |values: [u64; 3]| json!({"curve":values[0],"pool":values[1],"surplus":values[2]});
    let sizes =
        |values: [usize; 3]| json!({"curve":values[0],"pool":values[1],"surplus":values[2]});
    json!({"runtime":"LiteSVM 0.16.0, sBPFv3, default feature set","fixtureSeed":20261009,"samplesPerVariant":32,"corpusIsolation":"fresh process; signer seed and unique-address counter reset","transactionShape":"two compute-budget instructions plus the SDK instruction","measured":{"powerOn":power_max,"collectCreatorFees":collect_max,"claimLaunchFees":claims(claim_max),"feeChainTx":claims(chain_max)},"transactionBytes":{"powerOn":power_size,"collectCreatorFees":collect_size,"claimLaunchFees":sizes(claim_size),"feeChainTx":sizes(chain_size)},"limits":{"powerOn":limit(power_max),"collectCreatorFees":limit(collect_max),"claimLaunchFees":claims(claim_max.map(limit)),"feeChainTx":claims(chain_max.map(limit))},"cases":cases})
}

#[test]
fn bench_m4_cu_sizes() {
    if let Some(path) = std::env::var_os("M4_CU_CORPUS_REPORT") {
        std::fs::write(
            path,
            serde_json::to_vec_pretty(&m4_measure_corpus()).unwrap(),
        )
        .unwrap();
        return;
    }
    let path = std::env::temp_dir().join(format!("onepercent-m4-cu-{}.json", std::process::id()));
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "bench_m4_cu_sizes", "--nocapture"])
        .env("M4_CU_CORPUS_REPORT", &path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "M4 CU corpus failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    std::fs::remove_file(path).unwrap();
    println!(
        "M4 CU: {} sizes: {} limits: {}",
        report["measured"], report["transactionBytes"], report["limits"]
    );
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/reports/m4-cu.json");
    if std::env::var_os("UPDATE_REPORT").is_some() {
        std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    } else {
        let stored: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(
            report, stored,
            "M4 CU report drift; remeasure and synchronize CU_LIMITS"
        );
    }
}

#![recursion_limit = "512"]
#[path = "golden/season.rs"]
mod season;
use anchor_lang::{prelude::Pubkey, InstructionData, ToAccountMetas};
use onepercent::{instructions::*, state::*, SellBackCard};
use serde_json::{json, Value};
use std::{
    fs,
    mem::{offset_of, size_of},
    path::PathBuf,
};
fn fixture(name: &str, value: Value) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/vectors")
        .join(format!("{name}.json"));
    let text = format!("{}\n", serde_json::to_string_pretty(&value).unwrap());
    if std::env::var("UPDATE_GOLDEN").as_deref() == Ok("1") {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    } else {
        assert_eq!(
            fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing {}", path.display())),
            text,
            "{name} drifted"
        );
    }
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn k(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}
#[test]
fn layouts() {
    let mut layouts = serde_json::Map::new();
    layouts.insert("MintLedger".into(),json!({"size":8+size_of::<MintLedger>(),"fields":{"discriminator":0,"mint":8+offset_of!(MintLedger,mint),"payer":8+offset_of!(MintLedger,payer),"accounted":8+offset_of!(MintLedger,accounted)}}));
    layouts.insert("Deck".into(),json!({"size":8+size_of::<Deck>(),"fields":{"discriminator":0,"len":8+offset_of!(Deck,len),"cap":8+offset_of!(Deck,cap),"header_rent":8+offset_of!(Deck,header_rent),"total_fed":8+offset_of!(Deck,total_fed),"total_pulled":8+offset_of!(Deck,total_pulled),"total_taken_back":8+offset_of!(Deck,total_taken_back),"bump":8+offset_of!(Deck,bump),"version":8+offset_of!(Deck,version),"_pad":8+offset_of!(Deck,_pad),"_reserved":8+offset_of!(Deck,_reserved)}}));
    layouts.insert("DeckEntry".into(),json!({"size":0+size_of::<DeckEntry>(),"fields":{"depositor":0+offset_of!(DeckEntry,depositor),"mint":0+offset_of!(DeckEntry,mint),"amount":0+offset_of!(DeckEntry,amount),"deposit":0+offset_of!(DeckEntry,deposit),"flags":0+offset_of!(DeckEntry,flags),"_pad":0+offset_of!(DeckEntry,_pad)}}));
    layouts.insert("Config".into(),json!({"size":8+size_of::<Config>(),"fields":{"discriminator":0,"admin":8+offset_of!(Config,admin),"guardians":8+offset_of!(Config,guardians),"keeper":8+offset_of!(Config,keeper),"executor":8+offset_of!(Config,executor),"intake_signer":8+offset_of!(Config,intake_signer),"quote_signer":8+offset_of!(Config,quote_signer),"launch_wallet":8+offset_of!(Config,launch_wallet),"team_wallet":8+offset_of!(Config,team_wallet),"team_wallets":8+offset_of!(Config,team_wallets),"token_mint":8+offset_of!(Config,token_mint),"vrf_queues":8+offset_of!(Config,vrf_queues),"snapshot_slot":8+offset_of!(Config,snapshot_slot),"snapshot_ts":8+offset_of!(Config,snapshot_ts),"stock_up_ts":8+offset_of!(Config,stock_up_ts),"version":8+offset_of!(Config,version),"bump":8+offset_of!(Config,bump),"active_queue":8+offset_of!(Config,active_queue),"season_set":8+offset_of!(Config,season_set),"admin_paused":8+offset_of!(Config,admin_paused),"guardian_paused":8+offset_of!(Config,guardian_paused),"disabled_roles":8+offset_of!(Config,disabled_roles),"_pad":8+offset_of!(Config,_pad),"vrf_program":8+offset_of!(Config,vrf_program),"_reserved":8+offset_of!(Config,_reserved)}}));
    layouts.insert("Pull".into(),json!({"size":8+size_of::<Pull>(),"fields":{"discriminator":0,"seq":8+offset_of!(Pull,seq),"buyer":8+offset_of!(Pull,buyer),"referrer":8+offset_of!(Pull,referrer),"randomness":8+offset_of!(Pull,randomness),"created_ts":8+offset_of!(Pull,created_ts),"revealed_ts":8+offset_of!(Pull,revealed_ts),"price":8+offset_of!(Pull,price),"buyer_nonce":8+offset_of!(Pull,buyer_nonce),"settled_mask":8+offset_of!(Pull,settled_mask),"edition":8+offset_of!(Pull,edition),"qty":8+offset_of!(Pull,qty),"status":8+offset_of!(Pull,status),"holder":8+offset_of!(Pull,holder),"bump":8+offset_of!(Pull,bump),"version":8+offset_of!(Pull,version),"live_flags":8+offset_of!(Pull,live_flags),"_pad":8+offset_of!(Pull,_pad),"_reserved":8+offset_of!(Pull,_reserved)}}));
    layouts.insert("Royalty".into(),json!({"size":0+size_of::<Royalty>(),"fields":{"depositor":0+offset_of!(Royalty,depositor),"lamports":0+offset_of!(Royalty,lamports),"refund":0+offset_of!(Royalty,refund)}}));
    layouts.insert("PackRecord".into(),json!({"size":0+size_of::<PackRecord>(),"fields":{"royalties":0+offset_of!(PackRecord,royalties),"backing":0+offset_of!(PackRecord,backing),"tier":0+offset_of!(PackRecord,tier),"carved_bucket":0+offset_of!(PackRecord,carved_bucket),"house_mask":0+offset_of!(PackRecord,house_mask),"fresh_mask":0+offset_of!(PackRecord,fresh_mask),"_pad":0+offset_of!(PackRecord,_pad)}}));
    layouts.insert("Binder".into(),json!({"size":8+size_of::<Binder>(),"fields":{"discriminator":0,"owner":8+offset_of!(Binder,owner),"referrer":8+offset_of!(Binder,referrer),"season_spend":8+offset_of!(Binder,season_spend),"sol_owed":8+offset_of!(Binder,sol_owed),"feed_nonce_base":8+offset_of!(Binder,feed_nonce_base),"sb_nonce":8+offset_of!(Binder,sb_nonce),"pull_nonce":8+offset_of!(Binder,pull_nonce),"feed_nonce_bits":8+offset_of!(Binder,feed_nonce_bits),"fresh_in_deck":8+offset_of!(Binder,fresh_in_deck),"len":8+offset_of!(Binder,len),"cap":8+offset_of!(Binder,cap),"reserved":8+offset_of!(Binder,reserved),"bump":8+offset_of!(Binder,bump),"flags":8+offset_of!(Binder,flags)}}));
    layouts.insert("Card".into(),json!({"size":0+size_of::<Card>(),"fields":{"mint":0+offset_of!(Card,mint),"amount":0+offset_of!(Card,amount),"value":0+offset_of!(Card,value),"kind":0+offset_of!(Card,kind),"edition":0+offset_of!(Card,edition),"flags":0+offset_of!(Card,flags),"_pad":0+offset_of!(Card,_pad),"seq_lo":0+offset_of!(Card,seq_lo)}}));
    layouts.insert("Bucket".into(),json!({"size":0+size_of::<Bucket>(),"fields":{"mint":0+offset_of!(Bucket,mint),"oracle":0+offset_of!(Bucket,oracle),"amount":0+offset_of!(Bucket,amount),"cost":0+offset_of!(Bucket,cost),"reserved":0+offset_of!(Bucket,reserved),"cap":0+offset_of!(Bucket,cap),"trend_bought_hour":0+offset_of!(Bucket,trend_bought_hour),"trend_hour_index":0+offset_of!(Bucket,trend_hour_index),"decimals":0+offset_of!(Bucket,decimals),"class":0+offset_of!(Bucket,class),"enabled":0+offset_of!(Bucket,enabled),"token_program":0+offset_of!(Bucket,token_program),"final_pool":0+offset_of!(Bucket,final_pool),"trend_sold_hour":0+offset_of!(Bucket,trend_sold_hour)}}));
    layouts.insert("OnePctSlot".into(),json!({"size":0+size_of::<OnePctSlot>(),"fields":{"amount":0+offset_of!(OnePctSlot,amount),"state":0+offset_of!(OnePctSlot,state),"_pad":0+offset_of!(OnePctSlot,_pad)}}));
    layouts.insert("SpotlightSlot".into(),json!({"size":0+size_of::<SpotlightSlot>(),"fields":{"mint":0+offset_of!(SpotlightSlot,mint),"sponsor":0+offset_of!(SpotlightSlot,sponsor),"window_start":0+offset_of!(SpotlightSlot,window_start),"amount":0+offset_of!(SpotlightSlot,amount),"state":0+offset_of!(SpotlightSlot,state),"_pad":0+offset_of!(SpotlightSlot,_pad)}}));
    layouts.insert("ExecRecord".into(),json!({"size":0+size_of::<ExecRecord>(),"fields":{"kind":0+offset_of!(ExecRecord,kind),"bucket":0+offset_of!(ExecRecord,bucket),"_pad":0+offset_of!(ExecRecord,_pad),"amount":0+offset_of!(ExecRecord,amount),"v0":0+offset_of!(ExecRecord,v0),"min_out":0+offset_of!(ExecRecord,min_out),"slot":0+offset_of!(ExecRecord,slot),"target":0+offset_of!(ExecRecord,target),"aux":0+offset_of!(ExecRecord,aux)}}));
    layouts.insert("Machine".into(),json!({"size":8+size_of::<Machine>(),"fields":{"discriminator":0,"version":8+offset_of!(Machine,version),"bump":8+offset_of!(Machine,bump),"phase":8+offset_of!(Machine,phase),"vault_auth_bump":8+offset_of!(Machine,vault_auth_bump),"deck_bump":8+offset_of!(Machine,deck_bump),"config_bump":8+offset_of!(Machine,config_bump),"fee_in_bump":8+offset_of!(Machine,fee_in_bump),"_pad0":8+offset_of!(Machine,_pad0),"next_seq":8+offset_of!(Machine,next_seq),"pending_pulls":8+offset_of!(Machine,pending_pulls),"reserved_dust":8+offset_of!(Machine,reserved_dust),"power_on_ts":8+offset_of!(Machine,power_on_ts),"on_air_ts":8+offset_of!(Machine,on_air_ts),"end_ts":8+offset_of!(Machine,end_ts),"final_ts":8+offset_of!(Machine,final_ts),"stock_sol":8+offset_of!(Machine,stock_sol),"jackpot_sol":8+offset_of!(Machine,jackpot_sol),"burn_sol":8+offset_of!(Machine,burn_sol),"team_sol":8+offset_of!(Machine,team_sol),"final_pool_sol":8+offset_of!(Machine,final_pool_sol),"total_spend":8+offset_of!(Machine,total_spend),"hour_index":8+offset_of!(Machine,hour_index),"hit_out_this_hour":8+offset_of!(Machine,hit_out_this_hour),"hit_out_last_hour":8+offset_of!(Machine,hit_out_last_hour),"sb_paid_hour":8+offset_of!(Machine,sb_paid_hour),"sol_at_hour_start":8+offset_of!(Machine,sol_at_hour_start),"packs_revealed":8+offset_of!(Machine,packs_revealed),"hit_value_out":8+offset_of!(Machine,hit_value_out),"buckets":8+offset_of!(Machine,buckets),"jackpot_tokens":8+offset_of!(Machine,jackpot_tokens),"jackpot_cost":8+offset_of!(Machine,jackpot_cost),"burned_total":8+offset_of!(Machine,burned_total),"last_burn_ts":8+offset_of!(Machine,last_burn_ts),"burn_hour_index":8+offset_of!(Machine,burn_hour_index),"burn_paid_hour":8+offset_of!(Machine,burn_paid_hour),"last_jackpot_buy_ts":8+offset_of!(Machine,last_jackpot_buy_ts),"final_pool_1pct":8+offset_of!(Machine,final_pool_1pct),"onepct":8+offset_of!(Machine,onepct),"spotlight":8+offset_of!(Machine,spotlight),"exec":8+offset_of!(Machine,exec),"last_stock_trade_ts":8+offset_of!(Machine,last_stock_trade_ts),"stock_hour_index":8+offset_of!(Machine,stock_hour_index),"stock_bought_hour":8+offset_of!(Machine,stock_bought_hour),"stock_sold_hour":8+offset_of!(Machine,stock_sold_hour),"token_mint":8+offset_of!(Machine,token_mint),"final_sol_total":8+offset_of!(Machine,final_sol_total),"final_1pct_total":8+offset_of!(Machine,final_1pct_total),"last_reveal_ts":8+offset_of!(Machine,last_reveal_ts),"sb_paid_prev_hour":8+offset_of!(Machine,sb_paid_prev_hour),"keeper_history_version":8+offset_of!(Machine,keeper_history_version),"keeper_history_started_ts":8+offset_of!(Machine,keeper_history_started_ts),"bucket_history":8+offset_of!(Machine,bucket_history),"unsettled_reveals":8+offset_of!(Machine,unsettled_reveals),"_reserved0":8+offset_of!(Machine,_reserved0),"_reserved1":8+offset_of!(Machine,_reserved1)}}));
    layouts.insert(
        "BucketHistory".into(),
        json!({"size":size_of::<BucketHistory>(),"fields":{
        "listed_ts":offset_of!(BucketHistory,listed_ts),
        "sb_inflow_hour":offset_of!(BucketHistory,sb_inflow_hour),
        "sb_inflow_prev_hour":offset_of!(BucketHistory,sb_inflow_prev_hour)}}),
    );
    fixture("layouts", Value::Object(layouts));
}
#[test]
fn pdas() {
    let program = onepercent::ID;
    let wallet = k(1);
    let mint = k(2);
    let nonce = 7u32;
    let mut output = vec![];
    for (name, seeds, args) in [
        ("config", vec![b"config".as_slice()], json!([])),
        ("machine", vec![b"machine".as_slice()], json!([])),
        ("deck", vec![b"deck".as_slice()], json!([])),
        ("vault_auth", vec![b"vault_auth".as_slice()], json!([])),
        ("fee_in", vec![b"fee_in".as_slice()], json!([])),
        (
            "binder",
            vec![b"binder".as_slice(), wallet.as_ref()],
            json!([wallet.to_string()]),
        ),
        (
            "ledger",
            vec![b"ledger".as_slice(), mint.as_ref()],
            json!([mint.to_string()]),
        ),
        ("program_identity", vec![b"identity".as_slice()], json!([])),
    ] {
        let (address, bump) = Pubkey::find_program_address(&seeds, &program);
        output.push(json!({"name":name,"args":args,"address":address.to_string(),"bump":bump}));
    }
    let (address, bump) =
        Pubkey::find_program_address(&[b"pull", wallet.as_ref(), &nonce.to_le_bytes()], &program);
    output.push(json!({"name":"pull","args":[wallet.to_string(),nonce],"address":address.to_string(),"bump":bump}));
    let (address, bump) = Pubkey::find_program_address(
        &[b"identity", program.as_ref()],
        &onepercent::params::PROGRAM_IDS_MAGICBLOCK_VRF,
    );
    output.push(
        json!({"name":"scopedVrfIdentity","args":[],"address":address.to_string(),"bump":bump}),
    );
    for token in [anchor_spl::token::ID, anchor_spl::token_2022::ID] {
        let auth = Pubkey::find_program_address(&[b"vault_auth"], &program).0;
        let address = anchor_spl::associated_token::get_associated_token_address_with_program_id(
            &auth, &mint, &token,
        );
        output.push(json!({"name":"vault","args":[mint.to_string(),token.to_string()],"address":address.to_string()}));
    }
    let (address, bump) = Pubkey::find_program_address(
        &[b"bonding-curve", mint.as_ref()],
        &onepercent::params::PROGRAM_IDS_PUMP_FUN,
    );
    output.push(json!({"name":"bonding_curve","args":[mint.to_string()],"address":address.to_string(),"bump":bump}));
    for mint in [k(2), k(255)] {
        let config = k(29);
        let quote = onepercent::params::WSOL_MINT;
        let (maximum, minimum) = if mint > quote {
            (mint, quote)
        } else {
            (quote, mint)
        };
        let (address, bump) = Pubkey::find_program_address(
            &[b"pool", config.as_ref(), maximum.as_ref(), minimum.as_ref()],
            &onepercent::params::PROGRAM_IDS_METEORA_DBC,
        );
        assert_eq!(
            address,
            onepercent::checks::dbc_pool_address(&mint, &config)
        );
        output.push(json!({"name":"dbcPoolPda","args":[mint.to_string(),config.to_string()],"address":address.to_string(),"bump":bump}));
    }
    fixture("pdas", json!(output));
}
#[test]
fn attestations() {
    let mut output = vec![];
    for i in 0..20u8 {
        let wallet = k(i + 1);
        let expiry = 1_800_000_000 + i64::from(i);
        let nonce = u32::from(i) * 193;
        let bags: Vec<_> = (0..i % 6 + 1)
            .map(|j| (k(j + 31), u64::from(i) * 1000 + u64::from(j) + 1))
            .collect();
        let message =
            onepercent::checks::ed25519::feed_message(&wallet, nonce, expiry, &bags).unwrap();
        let mut body = vec![];
        for (mint, amount) in &bags {
            body.extend_from_slice(mint.as_ref());
            body.extend_from_slice(&amount.to_le_bytes());
        }
        output.push(json!({"kind":"feed","programId":onepercent::ID.to_string(),"wallet":wallet.to_string(),"nonce":nonce,"expiry":expiry.to_string(),"bags":bags.iter().map(|(mint,amount)|json!({"mint":mint.to_string(),"amount":amount.to_string()})).collect::<Vec<_>>(),"message":hex(&message),"bagsHash":hex(solana_sha256_hasher::hash(&body).as_ref())}));
        output.push(json!({"kind":"hold","programId":onepercent::ID.to_string(),"wallet":wallet.to_string(),"expiry":expiry.to_string(),"message":hex(&onepercent::checks::ed25519::hold_message(&wallet,expiry))}));
    }
    for i in 0..20u16 {
        let count = if i == 0 {
            1
        } else if i == 1 {
            8
        } else {
            i % 8 + 1
        };
        let cards: Vec<SellBackCard> = (0..count)
            .map(|j| SellBackCard {
                index: if i == 0 {
                    3
                } else if i == 1 {
                    7 - j
                } else {
                    u16::MAX - j
                },
                amount: if i >= 18 {
                    u64::MAX / u64::from(count)
                } else if i == 1 {
                    1000 + u64::from(j)
                } else {
                    1000 + u64::from(i) + u64::from(j)
                },
            })
            .collect();
        let program = if i < 2 { k(0) } else { k(3) };
        let expiry = if i == 18 {
            i64::MIN
        } else if i == 19 {
            i64::MAX
        } else {
            1_800_000_000
        };
        let nonce = if i >= 18 {
            u32::MAX
        } else if i == 1 {
            7
        } else {
            u32::from(i) * 193
        };
        let quote = if i >= 18 { u64::MAX } else { 5_000_000 };
        let row = sb_sample(program, cards, quote, expiry, nonce);
        if i < 2 {
            assert_eq!(
                row["sha256"],
                [
                    "edf53101d7a0071b005cdae28d29e6ddbe17c9e9ab59d57efa7df9455d8b501c",
                    "53fec985a265aeaa8eeeecc3d254da20f4d224c6c9cb3d63c87c4ca439676c76",
                ][usize::from(i)]
            );
        }
        output.push(row);
    }
    fixture("attest", json!(output));
}

fn sb_sample(
    program: Pubkey,
    cards: Vec<SellBackCard>,
    quote: u64,
    expiry: i64,
    nonce: u32,
) -> Value {
    let owner = k(1);
    let mint = k(2);
    let total: u64 = cards.iter().map(|card| card.amount).sum();
    let mut message = onepercent::params::ATTESTATIONS_SELL_BACK_DOMAIN.to_vec();
    message.extend_from_slice(program.as_ref());
    message.extend_from_slice(owner.as_ref());
    message.extend_from_slice(mint.as_ref());
    message.push(u8::try_from(cards.len()).unwrap());
    for card in &cards {
        message.extend_from_slice(&card.index.to_le_bytes());
        message.extend_from_slice(&card.amount.to_le_bytes());
    }
    message.extend_from_slice(&total.to_le_bytes());
    message.extend_from_slice(&quote.to_le_bytes());
    message.extend_from_slice(&expiry.to_le_bytes());
    message.extend_from_slice(&nonce.to_le_bytes());
    assert_eq!(message.len(), 135 + 10 * cards.len());
    json!({"kind":"sell_back","programId":program.to_string(),"owner":owner.to_string(),"mint":mint.to_string(),
        "cards":cards.iter().map(|card| json!({"index":card.index,"amount":card.amount.to_string()})).collect::<Vec<_>>(),
        "totalAmount":total.to_string(),"quoteLamports":quote.to_string(),"expiry":expiry.to_string(),"nonce":nonce,
        "message":hex(&message),"sha256":hex(solana_sha256_hasher::hash(&message).as_ref())})
}

fn ix_sample<D: InstructionData, A: ToAccountMetas>(
    name: &str,
    args: Value,
    data: D,
    accounts: A,
) -> Value {
    json!({"name":name,"args":args,"data":hex(&data.data()),"accounts":accounts.to_account_metas(None).iter().map(|a|json!({"pubkey":a.pubkey.to_string(),"isSigner":a.is_signer,"isWritable":a.is_writable})).collect::<Vec<_>>()})
}
#[test]
fn instructions() {
    let mut output = vec![];
    output.push(ix_sample("initialize",json!({"params":{"admin":k(1).to_string(),"keeper":k(4).to_string(),"executor":k(5).to_string(),"intake_signer":k(6).to_string(),"quote_signer":k(7).to_string(),"launch_wallet":k(8).to_string(),"team_wallet":k(9).to_string(),"token_mint":k(10).to_string(),"vrf_queue":k(11).to_string(),"guardians":[k(2).to_string(),k(3).to_string()],"team_wallets":vec![k(12).to_string();8],"rent_buffer_lamports":"50000000"}}),onepercent::instruction::Initialize{params:InitParams{admin:k(1),keeper:k(4),executor:k(5),intake_signer:k(6),quote_signer:k(7),launch_wallet:k(8),team_wallet:k(9),token_mint:k(10),vrf_queue:k(11),guardians:[k(2),k(3)],team_wallets:[k(12);8],rent_buffer_lamports:50000000}},onepercent::accounts::Initialize{authority:k(1),program:k(2),program_data:k(3),config:k(4),machine:k(5),deck:k(6),fee_in:k(7),vrf_queue:k(8),system_program:k(9)}));
    output.push(ix_sample(
        "admin_config",
        json!({"action":{"SetPause":{"bits":3,"paused":true}}}),
        onepercent::instruction::AdminConfig {
            action: AdminAction::SetPause {
                bits: 3,
                paused: true,
            },
        },
        onepercent::accounts::AdminConfig {
            admin: k(1),
            config: k(2),
            machine: k(3),
        },
    ));
    output.push(ix_sample(
        "admin_list_mint",
        json!({"class":1,"cap":"30000000000","oracle":k(15).to_string()}),
        onepercent::instruction::AdminListMint {
            class: 1,
            cap: 30000000000,
            oracle: k(15),
        },
        onepercent::accounts::AdminListMint {
            admin: k(1),
            config: k(2),
            machine: k(3),
            mint: k(4),
            ledger: k(5),
            vault: k(6),
            vault_auth: k(7),
            token_program: k(8),
            system_program: k(9),
        },
    ));
    output.push(ix_sample(
        "guardian",
        json!({"action":{"SetPause":{"bits":3,"paused":true}}}),
        onepercent::instruction::Guardian {
            action: GuardianAction::SetPause {
                bits: 3,
                paused: true,
            },
        },
        onepercent::accounts::Guardian {
            signer: k(1),
            config: k(2),
            machine: k(3),
        },
    ));
    output.push(ix_sample(
        "advance_phase",
        json!({}),
        onepercent::instruction::AdvancePhase {},
        onepercent::accounts::AdvancePhase {
            config: k(1),
            machine: k(2),
        },
    ));
    output.push(ix_sample(
        "feed",
        json!({"amounts":["1000","2000"],"expiry":"1800000110","nonce":7,"att_ix":0}),
        onepercent::instruction::Feed {
            amounts: vec![1000, 2000],
            expiry: 1800000110,
            nonce: 7,
            att_ix: 0,
        },
        onepercent::accounts::Feed {
            depositor: k(1),
            config: k(2),
            machine: k(3),
            deck: k(4),
            binder: k(5),
            instructions: k(6),
            system_program: k(7),
        },
    ));
    output.push(ix_sample(
        "take_back",
        json!({"deck_index":7,"amount":"1000"}),
        onepercent::instruction::TakeBack {
            deck_index: 7,
            amount: 1000,
        },
        onepercent::accounts::TakeBack {
            depositor: k(1),
            deck: k(2),
            binder: k(3),
            mint: k(4),
            ledger: k(5),
            vault: k(6),
            vault_auth: k(7),
            destination: k(8),
            token_program: k(9),
            machine: k(10),
        },
    ));
    output.push(ix_sample("buy_packs",json!({"edition":0,"qty":1,"pull_nonce":7,"min_live_flags":0,"referrer":k(31).to_string(),"hold":{"expiry":"1800000590","att_ix":0}}),onepercent::instruction::BuyPacks{edition:0,qty:1,pull_nonce:7,min_live_flags:0,referrer:Some(k(31)),hold:Some(HoldProof{expiry:1800000590,att_ix:0})},onepercent::accounts::BuyPacks{buyer:k(1),config:k(2),machine:k(3),deck:k(4),binder:k(5),pull:k(6),oracle_queue:k(7),instructions:k(8),system_program:k(9),program_identity:k(10),vrf_program:k(11),slot_hashes:k(12)}));
    output.push(ix_sample(
        "consume_randomness",
        json!({"randomness":vec![1;32],"seq":"7"}),
        onepercent::instruction::ConsumeRandomness {
            randomness: [1; 32],
            seq: 7,
        },
        onepercent::accounts::ConsumeRandomness {
            pull: k(1),
            machine: k(2),
            deck: k(3),
            binder: k(4),
            vrf_program_identity: k(5),
        },
    ));
    output.push(ix_sample(
        "settle",
        json!({"seq":"7","pack":0}),
        onepercent::instruction::Settle { seq: 7, pack: 0 },
        onepercent::accounts::Settle {
            pull: k(1),
            machine: k(2),
            buyer: k(3),
            referrer: k(4),
            wallet_0: k(5),
            wallet_1: k(6),
            wallet_2: k(7),
            wallet_3: k(8),
            binder_0: k(9),
            binder_1: k(10),
            binder_2: k(11),
            binder_3: k(12),
        },
    ));
    output.push(ix_sample(
        "refund_pull",
        json!({"seq":"7"}),
        onepercent::instruction::RefundPull { seq: 7 },
        onepercent::accounts::RefundPull {
            pull: k(1),
            machine: k(2),
            binder: k(3),
            buyer: k(4),
        },
    ));
    output.push(ix_sample(
        "redeem",
        json!({"card_index":2,"amount":"1000"}),
        onepercent::instruction::Redeem {
            card_index: 2,
            amount: 1000,
        },
        onepercent::accounts::Redeem {
            owner: k(1),
            binder: k(2),
            mint: k(3),
            ledger: k(4),
            vault: k(5),
            vault_auth: k(6),
            destination: k(7),
            token_program: k(8),
            machine: k(9),
        },
    ));
    output.push(ix_sample(
        "close_vault",
        json!({}),
        onepercent::instruction::CloseVault {},
        onepercent::accounts::CloseVault {
            machine: k(1),
            mint: k(2),
            ledger: k(3),
            vault: k(4),
            vault_auth: k(5),
            payer: k(6),
            token_program: k(7),
        },
    ));
    output.push(ix_sample(
        "team_withdraw",
        json!({}),
        onepercent::instruction::TeamWithdraw {},
        onepercent::accounts::TeamWithdraw {
            machine: k(1),
            config: k(2),
            team_wallet: k(3),
        },
    ));
    output.push(ix_sample(
        "ping",
        json!({}),
        onepercent::instruction::Ping {},
        onepercent::accounts::Ping { signer: k(1) },
    ));
    output.push(ix_sample(
        "power_on",
        json!({}),
        onepercent::instruction::PowerOn {},
        onepercent::accounts::PowerOn {
            launch_wallet: k(1),
            config: k(2),
            machine: k(3),
            mint: k(4),
            launch_pool: k(5),
            dbc_config: k(6),
            fee_in: k(7),
            ledger: k(8),
            vault: k(9),
            vault_auth: k(10),
            token_program: k(11),
            system_program: k(12),
        },
    ));
    output.push(feed_back_sample(vec![3]));
    output.push(sell_back_sample(
        vec![SellBackCard {
            index: 3,
            amount: 1000,
        }],
        0,
        0,
    ));
    output.push(exec_begin_sample(1, 0, 5_000_000_000));
    output.push(exec_end_sample(1));
    output.push(ix_sample(
        "collect_creator_fees",
        json!({}),
        onepercent::instruction::CollectCreatorFees {},
        onepercent::accounts::CollectCreatorFees {
            payer: k(1),
            machine: k(2),
            fee_in: k(3),
            fee_in_wsol: k(4),
            spl_token_program: k(5),
            system_program: k(6),
        },
    ));
    for (kind, name) in [
        (LaunchFeeKind::Curve, "Curve"),
        (LaunchFeeKind::Pool, "Pool"),
        (LaunchFeeKind::Surplus, "Surplus"),
    ] {
        let pool = kind == LaunchFeeKind::Pool;
        output.push(ix_sample(
            "claim_launch_fees",
            json!({"kind":{name:{}}}),
            onepercent::instruction::ClaimLaunchFees { kind },
            onepercent::accounts::ClaimLaunchFees {
                payer: k(1),
                machine: k(2),
                fee_in: k(3),
                fee_in_wsol: k(4),
                pool: k(5),
                dbc_config: k(6),
                base_mint: k(7),
                base_vault: k(8),
                quote_vault: k(9),
                quote_mint: k(10),
                pool_authority: k(11),
                event_authority: k(12),
                venue_program: k(13),
                token_program: k(14),
                associated_token_program: k(15),
                system_program: k(16),
                position: pool.then_some(k(17)),
                position_nft_account: pool.then_some(k(18)),
                fee_in_base: (kind != LaunchFeeKind::Surplus).then_some(k(19)),
            },
        ));
    }
    output.push(ix_sample(
        "start_final_pull",
        json!({}),
        onepercent::instruction::StartFinalPull {},
        onepercent::accounts::StartFinalPull { machine: k(1) },
    ));
    output.push(ix_sample(
        "claim_final_sol",
        json!({}),
        onepercent::instruction::ClaimFinalSol {},
        onepercent::accounts::ClaimFinalSol {
            machine: k(1),
            binder: k(2),
            owner: k(3),
        },
    ));
    output.push(ix_sample(
        "claim_final_tokens",
        json!({}),
        onepercent::instruction::ClaimFinalTokens {},
        onepercent::accounts::ClaimFinalTokens {
            owner: k(1),
            machine: k(2),
            binder: k(3),
            system_program: k(4),
        },
    ));
    output.push(ix_sample(
        "withdraw_owed",
        json!({}),
        onepercent::instruction::WithdrawOwed {},
        onepercent::accounts::WithdrawOwed {
            owner: k(1),
            binder: k(2),
        },
    ));
    output.push(ix_sample(
        "close_binder",
        json!({}),
        onepercent::instruction::CloseBinder {},
        onepercent::accounts::CloseBinder {
            owner: k(1),
            binder: k(2),
        },
    ));
    output.push(ix_sample(
        "spotlight_deposit",
        json!({}),
        onepercent::instruction::SpotlightDeposit {},
        onepercent::accounts::Deferred { signer: k(1) },
    ));
    output.push(ix_sample(
        "spotlight_take_back",
        json!({}),
        onepercent::instruction::SpotlightTakeBack {},
        onepercent::accounts::Deferred { signer: k(1) },
    ));
    for (kind, bucket, amount) in [
        (2, 15, 1_000_000_000_000),
        (3, 255, 1_000_000_000),
        (4, 255, 300_000_000),
    ] {
        output.push(exec_begin_sample(kind, bucket, amount));
        output.push(exec_end_sample(kind));
    }
    output.push(sell_back_sample(
        (0..8)
            .map(|index| SellBackCard {
                index: 7 - index,
                amount: 1000 + u64::from(index),
            })
            .collect(),
        7,
        1,
    ));
    output.push(feed_back_sample((0..8).rev().collect()));
    fixture("ix", json!(output));
}

fn exec_begin_sample(kind: u8, bucket: u8, amount: u64) -> Value {
    ix_sample(
        "exec_begin",
        json!({"kind":kind,"bucket":bucket,"amount":amount.to_string()}),
        onepercent::instruction::ExecBegin {
            kind,
            bucket,
            amount,
        },
        onepercent::accounts::ExecBegin {
            signer: k(1),
            config: k(2),
            machine: k(3),
            mint: k(4),
            ledger: k(5),
            vault: k(6),
            vault_auth: k(7),
            src: k(8),
            sol_dest: k(9),
            oracle_0: k(10),
            oracle_1: k(11),
            oracle_2: k(12),
            oracle_3: k(13),
            token_program: k(14),
            spl_token_program: k(15),
            instructions: k(16),
        },
    )
}
fn exec_end_sample(kind: u8) -> Value {
    ix_sample(
        "exec_end",
        json!({"kind":kind}),
        onepercent::instruction::ExecEnd { kind },
        onepercent::accounts::ExecEnd {
            signer: k(1),
            config: k(2),
            machine: k(3),
            mint: k(4),
            ledger: k(5),
            vault: k(6),
            vault_auth: k(7),
            sol_dest: k(8),
            token_program: k(9),
            spl_token_program: k(10),
            system_program: k(11),
        },
    )
}
fn sell_back_sample(cards: Vec<SellBackCard>, nonce: u32, att_ix: u8) -> Value {
    ix_sample(
        "sell_back",
        json!({"cards":cards.iter().map(|card| json!({"index":card.index,"amount":card.amount.to_string()})).collect::<Vec<_>>(),
        "quote_lamports":"5000000","expiry":"1800000000","nonce":nonce,"att_ix":att_ix}),
        onepercent::instruction::SellBack {
            cards,
            quote_lamports: 5_000_000,
            expiry: 1_800_000_000,
            nonce,
            att_ix,
        },
        onepercent::accounts::SellBack {
            owner: k(1),
            config: k(2),
            machine: k(3),
            binder: k(4),
            mint: k(5),
            ledger: k(6),
            vault: k(7),
            instructions: k(8),
        },
    )
}
fn feed_back_sample(card_indices: Vec<u16>) -> Value {
    ix_sample(
        "feed_back",
        json!({"card_indices":card_indices}),
        onepercent::instruction::FeedBack { card_indices },
        onepercent::accounts::FeedBack {
            owner: k(1),
            config: k(2),
            machine: k(3),
            deck: k(4),
            binder: k(5),
            system_program: k(6),
        },
    )
}

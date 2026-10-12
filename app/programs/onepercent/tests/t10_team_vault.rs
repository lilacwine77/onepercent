mod common;
use common::{pack_cases::*, *};
use onepercent::state::Machine;
use solana_signer::Signer;
#[test]
fn t10_01_team_withdraw() {
    let (mut e, u, _, _) = setup(false);
    let (p, _) = e.buy(&u, 0, 1).unwrap();
    e.fulfill(p, [1; 32]).unwrap();
    let m = e.state::<Machine>(e.machine);
    let before = e.account(pubkey(&e.authority.pubkey())).lamports;
    let meta = e.send(&[team_ix(&e)], &[]).unwrap();
    let after = e.state::<Machine>(e.machine);
    assert_eq!(after.team_sol, 0);
    assert_eq!(
        (after.stock_sol, after.burn_sol, after.jackpot_sol),
        (m.stock_sol, m.burn_sol, m.jackpot_sol)
    );
    assert_eq!(
        e.account(pubkey(&e.authority.pubkey())).lamports + meta.fee,
        before + m.team_sol
    );
    let mut ix = team_ix(&e);
    ix.accounts[2] = common::meta(pubkey(&u.pubkey()), true, false);
    assert_error(e.send(&[ix], &[]), "AccountMismatch");
    e.check_invariants();
}
#[test]
fn t10_02_close_vault_after_exit() {
    for t22 in [false, true] {
        let (mut e, u, bag) = card_fixture(t22, 1);
        e.send(&[e.redeem_ix(pubkey(&u.pubkey()), &bag, 0, 1000)], &[&u])
            .unwrap();
        let vault = ata(&e.vault_auth, &bag.mint, &bag.token_program);
        e.donate_tokens(vault, 19);
        e.mutate(bag.mint, |a| {
            let n = read_u64(&a.data, 36);
            write_u64(&mut a.data, 36, n + 19)
        });
        let supply = read_u64(&e.account(bag.mint).data, 36);
        let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
        let refund = e.account(ledger).lamports + e.account(vault).lamports;
        let before = e.account(pubkey(&u.pubkey())).lamports;
        e.send(&[close_ix(&e, &bag)], &[]).unwrap();
        assert!(e.closed(vault) && e.closed(ledger));
        assert_eq!(e.account(pubkey(&u.pubkey())).lamports, before + refund);
        assert_eq!(read_u64(&e.account(bag.mint).data, 36), supply - 19);
        e.check_invariants();
    }
}
#[test]
fn t10_03_close_vault_rejections() {
    let (mut e, _, bag) = card_fixture(false, 1);
    assert_error(e.send(&[close_ix(&e, &bag)], &[]), "VaultNotEmpty");
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    e.mutate(ledger, |a| write_u64(&mut a.data, 72, 0));
    e.seed_bucket(0, &bag, 1, 0, 0);
    assert_error(e.send(&[close_ix(&e, &bag)], &[]), "MintListed");
}
#[test]
fn t10_04_refeed_after_close() {
    let (mut e, u, bag) = card_fixture(false, 1);
    let who = pubkey(&u.pubkey());
    e.send(&[e.redeem_ix(who, &bag, 0, 1000)], &[&u]).unwrap();
    e.send(&[close_ix(&e, &bag)], &[]).unwrap();
    e.feed(&u, &bag, 1000, 0).unwrap();
    assert!(!e.closed(pda(&[b"ledger", bag.mint.as_ref()]).0));
    e.check_invariants();
}

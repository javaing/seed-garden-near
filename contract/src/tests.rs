use super::*;
use near_contract_standards::non_fungible_token::metadata::NFT_METADATA_SPEC;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{accounts, get_created_receipts, VMContextBuilder};
use near_sdk::testing_env;

const PRICE: NearToken = NearToken::from_millinear(100); // 0.1 NEAR

fn metadata() -> NFTContractMetadata {
    NFTContractMetadata {
        spec: NFT_METADATA_SPEC.to_string(),
        name: "Seed Garden".to_string(),
        symbol: "SEED".to_string(),
        icon: None,
        base_uri: Some("https://gateway.pinata.cloud/ipfs".to_string()),
        reference: None,
        reference_hash: None,
    }
}

fn ctx(predecessor: AccountId, deposit: NearToken, seed: u8) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(accounts(0))
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(deposit)
        .random_seed([seed; 32]);
    b
}

fn setup(max_supply: u64) -> Contract {
    testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0), 0).build());
    let mut royalties = HashMap::new();
    royalties.insert(accounts(3), 500); // 5%
    Contract::new(
        accounts(0),
        metadata(),
        PRICE,
        max_supply,
        Some("bafyPREVIEW/preview.png".to_string()),
        Some("bafyREF/reference.json".to_string()),
        Some(royalties),
    )
}

fn seed_of(token: &Token) -> String {
    let extra = token.metadata.as_ref().unwrap().extra.clone().unwrap();
    let prefix = "{\"seed\":\"";
    assert!(extra.starts_with(prefix) && extra.ends_with("\"}"), "{extra}");
    extra[prefix.len()..extra.len() - 2].to_string()
}

/// 回傳本次呼叫產生的 (receiver, transfer amount) 清單。
fn transfers() -> Vec<(AccountId, NearToken)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.clone();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((receiver.clone(), deposit)),
                _ => None,
            })
        })
        .collect()
}

#[test]
fn mint_sets_owner_metadata_and_seed() {
    let mut c = setup(10);
    testing_env!(ctx(accounts(1), NearToken::from_near(1), 7).build());
    let token = c.nft_mint(None);

    assert_eq!(token.token_id, "1");
    assert_eq!(token.owner_id, accounts(1));
    let md = token.metadata.as_ref().unwrap();
    assert_eq!(md.title.as_deref(), Some("Seed Garden #1"));
    assert_eq!(md.media.as_deref(), Some("bafyPREVIEW/preview.png"));
    assert_eq!(md.reference.as_deref(), Some("bafyREF/reference.json"));
    let seed = seed_of(&token);
    assert_eq!(seed.len(), 64);
    assert!(seed.chars().all(|c| c.is_ascii_hexdigit()));

    // NEP-171 nft_mint 事件
    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter().any(|l| l.starts_with("EVENT_JSON:")
            && l.contains("\"event\":\"nft_mint\"")
            && l.contains("\"token_ids\":[\"1\"]")),
        "missing nft_mint event: {logs:?}"
    );

    assert_eq!(c.nft_total_supply(), U128(1));
    assert_eq!(c.nft_tokens_for_owner(accounts(1), None, None).len(), 1);
    assert_eq!(c.mint_info().minted, 1);
}

#[test]
fn mint_to_other_receiver() {
    let mut c = setup(10);
    testing_env!(ctx(accounts(1), NearToken::from_near(1), 1).build());
    let token = c.nft_mint(Some(accounts(2)));
    assert_eq!(token.owner_id, accounts(2));
}

#[test]
fn seeds_are_unique() {
    let mut c = setup(50);
    let mut seen = std::collections::HashSet::new();
    for i in 0..50u8 {
        // 一半用相同的 random_seed，確認 token_id 混入後仍不重複
        let rs = if i % 2 == 0 { 42 } else { i };
        testing_env!(ctx(accounts(1), NearToken::from_near(1), rs).build());
        let t = c.nft_mint(None);
        assert!(seen.insert(seed_of(&t)), "duplicate seed at token {}", t.token_id);
    }
    assert_eq!(seen.len(), 50);
}

#[test]
#[should_panic(expected = "Max supply reached")]
fn mint_beyond_max_supply_fails() {
    let mut c = setup(2);
    for _ in 0..3 {
        testing_env!(ctx(accounts(1), NearToken::from_near(1), 3).build());
        c.nft_mint(None);
    }
}

#[test]
#[should_panic(expected = "must cover mint price")]
fn mint_below_price_fails() {
    let mut c = setup(2);
    testing_env!(ctx(accounts(1), NearToken::from_millinear(50), 3).build());
    c.nft_mint(None);
}

#[test]
#[should_panic(expected = "less than price + storage")]
fn mint_without_storage_deposit_fails() {
    let mut c = setup(2);
    testing_env!(ctx(accounts(1), PRICE, 3).build());
    c.nft_mint(None);
}

#[test]
fn excess_deposit_is_refunded_and_price_goes_to_owner() {
    let mut c = setup(10);
    let deposit = NearToken::from_near(2);
    testing_env!(ctx(accounts(1), deposit, 9).build());
    c.nft_mint(None);

    let storage_cost =
        env::storage_byte_cost().saturating_mul(c.last_mint_storage_bytes as u128);
    let expected_refund = deposit.saturating_sub(PRICE).saturating_sub(storage_cost);

    let t = transfers();
    assert!(
        t.contains(&(accounts(1), expected_refund)),
        "refund missing: {t:?}"
    );
    assert!(t.contains(&(accounts(0), PRICE)), "price payment missing: {t:?}");
    println!(
        "storage used per mint: {} bytes = {} ",
        c.last_mint_storage_bytes, storage_cost
    );
}

#[test]
fn refund_tracks_actual_storage_each_mint() {
    // 每次 mint 實際用到的 bytes 不固定（同 owner 第二個 token 不用再建 enumeration 集合、
    // TreeMap 會重新平衡），所以退款必須依「這一次」的實際用量計算，而不是固定估計值。
    let mut c = setup(10);
    let deposit = NearToken::from_near(1);
    let mut used = vec![];
    for (i, receiver) in [None, None, Some(accounts(4))].into_iter().enumerate() {
        testing_env!(ctx(accounts(1), deposit, i as u8).build());
        c.nft_mint(receiver);
        used.push(c.last_mint_storage_bytes);
        let cost = env::storage_byte_cost().saturating_mul(c.last_mint_storage_bytes as u128);
        let expected = deposit.saturating_sub(PRICE).saturating_sub(cost);
        assert!(
            transfers().contains(&(accounts(1), expected)),
            "mint {i}: refund should be {expected}"
        );
    }
    println!("bytes per mint: {used:?}");
}

#[test]
fn payout_splits_royalty() {
    let mut c = setup(10);
    testing_env!(ctx(accounts(1), NearToken::from_near(1), 1).build());
    c.nft_mint(None);
    let p = c.nft_payout("1".to_string(), U128(10_000), Some(5));
    assert_eq!(p.payout.get(&accounts(3)), Some(&U128(500)));
    assert_eq!(p.payout.get(&accounts(1)), Some(&U128(9_500)));
}

#[test]
fn transfer_payout_moves_token() {
    let mut c = setup(10);
    testing_env!(ctx(accounts(1), NearToken::from_near(1), 1).build());
    c.nft_mint(None);
    testing_env!(ctx(accounts(1), NearToken::from_yoctonear(1), 1).build());
    let p = c.nft_transfer_payout(accounts(2), "1".to_string(), None, None, U128(1000), None);
    assert_eq!(p.payout.get(&accounts(1)), Some(&U128(950)));
    assert_eq!(c.nft_token("1".to_string()).unwrap().owner_id, accounts(2));
}

#[test]
fn owner_can_change_price() {
    let mut c = setup(10);
    testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0), 1).build());
    c.set_mint_price(NearToken::from_millinear(10));
    assert_eq!(c.mint_info().price, NearToken::from_millinear(10));
    // 新價格 0.01 NEAR + storage 即可 mint
    testing_env!(ctx(accounts(1), NearToken::from_millinear(30), 2).build());
    c.nft_mint(None);
    assert_eq!(c.mint_info().minted, 1);
}

#[test]
#[should_panic(expected = "Only owner")]
fn non_owner_cannot_change_price() {
    let mut c = setup(10);
    testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0), 1).build());
    c.set_mint_price(NearToken::from_millinear(1));
}

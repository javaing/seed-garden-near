//! Seed NFT — 每個 token 在 mint 時由 `env::random_seed()` 產生 seed，
//! p5.js viewer 依 seed 產生確定性的生成藝術。
//!
//! 標準：NEP-171 core、NEP-177 metadata、NEP-178 approval、NEP-181 enumeration、NEP-199 payout。

mod web4;

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

/// 版稅總和上限（basis points，10000 = 100%）。
pub const MAX_TOTAL_ROYALTY_BPS: u32 = 5_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    NonFungibleToken,
    Metadata,
    TokenMetadata,
    Enumeration,
    Approval,
}

/// NEP-199 payout 結構。
#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

/// 前端用的 mint 狀態。
#[near(serializers = [json])]
pub struct MintInfo {
    pub price: NearToken,
    pub max_supply: u64,
    pub minted: u64,
    /// 每個 token 大約需要的 storage 押金（以最近一次 mint 的實際用量估算），多附會退。
    pub storage_deposit_estimate: NearToken,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    mint_price: NearToken,
    max_supply: u64,
    minted: u64,
    /// 每個 token 的 `media`（預覽圖），例如 `ipfs://<CID>/preview.png`，或相對於 base_uri 的路徑。
    token_media: Option<String>,
    /// 每個 token 的 `reference`（鏈外 JSON），內含互動版 HTML 位址（animation_url）。
    token_reference: Option<String>,
    /// 版稅：帳號 -> basis points。
    royalties: HashMap<AccountId, u32>,
    /// 最近一次 mint 實際用掉的 bytes，供前端估算押金。
    last_mint_storage_bytes: u64,
}

#[near]
impl Contract {
    /// 初始化。`mint_price` 以 yoctoNEAR 字串傳入（例如 "1000000000000000000000000" = 1 NEAR）。
    #[init]
    pub fn new(
        owner_id: AccountId,
        metadata: NFTContractMetadata,
        mint_price: NearToken,
        max_supply: u64,
        token_media: Option<String>,
        token_reference: Option<String>,
        royalties: Option<HashMap<AccountId, u32>>,
    ) -> Self {
        metadata.assert_valid();
        require!(max_supply > 0, "max_supply must be > 0");
        let royalties = royalties.unwrap_or_default();
        let total: u32 = royalties.values().sum();
        require!(
            total <= MAX_TOTAL_ROYALTY_BPS,
            "total royalties must be <= 5000 bps"
        );
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::NonFungibleToken,
                owner_id,
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approval),
            ),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            mint_price,
            max_supply,
            minted: 0,
            token_media,
            token_reference,
            royalties,
            last_mint_storage_bytes: 0,
        }
    }

    /// 公開 mint：附上 `mint_price` + storage 押金；多附的部分退還給呼叫者。
    /// 價格部分直接轉給合約 owner。
    #[payable]
    pub fn nft_mint(&mut self, receiver_id: Option<AccountId>) -> Token {
        require!(self.minted < self.max_supply, "Max supply reached");

        let payer = env::predecessor_account_id();
        let owner = receiver_id.unwrap_or_else(|| payer.clone());
        let deposit = env::attached_deposit();
        require!(
            deposit >= self.mint_price,
            format!("Attached deposit must cover mint price {}", self.mint_price)
        );

        self.minted += 1;
        let token_id: TokenId = self.minted.to_string();
        let seed = self.generate_seed(&token_id, &payer);
        let collection = self.metadata.get().map(|m| m.name).unwrap_or_default();

        let token_metadata = TokenMetadata {
            title: Some(format!("{} #{}", collection, token_id)),
            description: None,
            media: self.token_media.clone(),
            media_hash: None,
            copies: Some(1),
            issued_at: Some(env::block_timestamp_ms().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(format!("{{\"seed\":\"{}\"}}", seed)),
            reference: self.token_reference.clone(),
            reference_hash: None,
        };

        let storage_before = env::storage_usage();
        // refund_id = None：storage 押金由我們自己結算（因為還要扣價格）。
        let token = self
            .tokens
            .internal_mint_with_refund(token_id, owner, Some(token_metadata), None);
        let storage_used = env::storage_usage().saturating_sub(storage_before);
        self.last_mint_storage_bytes = storage_used;

        // internal_mint_with_refund 不會發 NEP-171 事件，indexer / 市場要靠這個 log 才看得到新 token。
        NftMint {
            owner_id: &token.owner_id,
            token_ids: &[&token.token_id],
            memo: None,
        }
        .emit();

        let storage_cost = env::storage_byte_cost().saturating_mul(storage_used as u128);
        let required = self.mint_price.saturating_add(storage_cost);
        require!(
            deposit >= required,
            format!(
                "Attached deposit {} is less than price + storage ({})",
                deposit, required
            )
        );

        let refund = deposit.saturating_sub(required);
        if !refund.is_zero() {
            let _ = Promise::new(payer).transfer(refund);
        }
        if !self.mint_price.is_zero() {
            let _ = Promise::new(self.tokens.owner_id.clone()).transfer(self.mint_price);
        }
        token
    }

    pub fn mint_info(&self) -> MintInfo {
        // 尚未 mint 過時用保守值 2000 bytes 估算。
        let bytes = if self.last_mint_storage_bytes == 0 {
            2_000
        } else {
            self.last_mint_storage_bytes
        };
        MintInfo {
            price: self.mint_price,
            max_supply: self.max_supply,
            minted: self.minted,
            storage_deposit_estimate: env::storage_byte_cost().saturating_mul(bytes as u128),
        }
    }

    pub fn get_royalties(&self) -> HashMap<AccountId, u32> {
        self.royalties.clone()
    }

    /// owner 更新之後 mint 的 media / reference（例如 viewer 重新上傳 IPFS 拿到新 CID）。
    pub fn set_token_links(&mut self, token_media: Option<String>, token_reference: Option<String>) {
        require!(
            env::predecessor_account_id() == self.tokens.owner_id,
            "Only owner"
        );
        self.token_media = token_media;
        self.token_reference = token_reference;
    }

    /// owner 調整 mint 價格（yoctoNEAR 字串）。
    pub fn set_mint_price(&mut self, mint_price: NearToken) {
        require!(
            env::predecessor_account_id() == self.tokens.owner_id,
            "Only owner"
        );
        self.mint_price = mint_price;
    }

    /// seed = sha256(random_seed || token_id || payer || block_height)，hex。
    /// 混入 token_id 保證同一個 block 內也不會重複。注意：random_seed 對驗證者不是不可預測的，
    /// 只適合用在藝術變化，不適合抽獎類用途。
    fn generate_seed(&self, token_id: &str, payer: &AccountId) -> String {
        let mut input = env::random_seed();
        input.extend_from_slice(token_id.as_bytes());
        input.extend_from_slice(payer.as_bytes());
        input.extend_from_slice(&env::block_height().to_le_bytes());
        to_hex(&env::sha256(&input))
    }

    fn compute_payout(&self, owner_id: &AccountId, balance: u128, max_len_payout: Option<u32>) -> Payout {
        if let Some(max) = max_len_payout {
            require!(
                self.royalties.len() as u32 + 1 <= max,
                "Market cannot payout to that many receivers"
            );
        }
        let mut payout: HashMap<AccountId, U128> = HashMap::new();
        let mut paid: u128 = 0;
        for (account, bps) in &self.royalties {
            let amount = balance * (*bps as u128) / 10_000;
            paid += amount;
            let entry = payout.entry(account.clone()).or_insert(U128(0));
            entry.0 += amount;
        }
        let entry = payout.entry(owner_id.clone()).or_insert(U128(0));
        entry.0 += balance - paid;
        Payout { payout }
    }

    // ---------- NEP-199 ----------

    pub fn nft_payout(&self, token_id: TokenId, balance: U128, max_len_payout: Option<u32>) -> Payout {
        let owner_id = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"));
        self.compute_payout(&owner_id, balance.0, max_len_payout)
    }

    #[payable]
    pub fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        let owner_id = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"));
        let payout = self.compute_payout(&owner_id, balance.0, max_len_payout);
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo);
        payout
    }
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

// ---------- NEP-171 ----------

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

// ---------- NEP-178 ----------

#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id);
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id);
    }

    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

// ---------- NEP-181 ----------

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}

// ---------- NEP-177 ----------

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests;

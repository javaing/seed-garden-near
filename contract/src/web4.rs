//! web4：合約自己回傳網頁，作品程式與展示頁都在鏈上，不依賴 IPFS 或任何網站。
//!
//! - `/`               收藏總覽（最新的作品直接嵌入）
//! - `/token/{id}`     該 token 的作品頁，seed 由合約從 metadata 讀出後寫進頁面
//! - `/seed/{hex}`     任意 seed 的預覽（不是 token，只是讓人試看）
//!
//! 網址：mainnet `https://<contract>.near.page`，testnet `https://<contract>.testnet.page`。
//! 作品頁由 `contract/web4/art.html` 產生（`node contract/web4/build.mjs`），
//! 內含 mini-p5（p5.js 1.x 子集）、seed shim 與原作 sketch，共約 16 KB。

use near_sdk::json_types::Base64VecU8;
use near_sdk::near;

use crate::{Contract, ContractExt};

const ART_HTML: &str = include_str!("../web4/art.html");
/// 首頁上的 mint 連結（錢包介面太大，不放進合約）。
const MINT_SITE: &str = "https://javaing.github.io/seed-garden-near/";
/// 首頁嵌入幾件最新作品。
const LATEST_ON_INDEX: u64 = 6;

#[near(serializers = [json])]
pub struct Web4Request {
    pub path: String,
}

#[near(serializers = [json])]
#[derive(Debug)]
pub struct Web4Response {
    #[serde(rename = "contentType")]
    pub content_type: String,
    pub body: Base64VecU8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

fn html(body: String, status: Option<u16>) -> Web4Response {
    Web4Response {
        content_type: "text/html; charset=UTF-8".to_string(),
        body: body.into_bytes().into(),
        status,
    }
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// yoctoNEAR → 「0.01 NEAR」。
fn near_display(yocto: u128) -> String {
    const ONE: u128 = 10u128.pow(24);
    let frac = format!("{:024}", yocto % ONE);
    let frac = frac.trim_end_matches('0');
    if frac.is_empty() {
        format!("{} NEAR", yocto / ONE)
    } else {
        format!("{}.{} NEAR", yocto / ONE, frac)
    }
}

fn is_hex_seed(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// 把 seed 與標題寫進作品頁。seed 只接受 hex，避免注入。
pub(crate) fn art_page(seed: &str, title: &str) -> String {
    ART_HTML
        .replacen(
            "window.__SEED__=\"\";",
            &format!("window.__SEED__=\"{}\";", seed.to_ascii_lowercase()),
            1,
        )
        .replacen(
            "<title>Harmonious donuts</title>",
            &format!("<title>{}</title>", escape(title)),
            1,
        )
}

const PAGE_STYLE: &str = "body{margin:0;padding:24px 16px;background:#0e0e12;color:#ebeaf0;\
font:16px/1.6 system-ui,'Segoe UI',sans-serif}main{max-width:960px;margin:0 auto}\
a{color:#7fd8b5}h1{margin:0 0 4px}.muted{color:#9a97a2}\
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin:16px 0}\
.grid a{display:block;color:inherit;text-decoration:none;background:#1b1b22;border-radius:10px;overflow:hidden}\
.grid iframe{display:block;width:100%;aspect-ratio:1;border:0;pointer-events:none}\
.grid span{display:block;padding:6px 10px;font-size:14px}\
code{font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere}";

#[near]
impl Contract {
    /// web4 入口（view）。gateway 以 `{"request":{"path":"/..."}}` 呼叫。
    pub fn web4_get(&self, request: Web4Request) -> Web4Response {
        let path = request.path.split(['?', '#']).next().unwrap_or("/");
        let path = path.trim_end_matches('/');

        if path.is_empty() || path == "/index.html" {
            return html(self.index_page(), None);
        }
        if let Some(id) = path.strip_prefix("/token/") {
            return match self.seed_of_token(id) {
                Some(seed) => {
                    let name = self.metadata.get().map(|m| m.name).unwrap_or_default();
                    html(art_page(&seed, &format!("{} #{}", name, id)), None)
                }
                None => not_found(),
            };
        }
        if let Some(seed) = path.strip_prefix("/seed/") {
            if is_hex_seed(seed) {
                return html(art_page(seed, "Seed preview"), None);
            }
        }
        not_found()
    }
}

fn not_found() -> Web4Response {
    html(
        format!(
            "<!doctype html><meta charset=utf-8><title>Not found</title><style>{PAGE_STYLE}</style>\
<main><h1>Not found</h1><p><a href=\"/\">Back to the collection</a></p></main>"
        ),
        Some(404),
    )
}

impl Contract {
    pub(crate) fn seed_of_token(&self, token_id: &str) -> Option<String> {
        let meta = self
            .tokens
            .token_metadata_by_id
            .as_ref()?
            .get(&token_id.to_string())?;
        let extra = meta.extra?;
        let seed = extra.strip_prefix("{\"seed\":\"")?.strip_suffix("\"}")?;
        is_hex_seed(seed).then(|| seed.to_string())
    }

    fn index_page(&self) -> String {
        let meta = self.metadata.get();
        let name = escape(&meta.map(|m| m.name).unwrap_or_default());
        let price = near_display(self.mint_price.as_yoctonear());
        let latest: String = (1..=self.minted)
            .rev()
            .take(LATEST_ON_INDEX as usize)
            .map(|id| {
                format!(
                    "<a href=\"/token/{id}\"><iframe src=\"/token/{id}?embed=1\" loading=\"lazy\" \
title=\"#{id}\"></iframe><span>{name} #{id}</span></a>"
                )
            })
            .collect();
        let older: String = (1..=self.minted.saturating_sub(LATEST_ON_INDEX))
            .rev()
            .map(|id| format!("<a href=\"/token/{id}\">#{id}</a> "))
            .collect();
        format!(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{name}</title>\
<style>{PAGE_STYLE}</style></head><body><main>\
<h1>{name}</h1>\
<p class=\"muted\">Fully on-chain generative art on NEAR. This page, the artwork code and every \
token's seed are served by the contract <code>{contract}</code> itself, with no IPFS and no web server.</p>\
<p>{minted} / {max} minted · price {price} · <a href=\"{MINT_SITE}\">Mint with a wallet</a></p>\
<div class=\"grid\">{latest}</div>\
{older_block}\
<p class=\"muted\">Each artwork is <em>Harmonious donuts</em>, drawn live in the browser from the token's \
seed. Try any seed at <code>/seed/&lt;hex&gt;</code>.</p>\
</main></body></html>",
            contract = near_sdk::env::current_account_id(),
            minted = self.minted,
            max = self.max_supply,
            older_block = if older.is_empty() {
                String::new()
            } else {
                format!("<p>Earlier: {older}</p>")
            },
        )
    }
}

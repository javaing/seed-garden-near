# Seed Garden

**English** · [中文](#zh)

Generative-art NFTs on NEAR whose artwork is a live p5.js program, not a static image.
Every token gets a unique seed **on-chain at mint time**, and the viewer turns that seed into a deterministic artwork:
the same seed always renders the same piece.

Built for the NEAR Hackathon, **`nfts` track — NFTs That Do Something**.

- **Live demo:** https://javaing.github.io/seed-garden-near/
- **Seed comparison demo:** https://javaing.github.io/seed-garden-near/examples/harmonious-donuts/grid.html
- **Contract:** [`nft.seed-garden.testnet`](https://testnet.nearblocks.io/address/nft.seed-garden.testnet) (NEAR testnet)
- **Network:** NEAR testnet only. No real funds.

<a id="en"></a>

## What it does

- **On-chain seed.** `nft_mint` derives a seed from `env::random_seed()` and stores it in the token metadata
  (`TokenMetadata.extra = {"seed":"<64 hex>"}`). Nobody, including the artist, picks the outcome in advance.
- **The artwork is code.** The live collection renders *Harmonious donuts*, the artist's p5.js piece first released on fxhash,
  adapted to read NEAR seeds (`examples/harmonious-donuts/`). A second piece, a flow field (`viewer/`), shows that any p5.js sketch can plug in.
  Each artwork folder ships its own `p5.min.js` (no CDN), so it can be pinned to IPFS and keeps working.
- **Full NEAR NFT standards.** NEP-171 core, NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration,
  and NEP-199 royalties (`nft_payout`, `nft_transfer_payout`), so marketplaces can list tokens and pay royalties.
- **Fair, self-refunding mint.** Configurable price and max supply. The contract measures the storage each mint
  actually uses, charges only that, and refunds the rest of the deposit in the same call.
- **Many wallets, including Ethereum users.** NEAR Wallet Selector with OKX Wallet, Meteor, HOT, and
  **Ethereum wallets (MetaMask) via NEP-518**: an Ethereum user mints on NEAR with their own `0x…` address as the NEAR account.
- **Bring your own generative art.** A tiny shim gives fxhash-era sketches the same `fxrand()` API backed by NEAR seeds,
  so existing work moves over almost unchanged; `grid.html` compares 9 seeds side by side.

## How it works

```
 wallet ──nft_mint(price + storage)──▶ NEAR contract
                                         │  seed = sha256(random_seed ‖ token_id ‖ payer ‖ block_height)
                                         │  metadata.extra = {"seed": "…"}
                                         ▼
 frontend ──nft_tokens_for_owner──▶ tokens ──▶ <iframe src="viewer/index.html?seed=…">
                                                   p5.js renders the same art for the same seed
```

Where things live in the token metadata (NEP-177):

| Field | Content |
| --- | --- |
| `extra` | `{"seed":"<64 hex>"}`, written by the contract at mint |
| `media` | Collection preview image (a token's seed is unknown before mint) |
| `reference` | Off-chain JSON with `animation_url` pointing to the IPFS viewer (NEP-177 has no `animation_url` field) |
| contract `base_uri` | IPFS gateway, so `media` / `reference` can be relative `<CID>/…` paths |

`random_seed` is not unpredictable to validators, so it is fine for art variation but not for lotteries.

## Repository layout

```
contract/   Rust smart contract (near-sdk 5.30) + unit tests
frontend/   Vite app: wallet connect, mint, "my tokens" gallery
viewer/     p5.js viewer, self-contained for IPFS
examples/   fxhash project ported to NEAR seeds (Harmonious donuts)
metadata/   reference JSON example
.github/    GitHub Pages deployment workflow
```

## Status

| Item | State |
| --- | --- |
| Contract unit tests | 10 / 10 passing |
| Contract wasm build | `cargo near build` succeeds (252 KB) |
| Frontend build + wallet menu (OKX, Meteor, HOT, Ethereum) | Verified |
| GitHub Pages demo | Deployed by CI on every push to `main` |
| Contract deployed to testnet | Live at `nft.seed-garden.testnet`; test mints #1 and #2 succeeded and emit the NEP-171 `nft_mint` event |
| Mint through a browser wallet (OKX / Meteor / MetaMask) on the live page | Not tested yet (wallet connection verified) |

## Quick start

### 1. Toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
```

Tested with Rust 1.99.1, cargo-near 0.23.0, near-cli-rs 0.31.1, near-sdk 5.30.1, Node 24 / npm 11.
Windows-specific steps (GNU toolchain, long paths, `cargo test`) are in the [Chinese section](#zh-toolchain).

### 2. Build and test the contract

```bash
cd contract
cargo test
cargo near build non-reproducible-wasm --no-abi   # -> target/near/seed_nft.wasm
```

`--no-abi` is only needed on Windows. Each token uses about 540–690 bytes of storage (~0.006 NEAR).

### 3. Create testnet accounts and deploy

```bash
near account create-account sponsor-by-faucet-service my-nft.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
```

```bash
near account create-account fund-myself seed.my-nft.testnet '5 NEAR' autogenerate-new-keypair save-to-keychain sign-as my-nft.testnet network-config testnet sign-with-keychain send
```

```bash
near contract deploy seed.my-nft.testnet use-file target/near/seed_nft.wasm with-init-call new json-args '{
  "owner_id": "my-nft.testnet",
  "metadata": { "spec": "nft-1.0.0", "name": "Seed Garden", "symbol": "SEED", "base_uri": "https://gateway.pinata.cloud/ipfs" },
  "mint_price": "100000000000000000000000",
  "max_supply": 333,
  "token_media": "<META_CID>/preview.png",
  "token_reference": "<META_CID>/reference.json",
  "royalties": { "my-nft.testnet": 500 }
}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
```

```bash
near contract call-function as-transaction seed.my-nft.testnet nft_mint json-args '{}' prepaid-gas '100.0 Tgas' attached-deposit '0.15 NEAR' sign-as my-nft.testnet network-config testnet sign-with-keychain send
```

`mint_price` is in yoctoNEAR (0.1 NEAR above). `royalties` are basis points, 5,000 max in total.
`token_media` / `token_reference` can be `null` at first and set later with `set_token_links`.
The owner can change the price later with `set_mint_price` (the live contract currently charges 0.01 NEAR).

### 4. Pin the viewer to IPFS

Upload the artwork folder (`examples/harmonious-donuts/`, or `viewer/` for the flow field) to Pinata (or any pinning service) as a folder to get `VIEWER_CID`.
Replace `<VIEWER_CID>` in `metadata/reference.example.json`, save it as `reference.json`, and upload it together with a
`preview.png` (press `s` in the viewer to save one) to get `META_CID`.
Note: `ipfs.io` no longer serves raw files to scripts; use a gateway such as `gateway.pinata.cloud`.

### 5. Run the frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # set VITE_CONTRACT_ID=seed.my-nft.testnet
npm run dev                  # http://localhost:5173
```

| Variable | Purpose |
| --- | --- |
| `VITE_NETWORK_ID` | `testnet` (default) or `mainnet` |
| `VITE_CONTRACT_ID` | Deployed contract account |
| `VITE_VIEWER_URL` | Optional. IPFS artwork URL; defaults to the bundled `examples/harmonious-donuts/index.html` |
| `VITE_REOWN_PROJECT_ID` | Optional. Enables WalletConnect / mobile wallets for Ethereum users |
| `VITE_STORAGE_BUFFER_NEAR` | Extra deposit sent with mint (default 0.02); the unused part is refunded |

### 6. Deploy the demo

GitHub Pages is already set up: every push to `main` builds and deploys to
https://javaing.github.io/seed-garden-near/. Public settings live in `frontend/.env.production`;
GitHub Actions Variables with the same names (for example `VITE_CONTRACT_ID`) override them.
Vercel also works: set the Root Directory to `frontend`.

## Wallet notes

- **OKX Wallet:** official `@near-wallet-selector/okx-wallet`, uses the injected `window.okxwallet.near`; desktop browsers only.
- **Ethereum wallets (NEP-518):** the wallet is asked to add the NEAR EVM network (testnet chain id **398**,
  RPC `https://eth-rpc.testnet.near.org`). The `0x…` account needs testnet NEAR. The first transaction includes a
  one-time relayer onboarding signature. EOAs only (no smart accounts).
  Without `VITE_REOWN_PROJECT_ID`, only browser extensions such as MetaMask are offered.
- **Temple (Etherlink EVM accounts):** untested. It should work if Temple injects an EIP-1193 provider and accepts the custom chain 398.

## Roadmap

- Chain Signatures: give every NFT its own cross-chain address.
- web4: a fully on-chain gallery page.
- Per-token preview images rendered from the seed after mint.

## Third-party licenses

p5.js is licensed under LGPL-2.1 (see `viewer/p5-LICENSE.txt`).

---

<a id="zh"></a>

# Seed Garden（中文）

[English](#en) · **中文**

在 NEAR 上的生成藝術 NFT。作品本身是一段 p5.js 程式，不是一張靜態圖。
每個 token 在 **mint 時於鏈上**取得獨一無二的 seed，展示頁依 seed 畫出確定性的作品：同一個 seed 永遠畫出同一張圖。

參加 NEAR Hackathon，**`nfts` track（NFTs That Do Something）**。

- **線上 demo：** https://javaing.github.io/seed-garden-near/
- **seed 比較範例：** https://javaing.github.io/seed-garden-near/examples/harmonious-donuts/grid.html
- **合約：** [`nft.seed-garden.testnet`](https://testnet.nearblocks.io/address/nft.seed-garden.testnet)（NEAR testnet）
- **網路：** 只在 NEAR testnet，不使用真實資金。

## 特色

- **鏈上 seed**：`nft_mint` 由 `env::random_seed()` 產生 seed，存在 `TokenMetadata.extra`（`{"seed":"<64 hex>"}`）。包括作者在內，沒有人能事先決定結果。
- **作品就是程式**：線上系列使用作者在 fxhash 發表過的 p5.js 作品 *Harmonious donuts*，改成讀 NEAR seed（`examples/harmonious-donuts/`）；另一款流線作品（`viewer/`）示範任何 p5.js 作品都能接上。每個作品資料夾自帶 `p5.min.js`（不用 CDN），上傳 IPFS 就能一直運作。
- **完整 NEAR NFT 標準**：NEP-171 core、NEP-177 metadata、NEP-178 approval、NEP-181 enumeration、NEP-199 版稅（`nft_payout`、`nft_transfer_payout`）。
- **公平且自動退款的 mint**：可設定價格與 max supply。合約量測每次 mint 實際用掉的 storage，只收那部分，多附的押金在同一筆交易退回。
- **多種錢包，包含 Ethereum 使用者**：NEAR Wallet Selector 支援 OKX Wallet、Meteor、HOT，以及透過 NEP-518 的 **Ethereum 錢包（MetaMask）**：Ethereum 使用者直接用自己的 `0x…` 地址當 NEAR 帳號 mint。
- **舊作也能接上**：`examples/harmonious-donuts/` 用一個小相容層把 fxhash 舊作接上 NEAR seed，`grid.html` 一次比較 9 個 seed。

## 運作方式

seed 的計算：`sha256(random_seed ‖ token_id ‖ 付款帳號 ‖ block_height)`，混入 token_id 保證不重複。
`random_seed` 對驗證者不是不可預測，所以只適合藝術變化，不要拿來做抽獎。

| 欄位 | 內容 |
| --- | --- |
| `extra` | `{"seed":"<64 hex>"}`，mint 時由合約寫入 |
| `media` | 系列共用的預覽圖（seed 在 mint 時才決定，無法事先為每個 token 產生預覽） |
| `reference` | 鏈外 JSON，內含 `animation_url` 指向 IPFS 上的 viewer（NEP-177 沒有 `animation_url` 欄位） |
| 合約 `base_uri` | IPFS gateway，`media` / `reference` 可寫相對路徑 `<CID>/…`，換 gateway 不用改鏈上資料 |

## 專案結構

```
contract/   Rust 合約（near-sdk 5.30）與 unit tests
frontend/   Vite 前端：連錢包、mint、我的 token 列表
viewer/     p5.js 展示頁，可整包上傳 IPFS
examples/   fxhash 舊作移植範例（Harmonious donuts）
metadata/   reference JSON 範例
.github/    GitHub Pages 部署 workflow
```

## 目前狀態

| 項目 | 狀態 |
| --- | --- |
| 合約 unit tests | 10 個全部通過 |
| 合約 wasm 建置 | `cargo near build` 成功（252 KB） |
| 前端 build、錢包選單（OKX、Meteor、HOT、Ethereum） | 已驗證 |
| GitHub Pages demo | 每次 push 到 `main` 由 CI 自動部署 |
| 合約部署到 testnet | 已部署 `nft.seed-garden.testnet`；測試 mint #1、#2 成功，並發出 NEP-171 `nft_mint` 事件 |
| 在線上頁面用瀏覽器錢包（OKX / Meteor / MetaMask）mint | 尚未實測（錢包連線已確認） |

<a id="zh-toolchain"></a>

## 1. 安裝工具鏈（Windows 原生，GNU host）

在 PowerShell：

```powershell
# rustup（GNU host：自帶 mingw linker，不需要 VS Build Tools）
Invoke-WebRequest https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-gnu/rustup-init.exe -OutFile $env:TEMP\rustup-init.exe
& $env:TEMP\rustup-init.exe -y --default-host x86_64-pc-windows-gnu --default-toolchain stable --profile minimal -t wasm32-unknown-unknown

# cargo-near 與 near-cli-rs（官方預編譯 binary）
irm https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.ps1 | iex
irm https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.ps1 | iex
```

macOS / Linux 請用英文版的安裝指令。重開終端機後確認：

```bash
cargo --version && cargo near --version && near --version
```

已驗證版本：Rust 1.99.1、cargo-near 0.23.0、near-cli-rs 0.31.1、near-sdk 5.30.1、Node 24 / npm 11。

### Windows 上的兩個坑

1. **路徑太長**：Windows 預設路徑上限 260 字元，專案放在很深的資料夾時 build script 會出現 `os error 3`（找不到路徑）。
   把 target 指到短路徑即可：
   ```bash
   export CARGO_TARGET_DIR="$HOME/.cache/seednft-target"     # Git Bash
   ```
   ```powershell
   $env:CARGO_TARGET_DIR = "$HOME\.cache\seednft-target"      # PowerShell
   ```
2. **`cargo test` 需要組譯器**：測試在 Windows 主機上編譯，`getrandom` 會呼叫 `dlltool`，而 `dlltool` 需要 `as.exe`，
   Rust 的 GNU 工具鏈沒有附。要另外裝 mingw-w64（已驗證 WinLibs）：
   ```powershell
   winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e --scope user
   ```
   裝完重開終端機；如果 `where as` 找不到，把
   `%LOCALAPPDATA%\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin`
   加到 PATH。**wasm 建置不需要它。**

## 2. 合約

```bash
cd contract
cargo test
cargo near build non-reproducible-wasm --no-abi
# 產出：$CARGO_TARGET_DIR/near/seed_nft.wasm（沒設 CARGO_TARGET_DIR 時在 contract/target/near/）
```

`--no-abi`：ABI 產生步驟會在主機上連結一個含有 NEAR host 函式的 DLL，Linux 可以但 Windows 連結器不接受未解析符號。
ABI 只是給工具看的描述檔，部署不需要；在 Linux / macOS 可以拿掉 `--no-abi`。

測試涵蓋：mint 後的 owner / metadata / seed 格式、mint 給別人、50 次 mint 的 seed 唯一性（含相同 random_seed 的情況）、
超過 max supply 失敗、押金不足價格失敗、押金不足 storage 失敗、多附押金退還且價格轉給 owner、
每次 mint 依實際 storage 用量退款、`nft_payout` 版稅分配、`nft_transfer_payout` 轉移。

每個 token 實際用掉約 540–690 bytes（約 0.0054–0.0069 NEAR）：同一個 owner 的第二個 token 不用再建 enumeration 集合，
所以用得比較少。這也是為什麼前端多附 0.05 NEAR、由合約依實際用量退回，而不是附一個剛好的固定值。

### 主要方法

| 方法 | 說明 |
| --- | --- |
| `new(owner_id, metadata, mint_price, max_supply, token_media?, token_reference?, royalties?)` | 初始化。`mint_price` 是 yoctoNEAR 字串；`royalties` 為 `{帳號: basis points}`，總和 ≤ 5000（50%）。 |
| `nft_mint(receiver_id?)` | payable。需附 `mint_price + storage 費`，多的退給呼叫者；價格轉給 owner。 |
| `mint_info()` | 價格、max supply、已 mint 數、每個 token 的 storage 押金估計。 |
| `set_token_links(token_media?, token_reference?)` | owner 更新之後 mint 的 media / reference。 |
| `set_mint_price(mint_price)` | owner 調整價格（yoctoNEAR 字串）。目前線上合約是 0.01 NEAR。 |
| `nft_payout` / `nft_transfer_payout` | NEP-199。 |
| 其他 | `nft_transfer`、`nft_transfer_call`、`nft_token`、`nft_approve`、`nft_revoke(_all)`、`nft_is_approved`、`nft_total_supply`、`nft_tokens`、`nft_supply_for_owner`、`nft_tokens_for_owner`、`nft_metadata`。 |

## 3. 建 testnet 帳號並部署

以下指令在 **Git Bash** 執行（PowerShell 5.1 傳 JSON 給外部程式時會吃掉雙引號）。把 `my-nft` 換成你的名稱。

```bash
# 1) 用 faucet 建一個 testnet 主帳號（會拿到測試幣）
near account create-account sponsor-by-faucet-service my-nft.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
```

```bash
# 2) 建合約用的 sub-account（從主帳號撥 5 NEAR 給它付 storage）
near account create-account fund-myself seed.my-nft.testnet '5 NEAR' autogenerate-new-keypair save-to-keychain sign-as my-nft.testnet network-config testnet sign-with-keychain send
```

```bash
# 3) 部署並初始化（價格 0.1 NEAR、上限 333 個、5% 版稅給主帳號）
near contract deploy seed.my-nft.testnet use-file "$CARGO_TARGET_DIR/near/seed_nft.wasm" with-init-call new json-args '{
  "owner_id": "my-nft.testnet",
  "metadata": {
    "spec": "nft-1.0.0",
    "name": "Seed Garden",
    "symbol": "SEED",
    "base_uri": "https://gateway.pinata.cloud/ipfs"
  },
  "mint_price": "100000000000000000000000",
  "max_supply": 333,
  "token_media": "<META_CID>/preview.png",
  "token_reference": "<META_CID>/reference.json",
  "royalties": { "my-nft.testnet": 500 }
}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
```

```bash
# 4) 確認
near contract call-function as-read-only seed.my-nft.testnet mint_info json-args '{}' network-config testnet now
```

```bash
# 5) 用 CLI mint 一個試試（0.1 價格 + 0.05 押金，多的會退）
near contract call-function as-transaction seed.my-nft.testnet nft_mint json-args '{}' prepaid-gas '100.0 Tgas' attached-deposit '0.15 NEAR' sign-as my-nft.testnet network-config testnet sign-with-keychain send
```

還沒上傳 IPFS 也可以先部署，`token_media` / `token_reference` 給 `null`，之後用 `set_token_links` 補上（只影響之後 mint 的 token）。

## 4. 上傳 viewer 與 metadata 到 IPFS（Pinata）

1. 本機先看 viewer：用任何靜態伺服器開 `viewer/`，例如 `npx serve viewer`，打開 `http://localhost:3000/?seed=abc123...`。按 `s` 可存 PNG，可拿來當 `preview.png`。
2. 到 [Pinata](https://app.pinata.cloud) → Upload → **Folder**，選作品資料夾（`examples/harmonious-donuts/`，或流線版的 `viewer/`）→ 得到 `VIEWER_CID`。
   確認 `https://gateway.pinata.cloud/ipfs/<VIEWER_CID>/index.html?seed=00ff...` 能正常顯示。
3. 複製 `metadata/reference.example.json` 成 `reference.json`，把 `<VIEWER_CID>` 換掉；
   和 `preview.png` 放同一個資料夾，再用 Pinata 上傳這個資料夾 → 得到 `META_CID`。
4. 部署時（或之後用 `set_token_links`）填入 `<META_CID>/preview.png`、`<META_CID>/reference.json`。

注意：`ipfs.io` 已改成只走 service worker gateway，程式抓不到原始檔，請用 `gateway.pinata.cloud` 等 gateway。

## 5. 前端

```bash
cd frontend
npm install
cp .env.example .env.local      # 填 VITE_CONTRACT_ID=seed.my-nft.testnet
npm run dev                     # http://localhost:5173
npm run build                   # 產出 dist/
```

- `npm run dev` / `build` 會先把 `../viewer` 和 `../examples` 複製到 `public/`，token 卡片的 iframe 預設用本站的 `examples/harmonious-donuts/index.html`。
  上傳 IPFS 後把 `VITE_VIEWER_URL` 設成 `https://<gateway>/ipfs/<VIEWER_CID>/index.html`。
- 錢包：`@near-wallet-selector/okx-wallet`（官方 module，讀 `window.okxwallet.near`，**只在桌面瀏覽器出現**）、Meteor、HOT、Ethereum 錢包。
  OKX 模組直接用全域 `Buffer`，所以 `src/polyfills.js` 補上。
- Mint 時附 `mint_price + VITE_STORAGE_BUFFER_NEAR`（預設 0.02 NEAR），合約會退回多的部分。
- 需要 Node 24 / npm 11：`package-lock.json` 是 npm 11 產生的，npm 10 的 `npm ci` 會判定不同步。
- **尚未實測**：OKX 擴充是否能在 testnet 簽交易。如果 OKX 只支援 mainnet，testnet demo 用 Meteor / HOT，OKX 等上 mainnet 再展示。

### Ethereum 錢包（MetaMask 等）

用官方 `@near-wallet-selector/ethereum-wallets`（NEP-518），設定在 [`frontend/src/eth.js`](frontend/src/eth.js)。
MetaMask 使用者的 NEAR 帳號就是自己的 `0x...` 地址（eth-implicit 帳戶），NFT 一樣 mint 在 NEAR 合約上。

- 錢包會被要求切到「NEAR Protocol Testnet」EVM 網路：chain id **398**，RPC `https://eth-rpc.testnet.near.org`
  （mainnet 是 397 / `https://eth-rpc.mainnet.near.org`）。第一次會跳出新增網路的確認。
- **不填 `VITE_REOWN_PROJECT_ID`**：只支援瀏覽器擴充（injected，例如 MetaMask），不需要任何金鑰。
- **填 `VITE_REOWN_PROJECT_ID`**（到 cloud.reown.com 免費申請）：多載入 Reown AppKit，支援 WalletConnect / 手機錢包 / 錢包清單。
  記得在 Reown 後台把你的網域（含 `localhost`、`javaing.github.io`）加入 allowlist。
- 限制：
  - 該 `0x` 帳戶在 NEAR testnet 上要有 NEAR 才能付價格和 storage。可以從其他 testnet 帳號轉 NEAR 給 `0x...` 帳號
    （例如 `near tokens my-nft.testnet send-near 0xabc... '1 NEAR' network-config testnet sign-with-keychain send`）。
  - 第一次交易前會做 relayer onboarding（加一把 FunctionCall access key），所以會多一筆簽名。
  - NEP-518 一筆交易只能有一個 action，多個 action 會拆成多筆依序送出（`nft_mint` 只有一個 action，不受影響）。
  - 只支援 EOA，不支援 smart account（Safe、email / social 登入）。
  - **尚未實測**：只確認選單出現「Ethereum Wallet」與 build 成功，還沒用真的 MetaMask 在 testnet 走完 mint。
- **Temple 的 Etherlink EVM 帳戶：未驗證。** 理論上任何注入 `window.ethereum` 的 EVM 錢包都能走 injected connector；
  Temple 的 EVM 帳戶要能用，前提是 Temple 有注入 EIP-1193 provider，並且接受新增 chain id 398 這個自訂網路
  （Etherlink 是另一條鏈，chain id 不同，這裡用不到 Etherlink 本身）。同一把私鑰在兩條鏈上的 `0x` 地址相同，
  所以連上後的 NEAR 帳號會跟 Etherlink 地址一樣。需要有裝 Temple 的瀏覽器才能實測。

## 6. 部署 demo

### GitHub Pages（已設定好）

`.github/workflows/pages.yml` 會在每次 push 到 `main` 時 build 前端並部署到
**https://javaing.github.io/seed-garden-near/**（範例頁在 `/examples/harmonious-donuts/grid.html`）。

1. repo **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**（已完成）。
2. 公開設定寫在 `frontend/.env.production`（目前 `VITE_CONTRACT_ID=nft.seed-garden.testnet`）。
   要覆蓋時，到 **Settings → Secrets and variables → Actions → Variables** 新增同名變數（例如 `VITE_REOWN_PROJECT_ID`），再按 **Run workflow**。
   這些都是公開值，用 Variables 不用 Secrets。

本機模擬 Pages 的子路徑：`npm run build -- --base=/seed-garden-near/ && npx vite preview --base=/seed-garden-near/`
（Git Bash 會把 `/seed-garden-near/` 轉成 Windows 路徑，前面加 `MSYS_NO_PATHCONV=1`，或改用 PowerShell。）

### Vercel（另一個選擇）

1. Vercel → New Project → 選 repo，**Root Directory 設 `frontend`**，Framework 選 Vite（Build `npm run build`、Output `dist`）。
   保持「Include source files outside of the Root Directory」開啟，因為 build 會讀 `../viewer` 和 `../examples`。
2. 在 Environment Variables 加 `VITE_NETWORK_ID`、`VITE_CONTRACT_ID`，以及選填的 `VITE_VIEWER_URL`、`VITE_REOWN_PROJECT_ID`。
3. Deploy。

## 範例：fxhash 舊作移植

`examples/harmonious-donuts/` 把 fxhash 上的 *Harmonious donuts* 接上 NEAR seed，並附 `grid.html` 一次比較多個 seed 的結果。詳見該資料夾的 README。

## 之後可以加的亮點（這版沒做）

- Chain Signatures：讓每個 NFT 擁有自己的跨鏈地址。
- web4：全鏈上展示頁。
- 依 seed 在鏈下產生每個 token 的預覽圖並用 `set_token_links` / 單獨的 metadata 更新流程寫回。

## 第三方授權

p5.js 採用 LGPL-2.1（見 `viewer/p5-LICENSE.txt`）。

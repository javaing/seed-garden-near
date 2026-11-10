# Seed Garden — NEAR 生成藝術 NFT（NEAR HACKATHON・`nfts` track）

每個 token 在 `nft_mint` 時由 `env::random_seed()` 產生一個 seed，存在 `TokenMetadata.extra`（`{"seed":"<64 hex>"}`）。
p5.js viewer 讀 `?seed=` 畫出確定性的作品：同一個 seed 一定畫出同一張圖。

```
seed-nft/
├─ contract/   Rust 合約：NEP-171 / 177 / 178 / 181 + NEP-199 版稅（nft_payout）
├─ frontend/   Vite + NEAR Wallet Selector（OKX Wallet、Meteor、HOT、Ethereum 錢包）
├─ viewer/     p5.js 展示頁（p5.min.js 已打包在同資料夾，可整包上傳 IPFS）
└─ metadata/   reference JSON 範例
```

> 只在 **testnet** 部署，不要用真實資金。

---

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

重開終端機後確認：

```bash
cargo --version && cargo near --version && near --version
```

已驗證版本：Rust 1.99.1、cargo-near 0.23.0、near-cli-rs 0.31.1、near-sdk 5.30.1。

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

---

## 2. 合約

### 建置

```bash
cd contract
cargo near build non-reproducible-wasm --no-abi
# 產出：$CARGO_TARGET_DIR/near/seed_nft.wasm（沒設 CARGO_TARGET_DIR 時在 contract/target/near/）
```

`--no-abi`：ABI 產生步驟會在主機上連結一個含有 NEAR host 函式的 DLL，Linux 可以但 Windows 連結器不接受未解析符號。
ABI 只是給工具看的描述檔，部署不需要；要 ABI 的話在 WSL2 / Linux 上拿掉 `--no-abi` 即可。

### 測試

```bash
cargo test
```

測試涵蓋：mint 後的 owner / metadata / seed 格式、mint 給別人、50 次 mint 的 seed 唯一性（含相同 random_seed 的情況）、
超過 max supply 失敗、押金不足價格失敗、押金不足 storage 失敗、多附押金退還且價格轉給 owner、
每次 mint 依實際 storage 用量退款、`nft_payout` 版稅分配、`nft_transfer_payout` 轉移。10 個全部通過。

每個 token 實際用掉約 540–690 bytes（約 0.0054–0.0069 NEAR）：同一個 owner 的第二個 token 不用再建 enumeration 集合，
所以用得比較少。這也是為什麼前端多附 0.05 NEAR、由合約依實際用量退回，而不是附一個剛好的固定值。

### 主要方法

| 方法 | 說明 |
| --- | --- |
| `new(owner_id, metadata, mint_price, max_supply, token_media?, token_reference?, royalties?)` | 初始化。`mint_price` 是 yoctoNEAR 字串；`royalties` 為 `{帳號: basis points}`，總和 ≤ 5000（50%）。 |
| `nft_mint(receiver_id?)` | payable。需附 `mint_price + storage 費`，多的退給呼叫者；價格轉給 owner。 |
| `mint_info()` | 價格、max supply、已 mint 數、每個 token 的 storage 押金估計。 |
| `set_token_links(token_media?, token_reference?)` | owner 更新之後 mint 的 media / reference。 |
| `nft_payout` / `nft_transfer_payout` | NEP-199。 |
| 其他 | `nft_transfer`、`nft_transfer_call`、`nft_token`、`nft_approve`、`nft_revoke(_all)`、`nft_is_approved`、`nft_total_supply`、`nft_tokens`、`nft_supply_for_owner`、`nft_tokens_for_owner`、`nft_metadata`。 |

**seed 怎麼來**：`sha256(random_seed || token_id || 付款帳號 || block_height)`。混入 token_id 保證不重複。
`random_seed` 對驗證者不是不可預測，所以只適合藝術變化，不要拿來做抽獎。

**metadata 放哪**：
- `media` — 預覽圖（PNG）。因為 seed 在 mint 時才決定，無法事先為每個 token 產生預覽，所以放整個系列共用的預覽圖。
- `reference` — 鏈外 JSON，內含 `animation_url`（互動版 viewer）。NEP-177 沒有 `animation_url` 欄位，所以放這裡。
- 合約層級 `base_uri` 設 IPFS gateway（例如 `https://gateway.pinata.cloud/ipfs`），`media` / `reference` 就能寫相對路徑 `<CID>/preview.png`，換 gateway 不用改鏈上資料。

---

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

---

## 4. 上傳 viewer 與 metadata 到 IPFS（Pinata）

1. 本機先看 viewer：用任何靜態伺服器開 `viewer/`，例如 `npx serve viewer`，打開 `http://localhost:3000/?seed=abc123...`。按 `s` 可存 PNG，可拿來當 `preview.png`。
2. 到 [Pinata](https://app.pinata.cloud) → Upload → **Folder**，選整個 `viewer/` 資料夾 → 得到 `VIEWER_CID`。
   確認 `https://gateway.pinata.cloud/ipfs/<VIEWER_CID>/index.html?seed=00ff...` 能正常顯示。
3. 複製 `metadata/reference.example.json` 成 `reference.json`，把 `<VIEWER_CID>` 換掉；
   和 `preview.png` 放同一個資料夾，再用 Pinata 上傳這個資料夾 → 得到 `META_CID`。
4. 部署時（或之後用 `set_token_links`）填入 `<META_CID>/preview.png`、`<META_CID>/reference.json`。

---

## 5. 前端

```bash
cd frontend
npm install
cp .env.example .env.local      # 填 VITE_CONTRACT_ID=seed.my-nft.testnet
npm run dev                     # http://localhost:5173
npm run build                   # 產出 dist/
```

- `npm run dev` / `build` 會先把 `../viewer` 複製到 `public/viewer`，所以 token 卡片的 iframe 預設用本站 `/viewer/index.html`。
  上傳 IPFS 後把 `VITE_VIEWER_URL` 設成 `https://<gateway>/ipfs/<VIEWER_CID>/index.html`。
- 錢包：`@near-wallet-selector/okx-wallet`（官方 module，讀 `window.okxwallet.near`，**只在桌面瀏覽器出現**）、Meteor、HOT。
  OKX 模組直接用全域 `Buffer`，所以 `src/polyfills.js` 補上。
- Mint 時附 `mint_price + VITE_STORAGE_BUFFER_NEAR`（預設 0.05 NEAR），合約會退回多的部分。
- **尚未實測**：OKX 擴充是否能在 testnet 簽交易（手邊沒有裝擴充的環境）。如果 OKX 只支援 mainnet，testnet demo 用 Meteor / HOT，OKX 等上 mainnet 再展示。

### Ethereum 錢包（MetaMask 等）

用官方 `@near-wallet-selector/ethereum-wallets`（NEP-518），設定在 [`frontend/src/eth.js`](frontend/src/eth.js)。
MetaMask 使用者的 NEAR 帳號就是自己的 `0x...` 地址（eth-implicit 帳戶），NFT 一樣 mint 在 NEAR 合約上。

- 錢包會被要求切到「NEAR Protocol Testnet」EVM 網路：chain id **398**，RPC `https://eth-rpc.testnet.near.org`
  （mainnet 是 397 / `https://eth-rpc.mainnet.near.org`）。第一次會跳出新增網路的確認。
- **不填 `VITE_REOWN_PROJECT_ID`**：只支援瀏覽器擴充（injected，例如 MetaMask），不需要任何金鑰。
- **填 `VITE_REOWN_PROJECT_ID`**（到 cloud.reown.com 免費申請）：多載入 Reown AppKit，支援 WalletConnect / 手機錢包 / 錢包清單。
  記得在 Reown 後台把你的網域（含 `localhost` 與 Vercel 網址）加入 allowlist。
- 限制：
  - 該 `0x` 帳戶在 NEAR testnet 上要有 NEAR 才能付價格和 storage。可以從其他 testnet 帳號轉 NEAR 給 `0x...` 帳號
    （例如 `near tokens my-nft.testnet send-near 0xabc... '1 NEAR' network-config testnet sign-with-keychain send`）。
  - 第一次交易前會做 relayer onboarding（加一把 FunctionCall access key），所以會多一筆簽名。
  - NEP-518 一筆交易只能有一個 action，多個 action 會拆成多筆依序送出（`nft_mint` 只有一個 action，不受影響）。
  - 只支援 EOA，不支援 smart account（Safe、email / social 登入）。
  - **尚未實測**：我們只確認選單出現「Ethereum Wallet」與 build 成功，還沒用真的 MetaMask 在 testnet 走完 mint。
- **Temple 的 Etherlink EVM 帳戶：未驗證。** 理論上任何注入 `window.ethereum` 的 EVM 錢包都能走 injected connector；
  Temple 的 EVM 帳戶要能用，前提是 Temple 有注入 EIP-1193 provider，並且接受新增 chain id 398 這個自訂網路
  （Etherlink 是另一條鏈，chain id 不同，這裡用不到 Etherlink 本身）。同一把私鑰在兩條鏈上的 `0x` 地址相同，
  所以連上後的 NEAR 帳號會跟 Etherlink 地址一樣。需要有裝 Temple 的瀏覽器才能實測。

### 部署到 Vercel

1. 把 repo 推到 GitHub（目前還沒公開，要公開前先確認）。
2. Vercel → New Project → 選 repo，**Root Directory 設 `frontend`**，Framework 選 Vite（Build `npm run build`、Output `dist`）。
   保持「Include source files outside of the Root Directory」開啟，因為 build 會讀 `../viewer`。
3. 在 Environment Variables 加 `VITE_NETWORK_ID`、`VITE_CONTRACT_ID`，以及選填的 `VITE_VIEWER_URL`、`VITE_REOWN_PROJECT_ID`。
4. Deploy。

---

## 之後可以加的亮點（這版沒做）

- Chain Signatures：讓每個 NFT 擁有自己的跨鏈地址。
- web4：全鏈上展示頁。
- 依 seed 在鏈下產生每個 token 的預覽圖並用 `set_token_links` / 單獨的 metadata 更新流程寫回。

---

## 範例：fxhash 舊作移植

`examples/harmonious-donuts/` 把 fxhash 上的 *Harmonious donuts* 接上 NEAR seed，並附 `grid.html` 一次比較多個 seed 的結果。詳見該資料夾的 README。

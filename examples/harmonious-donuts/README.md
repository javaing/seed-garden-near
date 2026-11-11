# Harmonious donuts（fxhash 舊作）× NEAR seed

來源：fxhash 上的 *Harmonious donuts #47*（objkt.com/tokens/fxhash/913767），artifact CID `QmV3ee1CPtnH2gefQAWbwGWSNYLaAMKJXmCgnf245ZqRzr`。
用來示範「同一份 p5.js 程式，換不同 seed 會長出什麼」。

| 檔案 | 說明 |
| --- | --- |
| `sketch.original.js` | 原作程式碼，一字未改 |
| `sketch.js` | 改了兩處讓結果完全由 seed 決定（見下） |
| `seed-shim.js` | 取代 fxhash snippet，提供同樣的 `fxhash` / `fxrand()` / `fxpreview()`。吃 `?seed=<hex>`（NEAR）或 `?fxhash=<base58>`（原作） |
| `bundle.js`、`style.css`、`p5.min.js` | 原作附帶檔案（bundle.js 會先用掉 6 次 `fxrand()`，保留它亂數順序才會跟 fxhash 上一致） |
| `grid.html` | 一次看 9 個隨機 seed、顯示每格的 features，可重抽、可切 Sunday 模式、可看原作 hash |

## 為什麼要改 `sketch.js`

NFT 的前提是「同 seed → 同作品」，原作有兩個地方不符合：

1. 自訂的 `shuffle()` 用 `Math.random()`。後來比對發現：p5 global mode 載入時會把所有 p5 函式複製到 `window`，蓋掉作品自己宣告的 `shuffle()`，所以原作實際上一直用 p5 內建、由 `randomSeed` 決定的 shuffle，本來就是確定性的。`sketch.js` 裡改成 `fxrand()` 的版本因此不會被執行；mini-p5 也照 p5 的行為覆蓋它。
2. `isSunday` 看觀看當天是不是星期日 → 同一個 token 週日看起來不一樣。改成只由 `?sunday=1` 開啟。
   （如果想保留「週日彩蛋」這個概念，也可以改由 seed 決定，例如 `fxrand() < 1/7`。）

另外原作的畫布大小跟著視窗走，甜甜圈半徑卻是固定 70px，所以不同螢幕構圖不同；線上版改成固定 800×800 再縮放（見下方「線上版的額外調整」）。

## 本機看

用任何靜態伺服器開這個資料夾，例如在 `frontend/` 裡：

```bash
npx vite ../examples --port 5174
```

然後開 `http://localhost:5174/harmonious-donuts/grid.html`。

## 接到 NEAR 合約

合約 mint 時存的是 `extra = {"seed":"<64 hex>"}`。把這個資料夾整包上傳 IPFS，iframe 指向 `index.html?seed=<hex>` 就能顯示，
也就是把前端的 `VITE_VIEWER_URL` 設成 `https://<gateway>/ipfs/<CID>/index.html`。
`seed-shim.js` 只取 hex 的前 128 bits 當 sfc32 的 4 個狀態。

## 線上版的額外調整

- 畫布固定 800×800 內部解析度，用 CSS 縮放到視窗（`style.css` 末段）。原作依視窗大小建畫布，嵌在 iframe 裡會變很小，而且同一個 seed 在不同螢幕上構圖不同。
- `?embed=1` 時點擊作品不會下載 PNG（前端的 iframe 會帶這個參數）；單獨開啟時保留原本「點擊存圖」的行為。

## 全鏈上版本（web4）

- `mini-p5.js`：只實作這件作品用到的 p5.js 1.x 函式（約 6 KB），random / noise / 顏色 / 繪圖都照 p5 原始碼，畫面與 p5.min.js 逐像素相同。
- `onchain.html`：`node contract/web4/build.mjs` 產生，跟合約 `web4_get` 回傳的頁面完全一樣（mini-p5、seed shim、sketch 全部 inline，約 16 KB）。
- `compare.html`：左邊 p5.min.js、右邊 mini-p5，把每個 seed 跑到最後一格再逐像素比對。可加 `?seeds=hex1,hex2` 或 `&sunday=1`。

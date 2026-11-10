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

1. 自訂的 `shuffle()` 用 `Math.random()` → 顏色順序每次重新整理都不同。改成 `fxrand()`。
2. `isSunday` 看觀看當天是不是星期日 → 同一個 token 週日看起來不一樣。改成只由 `?sunday=1` 開啟。
   （如果想保留「週日彩蛋」這個概念，也可以改由 seed 決定，例如 `fxrand() < 1/7`。）

另外原作的甜甜圈半徑是固定像素（70px），視窗越小佔畫面越大；要讓縮圖與全螢幕構圖一致，可改用 `min(width,height)` 比例。這裡沒改。

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

// 把 ../viewer 與 ../examples 複製到 public/，讓 dev server、build、GitHub Pages 都能直接用：
//   <base>/viewer/index.html?seed=...          token 卡片的 iframe
//   <base>/examples/harmonious-donuts/grid.html  fxhash 舊作的 seed 範例
// 正式上線時 viewer 也可以改用 VITE_VIEWER_URL 指向 IPFS。
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

for (const name of ['viewer', 'examples']) {
  const src = fileURLToPath(new URL(`../../${name}`, import.meta.url));
  const dst = fileURLToPath(new URL(`../public/${name}`, import.meta.url));
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true, filter: (p) => !p.includes('.vite') });
  console.log(`${name} copied ->`, dst);
}

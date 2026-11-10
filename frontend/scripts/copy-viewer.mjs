// 把 ../viewer 複製到 public/viewer，讓 dev server 與 build 都能用 /viewer/index.html 嵌入。
// 正式上線時可改用 VITE_VIEWER_URL 指向 IPFS 上的 viewer。
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = fileURLToPath(new URL('../../viewer', import.meta.url));
const dst = fileURLToPath(new URL('../public/viewer', import.meta.url));
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log('viewer copied ->', dst);

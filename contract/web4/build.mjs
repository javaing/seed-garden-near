// 把 Harmonious donuts 打包成單一 HTML（mini-p5 + seed shim + sketch 全部 inline），給合約的 web4_get 用。
// 用法（repo 根目錄）：node contract/web4/build.mjs
// 產出：contract/web4/art.html（include_str! 進合約）與 examples/harmonious-donuts/onchain.html（本機比對用）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const art = join(root, 'examples', 'harmonious-donuts');
const read = (f) => readFileSync(join(art, f), 'utf8');
const dropLineComments = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').trim();
const dropCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n+/g, '\n').trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harmonious donuts</title>
<style>
${dropCssComments(read('style.css'))}
</style>
<script>window.__SEED__="";</script>
<script>
${dropLineComments(read('seed-shim.js'))}
</script>
<script>
${read('mini-p5.js').trim()}
</script>
</head>
<body>
<script>
${read('sketch.js').trim()}
</script>
<script>for(var i=0;i<6;i++)fxrand();/* the original fxhash bundle.js consumed 6 values here */</script>
</body>
</html>
`;

writeFileSync(join(root, 'contract', 'web4', 'art.html'), html);
writeFileSync(join(art, 'onchain.html'), html);
console.log(`art.html ${Buffer.byteLength(html)} bytes`);

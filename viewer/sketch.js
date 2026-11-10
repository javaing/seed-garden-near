// Seed Garden — 由 ?seed=<64 hex> 決定的確定性生成藝術（flow field）。
// 同一個 seed 永遠畫出同一張圖，與視窗大小無關（以 0..1 的正規化座標計算）。
// 參數：?seed=<hex>  &clean=1（隱藏 seed 文字）

const params = new URLSearchParams(location.search);
const rawSeed = (params.get('seed') || '').toLowerCase().replace(/^0x/, '');
const SEED = /^[0-9a-f]{8,}$/.test(rawSeed) ? rawSeed : '0'.repeat(64);
if (params.get('clean') === '1') document.body.classList.add('clean');
document.getElementById('seed').textContent = 'seed ' + SEED.slice(0, 16) + '…';

// --- 確定性 PRNG：sfc32，以 seed 的前 16 bytes 當 4 個 32-bit 狀態 ---
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
const words = [0, 1, 2, 3].map((i) => parseInt(SEED.padEnd(32, '0').slice(i * 8, i * 8 + 8), 16));
const rand = sfc32(...words);
for (let i = 0; i < 16; i++) rand(); // 暖機
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const range = (lo, hi) => lo + rand() * (hi - lo);

const PALETTES = [
  { bg: '#0b0b10', ink: ['#f72585', '#7209b7', '#3a0ca3', '#4cc9f0'] },
  { bg: '#f4efe6', ink: ['#264653', '#2a9d8f', '#e9c46a', '#e76f51'] },
  { bg: '#101820', ink: ['#fee715', '#f2aa4c', '#ffffff'] },
  { bg: '#0d1b2a', ink: ['#e0e1dd', '#778da9', '#415a77'] },
  { bg: '#1a1423', ink: ['#ff9f1c', '#ffbf69', '#cbf3f0', '#2ec4b6'] },
  { bg: '#fffcf2', ink: ['#252422', '#eb5e28', '#403d39'] },
];

// 由 seed 決定的特徵（traits）
const TRAITS = {
  palette: pick(PALETTES),
  noiseScale: range(1.2, 4.5),
  curl: range(0.6, 2.4),
  particles: Math.floor(range(500, 1400)),
  steps: Math.floor(range(90, 220)),
  weight: range(0.0015, 0.004),
  symmetry: rand() < 0.25,
  noiseSeed: Math.floor(rand() * 2 ** 31),
};
window.SEED_TRAITS = TRAITS; // 方便前端或除錯讀取

let particles = [];
let step = 0;
let S = 0; // canvas 邊長

function makeParticles() {
  const r = sfc32(words[3], words[2], words[1], words[0] ^ 0x9e3779b9);
  particles = Array.from({ length: TRAITS.particles }, () => ({
    x: r(), y: r(), c: TRAITS.palette.ink[Math.floor(r() * TRAITS.palette.ink.length)],
  }));
}

function setup() {
  S = Math.min(windowWidth, windowHeight);
  createCanvas(S, S);
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  noiseSeed(TRAITS.noiseSeed);
  restart();
}

function restart() {
  step = 0;
  makeParticles();
  background(TRAITS.palette.bg);
  loop();
}

function draw() {
  const perFrame = 6;
  strokeWeight(Math.max(0.5, TRAITS.weight * S));
  for (let k = 0; k < perFrame && step < TRAITS.steps; k++, step++) {
    for (const p of particles) {
      const n = noise(p.x * TRAITS.noiseScale, p.y * TRAITS.noiseScale, step * 0.002);
      const a = n * TWO_PI * TRAITS.curl;
      const nx = p.x + Math.cos(a) * 0.0025;
      const ny = p.y + Math.sin(a) * 0.0025;
      const col = color(p.c);
      col.setAlpha(150);
      stroke(col);
      line(p.x * S, p.y * S, nx * S, ny * S);
      if (TRAITS.symmetry) line((1 - p.x) * S, p.y * S, (1 - nx) * S, ny * S);
      p.x = nx; p.y = ny;
    }
  }
  if (step >= TRAITS.steps) noLoop();
}

function windowResized() {
  S = Math.min(windowWidth, windowHeight);
  resizeCanvas(S, S);
  restart();
}

// 按 s 存成 PNG（可拿來當 media 預覽圖）
function keyPressed() {
  if (key === 's') saveCanvas('seed-' + SEED.slice(0, 8), 'png');
}

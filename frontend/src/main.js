import './polyfills.js';
import './style.css';
import {
  CONTRACT_ID,
  NETWORK_ID,
  initWallet,
  mint,
  nearToYocto,
  view,
  viewAccount,
  yoctoToNear,
} from './near.js';

const VIEWER_URL =
  import.meta.env.VITE_VIEWER_URL || `${import.meta.env.BASE_URL}viewer/index.html`;
const STORAGE_BUFFER = nearToYocto(import.meta.env.VITE_STORAGE_BUFFER_NEAR || '0.02');

const $ = (id) => document.getElementById(id);
const els = {
  network: $('network'),
  contract: $('contract'),
  account: $('account'),
  connect: $('connect'),
  disconnect: $('disconnect'),
  mint: $('mint'),
  mintInfo: $('mint-info'),
  status: $('status'),
  tokens: $('tokens'),
  demo: $('demo'),
};

let selector;
let modal;
let accountId = null;
let mintInfo = null;

function setStatus(msg, kind = '') {
  els.status.textContent = msg;
  els.status.dataset.kind = kind;
}

function seedOf(token) {
  try {
    return JSON.parse(token.metadata?.extra || '{}').seed || null;
  } catch {
    return null;
  }
}

function viewerSrc(seed) {
  const sep = VIEWER_URL.includes('?') ? '&' : '?';
  return `${VIEWER_URL}${sep}seed=${encodeURIComponent(seed)}`;
}

function tokenCard(token) {
  const seed = seedOf(token);
  const card = document.createElement('article');
  card.className = 'card';
  const frame = document.createElement('iframe');
  frame.title = token.metadata?.title || `Token ${token.token_id}`;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  if (seed) frame.src = viewerSrc(seed);
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `<strong></strong><code></code>`;
  meta.querySelector('strong').textContent = token.metadata?.title || `#${token.token_id}`;
  meta.querySelector('code').textContent = seed ? seed.slice(0, 16) + '…' : '(no seed)';
  card.append(frame, meta);
  return card;
}

async function loadMintInfo() {
  try {
    mintInfo = await view('mint_info');
    const total = BigInt(mintInfo.price) + STORAGE_BUFFER;
    els.mintInfo.textContent =
      `價格 ${yoctoToNear(mintInfo.price)} NEAR ・ 已 mint ${mintInfo.minted} / ${mintInfo.max_supply}` +
      ` ・ 送出 ${yoctoToNear(total)} NEAR（含 storage 押金，多的會退）`;
  } catch (e) {
    mintInfo = null;
    els.mintInfo.textContent = `讀不到合約 ${CONTRACT_ID}：請確認已部署並設定 VITE_CONTRACT_ID`;
    console.warn(e);
  }
  render();
}

async function loadTokens() {
  els.tokens.replaceChildren();
  if (!accountId) {
    els.tokens.innerHTML = '<p class="muted">連線錢包後顯示你持有的 token。</p>';
    return;
  }
  try {
    const tokens = await view('nft_tokens_for_owner', {
      account_id: accountId,
      from_index: '0',
      limit: 50,
    });
    if (!tokens.length) {
      els.tokens.innerHTML = '<p class="muted">還沒有 token，mint 一個吧。</p>';
      return;
    }
    els.tokens.append(...tokens.reverse().map(tokenCard));
  } catch (e) {
    els.tokens.innerHTML = '<p class="muted">讀取 token 失敗（合約可能還沒部署）。</p>';
    console.warn(e);
  }
}

// implicit 帳號（64 hex）與 0x 帳號很長，頁首只顯示頭尾，完整帳號放在 tooltip
function shortAccount(id) {
  return id.length > 24 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function render() {
  els.account.textContent = accountId ? shortAccount(accountId) : '未連線';
  els.account.title = accountId || '';
  els.connect.hidden = !!accountId;
  els.disconnect.hidden = !accountId;
  const soldOut = mintInfo && mintInfo.minted >= mintInfo.max_supply;
  els.mint.disabled = !accountId || !mintInfo || soldOut;
  els.mint.textContent = soldOut ? '已售完' : 'Mint';
}

async function onMint() {
  if (!mintInfo) return;
  const deposit = BigInt(mintInfo.price) + STORAGE_BUFFER;
  els.mint.disabled = true;
  try {
    // 先確認帳號在這個網路上存在且餘額足夠，避免錢包簽完才收到看不懂的 RPC 錯誤
    const acct = await viewAccount(accountId);
    if (!acct) {
      setStatus(
        `帳號 ${shortAccount(accountId)} 在 ${NETWORK_ID} 上不存在。` +
          `請把錢包切到 ${NETWORK_ID}，或先轉一點 ${NETWORK_ID} NEAR 給這個帳號。`,
        'error',
      );
      return;
    }
    const gasReserve = nearToYocto('0.01');
    if (BigInt(acct.amount) < deposit + gasReserve) {
      setStatus(
        `${NETWORK_ID} 餘額 ${yoctoToNear(acct.amount)} NEAR，不夠 mint（需要約 ${yoctoToNear(deposit + gasReserve)} NEAR）。`,
        'error',
      );
      return;
    }
    setStatus('等待錢包簽署…');
    await mint(selector, deposit);
    setStatus('Mint 成功！', 'ok');
    await Promise.all([loadMintInfo(), loadTokens()]);
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    const hint = /Exceeded \d+ providers/.test(msg)
      ? `RPC 拒絕了這筆交易。常見原因：錢包目前在別的網路（請切到 ${NETWORK_ID}），或餘額不足。`
      : msg;
    setStatus('Mint 失敗：' + hint, 'error');
  } finally {
    render();
  }
}

async function main() {
  els.network.textContent = NETWORK_ID;
  els.contract.textContent = CONTRACT_ID;
  els.demo.src = viewerSrc('5eed' + '0123456789abcdef'.repeat(3) + 'cafe1234ba5e');

  ({ selector, modal } = await initWallet());
  window.__nearSelector = selector; // 除錯用

  const syncAccount = () => {
    const accounts = selector.store.getState().accounts;
    accountId = accounts.find((a) => a.active)?.accountId || null;
    render();
    loadTokens();
  };
  selector.store.observable.subscribe(syncAccount);
  syncAccount();

  els.connect.onclick = () => modal.show();
  els.disconnect.onclick = async () => {
    const wallet = await selector.wallet();
    await wallet.signOut();
    setStatus('已斷線');
  };
  els.mint.onclick = onMint;

  await loadMintInfo();
}

main().catch((e) => {
  console.error(e);
  setStatus('初始化失敗：' + e.message, 'error');
});

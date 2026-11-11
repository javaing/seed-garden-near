import './polyfills.js';
import './style.css';
import {
  CONTRACT_ID,
  EXPLORER_URL,
  NETWORK_ID,
  switchNetwork,
  initWallet,
  mint,
  nearToYocto,
  view,
  viewAccount,
  yoctoToNear,
} from './near.js';

const VIEWER_URL =
  import.meta.env.VITE_VIEWER_URL || `${import.meta.env.BASE_URL}examples/harmonious-donuts/index.html`;
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
  walletNote: $('wallet-note'),
  banner: $('mainnet-banner'),
};

const WALLET_NOTES = {
  testnet:
    'On testnet, use <strong>Meteor Wallet</strong> (free testnet account at wallet.meteorwallet.app). ' +
    'OKX and MetaMask (NEP-518) are wired in but do not work on testnet yet.',
  mainnet: 'On mainnet, OKX, Meteor, HOT and MetaMask all sign with real NEAR.',
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
  // embed=1：嵌入時停用作品裡「點擊存 PNG」的行為
  return `${VIEWER_URL}${sep}seed=${encodeURIComponent(seed)}&embed=1`;
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
  if (!CONTRACT_ID) {
    mintInfo = null;
    els.mintInfo.textContent = `The ${NETWORK_ID} contract is not deployed yet. Switch to testnet to try minting.`;
    render();
    return;
  }
  try {
    mintInfo = await view('mint_info');
    const total = BigInt(mintInfo.price) + STORAGE_BUFFER;
    els.mintInfo.textContent =
      `Price ${yoctoToNear(mintInfo.price)} NEAR · Minted ${mintInfo.minted} / ${mintInfo.max_supply}` +
      ` · You send ${yoctoToNear(total)} NEAR (incl. storage deposit; unused part is refunded)`;
  } catch (e) {
    mintInfo = null;
    els.mintInfo.textContent = `Cannot read contract ${CONTRACT_ID}. Check that it is deployed on ${NETWORK_ID}.`;
    console.warn(e);
  }
  render();
}

let tokensRequest = 0;

async function loadTokens() {
  // 帳號變動時 store 會連續觸發好幾次；只讓最後一次請求寫進畫面，避免重複的卡片
  const req = ++tokensRequest;
  const owner = accountId;
  if (!owner || !CONTRACT_ID) {
    els.tokens.innerHTML = CONTRACT_ID
      ? '<p class="muted">Connect a wallet to see the tokens you own.</p>'
      : `<p class="muted">No ${NETWORK_ID} contract yet.</p>`;
    return;
  }
  try {
    const tokens = await view('nft_tokens_for_owner', {
      account_id: owner,
      from_index: '0',
      limit: 50,
    });
    if (req !== tokensRequest) return;
    if (!tokens.length) {
      els.tokens.innerHTML = '<p class="muted">No tokens yet. Mint one!</p>';
      return;
    }
    els.tokens.replaceChildren(...tokens.reverse().map(tokenCard));
  } catch (e) {
    if (req !== tokensRequest) return;
    els.tokens.innerHTML = '<p class="muted">Could not load tokens (is the contract deployed?).</p>';
    console.warn(e);
  }
}

// implicit 帳號（64 hex）與 0x 帳號很長，頁首只顯示頭尾，完整帳號放在 tooltip
function shortAccount(id) {
  return id.length > 24 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function render() {
  els.account.textContent = accountId ? shortAccount(accountId) : 'Not connected';
  els.account.title = accountId || '';
  els.connect.hidden = !!accountId;
  els.disconnect.hidden = !accountId;
  const soldOut = mintInfo && mintInfo.minted >= mintInfo.max_supply;
  els.mint.disabled = !accountId || !mintInfo || soldOut;
  els.mint.textContent = soldOut ? 'Sold out' : 'Mint';
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
        `Account ${shortAccount(accountId)} does not exist on ${NETWORK_ID}. ` +
          `Switch your wallet to ${NETWORK_ID}, or send some ${NETWORK_ID} NEAR to this account first.`,
        'error',
      );
      return;
    }
    const gasReserve = nearToYocto('0.01');
    if (BigInt(acct.amount) < deposit + gasReserve) {
      setStatus(
        `Your ${NETWORK_ID} balance is ${yoctoToNear(acct.amount)} NEAR; minting needs about ${yoctoToNear(deposit + gasReserve)} NEAR.`,
        'error',
      );
      return;
    }
    setStatus('Waiting for wallet signature…');
    await mint(selector, deposit);
    setStatus('Minted! Your new token is below.', 'ok');
    await Promise.all([loadMintInfo(), loadTokens()]);
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    const hint = /Exceeded \d+ providers/.test(msg)
      ? `The RPC rejected the transaction. Usually the wallet is on another network (switch to ${NETWORK_ID}) or the balance is too low.`
      : msg;
    setStatus('Mint failed: ' + hint, 'error');
  } finally {
    render();
  }
}

async function main() {
  els.network.value = NETWORK_ID;
  els.banner.hidden = NETWORK_ID !== 'mainnet';
  els.walletNote.innerHTML = WALLET_NOTES[NETWORK_ID];
  els.contract.querySelector('code').textContent = CONTRACT_ID || '(not deployed yet)';
  if (CONTRACT_ID) els.contract.href = `${EXPLORER_URL}/address/${CONTRACT_ID}`;
  else els.contract.removeAttribute('href');
  document.title = NETWORK_ID === 'mainnet' ? 'Seed Garden' : 'Seed Garden (testnet)';
  els.demo.src = viewerSrc('5eed' + '0123456789abcdef'.repeat(3) + 'cafe1234ba5e');

  els.network.onchange = () => {
    els.network.disabled = true;
    setStatus(`Switching to ${els.network.value}…`);
    switchNetwork(selector, els.network.value);
  };

  ({ selector, modal } = await initWallet());
  window.__nearSelector = selector; // 除錯用

  // 錢包登入狀態存在 localStorage、不分網路；用網址直接切網路時，把另一個網路留下的登入清掉
  const LAST = 'seed-garden:signed-in-network';
  try {
    const last = localStorage.getItem(LAST);
    if (last && last !== NETWORK_ID && selector.isSignedIn()) await (await selector.wallet()).signOut();
    localStorage.setItem(LAST, NETWORK_ID);
  } catch (e) {
    console.warn(e);
  }

  const syncAccount = () => {
    const accounts = selector.store.getState().accounts;
    const next = accounts.find((a) => a.active)?.accountId || null;
    const changed = next !== accountId;
    accountId = next;
    render();
    if (changed || !els.tokens.hasChildNodes()) loadTokens();
  };
  selector.store.observable.subscribe(syncAccount);
  syncAccount();

  els.connect.onclick = () => modal.show();
  els.disconnect.onclick = async () => {
    const wallet = await selector.wallet();
    await wallet.signOut();
    setStatus('Disconnected');
  };
  els.mint.onclick = onMint;

  await loadMintInfo();
}

main().catch((e) => {
  console.error(e);
  setStatus('Failed to initialize: ' + e.message, 'error');
});

import { setupWalletSelector, actionCreators } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupOKXWallet } from '@near-wallet-selector/okx-wallet';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupHotWallet } from '@near-wallet-selector/hot-wallet';
import '@near-wallet-selector/modal-ui/styles.css';
import { setupEthereumModule } from './eth.js';

// 網路在執行期決定：?network= > 上次選的（localStorage）> build 時的 VITE_NETWORK_ID。
// 換網路要重新載入頁面（wallet selector 只能在初始化時指定網路）。
export const NETWORKS = ['testnet', 'mainnet'];
const DEFAULT_NETWORK = import.meta.env.VITE_NETWORK_ID || 'testnet';
const NETWORK_KEY = 'seed-garden:network';

function pickNetwork() {
  const fromUrl = new URLSearchParams(location.search).get('network');
  if (NETWORKS.includes(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(NETWORK_KEY);
    if (NETWORKS.includes(saved)) return saved;
  } catch {}
  return NETWORKS.includes(DEFAULT_NETWORK) ? DEFAULT_NETWORK : 'testnet';
}

export const NETWORK_ID = pickNetwork();

const env = import.meta.env;
const CONTRACTS = {
  testnet: env.VITE_CONTRACT_ID_TESTNET || (DEFAULT_NETWORK === 'testnet' ? env.VITE_CONTRACT_ID : '') || '',
  mainnet: env.VITE_CONTRACT_ID_MAINNET || (DEFAULT_NETWORK === 'mainnet' ? env.VITE_CONTRACT_ID : '') || '',
};
const RPCS = {
  testnet: env.VITE_RPC_URL_TESTNET || 'https://rpc.testnet.near.org',
  mainnet: env.VITE_RPC_URL_MAINNET || 'https://rpc.mainnet.near.org',
};

/** 這個網路的合約；還沒部署（沒設定）時是空字串。 */
export const CONTRACT_ID = CONTRACTS[NETWORK_ID];
export const RPC_URL = RPCS[NETWORK_ID];
/**
 * web4 網址：合約自己回傳的作品頁（https://<contract>.page）。
 * web4 gateway 只支援一層的帳號（x.testnet / x.near），子帳號（a.b.near）沒有憑證，所以那種情況回傳空字串。
 */
export const WEB4_URL =
  CONTRACT_ID && CONTRACT_ID.split('.').length === 2 ? `https://${CONTRACT_ID}.page` : '';
export const EXPLORER_URL =
  NETWORK_ID === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';

/** 換網路：先登出目前錢包（帳號屬於另一個網路），記住選擇，再重新載入。 */
export async function switchNetwork(selector, next) {
  if (!NETWORKS.includes(next) || next === NETWORK_ID) return;
  try {
    if (selector?.isSignedIn()) await (await selector.wallet()).signOut();
  } catch (e) {
    console.warn('sign out before switching network failed', e);
  }
  try {
    localStorage.setItem(NETWORK_KEY, next);
  } catch {}
  const url = new URL(location.href);
  url.searchParams.set('network', next);
  location.replace(url);
}

const YOCTO = 10n ** 24n;
export const MINT_GAS = 100_000_000_000_000n; // 100 Tgas

export function nearToYocto(near) {
  const [whole, frac = ''] = String(near).split('.');
  return BigInt(whole || '0') * YOCTO + BigInt((frac + '0'.repeat(24)).slice(0, 24));
}

export function yoctoToNear(yocto, digits = 4) {
  const v = BigInt(yocto);
  const whole = v / YOCTO;
  const frac = (v % YOCTO).toString().padStart(24, '0').slice(0, digits).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** 唯讀呼叫（不需要錢包），直接打 JSON-RPC。 */
export async function view(methodName, args = {}) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'view',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: CONTRACT_ID,
        method_name: methodName,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.data || json.error.message);
  if (json.result?.error) throw new Error(json.result.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
}

/** 查帳號；在這個網路上不存在時回傳 null。 */
export async function viewAccount(accountId) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'acct',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    }),
  });
  const json = await res.json();
  if (json.error) {
    if (json.error.cause?.name === 'UNKNOWN_ACCOUNT') return null;
    throw new Error(json.error.data || json.error.message);
  }
  return json.result;
}

export async function initWallet() {
  const selector = await setupWalletSelector({
    network: NETWORK_ID,
    languageCode: 'en', // 錢包選單固定英文（預設跟隨瀏覽器語言；modal 會讀這個設定）
    // 讓 store 記住 contract，OKX 模組送交易時需要
    // 沒有合約時不要求 function-call key（mainnet 尚未部署時仍可連錢包）
    ...(CONTRACT_ID ? { createAccessKeyFor: { contractId: CONTRACT_ID, methodNames: [] } } : {}),
    modules: [
      setupOKXWallet(), // OKX Wallet 瀏覽器擴充（window.okxwallet.near，僅桌面版）
      setupMeteorWallet(),
      setupHotWallet(),
      // MetaMask 等 Ethereum 錢包（0x eth-implicit 帳戶，NEP-518）
      await setupEthereumModule(NETWORK_ID),
    ],
  });
  const modal = setupModal(selector, {
    contractId: CONTRACT_ID || undefined,
    theme: 'auto',
    description: 'Choose a wallet to connect to NEAR ' + NETWORK_ID,
  });
  return { selector, modal };
}

export async function mint(selector, depositYocto) {
  const wallet = await selector.wallet();
  return wallet.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions: [actionCreators.functionCall('nft_mint', {}, MINT_GAS, BigInt(depositYocto))],
  });
}

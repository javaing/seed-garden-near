import { setupWalletSelector, actionCreators } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupOKXWallet } from '@near-wallet-selector/okx-wallet';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupHotWallet } from '@near-wallet-selector/hot-wallet';
import '@near-wallet-selector/modal-ui/styles.css';
import { setupEthereumModule } from './eth.js';

export const NETWORK_ID = import.meta.env.VITE_NETWORK_ID || 'testnet';
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'seed-nft.your-account.testnet';
export const RPC_URL =
  import.meta.env.VITE_RPC_URL ||
  (NETWORK_ID === 'mainnet' ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org');

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

export async function initWallet() {
  const selector = await setupWalletSelector({
    network: NETWORK_ID,
    // 讓 store 記住 contract，OKX 模組送交易時需要
    createAccessKeyFor: { contractId: CONTRACT_ID, methodNames: [] },
    modules: [
      setupOKXWallet(), // OKX Wallet 瀏覽器擴充（window.okxwallet.near，僅桌面版）
      setupMeteorWallet(),
      setupHotWallet(),
      // MetaMask 等 Ethereum 錢包（0x eth-implicit 帳戶，NEP-518）
      await setupEthereumModule(NETWORK_ID),
    ],
  });
  const modal = setupModal(selector, {
    contractId: CONTRACT_ID,
    theme: 'auto',
    description: '選擇錢包連線到 NEAR ' + NETWORK_ID,
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

// Ethereum 錢包（MetaMask 等）透過 NEP-518 在 NEAR 上簽交易。
// 使用者的 NEAR 帳號是 0x... 的 eth-implicit 帳戶，NFT 仍然 mint 在 NEAR 合約上。
//
// - 沒設 VITE_REOWN_PROJECT_ID：只用 injected connector（MetaMask 等瀏覽器擴充），不需要任何金鑰。
// - 有設 VITE_REOWN_PROJECT_ID：另外載入 Reown AppKit（WalletConnect、手機錢包、錢包清單）。
import { createConfig, http } from '@wagmi/core';
import { injected, walletConnect } from '@wagmi/connectors';
import { setupEthereumWallets } from '@near-wallet-selector/ethereum-wallets';

const REOWN_PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID || '';

export function nearEvmChain(networkId) {
  const testnet = networkId !== 'mainnet';
  const rpc = testnet ? 'https://eth-rpc.testnet.near.org' : 'https://eth-rpc.mainnet.near.org';
  return {
    id: testnet ? 398 : 397,
    caipNetworkId: testnet ? 'eip155:398' : 'eip155:397',
    chainNamespace: 'eip155',
    name: testnet ? 'NEAR Protocol Testnet' : 'NEAR Protocol',
    nativeCurrency: { decimals: 18, name: 'NEAR', symbol: 'NEAR' },
    rpcUrls: { default: { http: [rpc] }, public: { http: [rpc] } },
    blockExplorers: {
      default: {
        name: 'NEAR Explorer',
        url: testnet ? 'https://eth-explorer-testnet.near.org' : 'https://eth-explorer.near.org',
      },
    },
    testnet,
  };
}

export async function setupEthereumModule(networkId) {
  const chain = nearEvmChain(networkId);

  if (!REOWN_PROJECT_ID) {
    const wagmiConfig = createConfig({
      chains: [chain],
      transports: { [chain.id]: http() },
      connectors: [injected({ shimDisconnect: true })],
    });
    return setupEthereumWallets({ wagmiConfig, alwaysOnboardDuringSignIn: true });
  }

  // 只有在設定 project id 時才載入 AppKit（體積大）
  const [{ createAppKit }, { WagmiAdapter }] = await Promise.all([
    import('@reown/appkit'),
    import('@reown/appkit-adapter-wagmi'),
  ]);
  const metadata = {
    name: 'Seed Garden',
    description: 'Generative NFTs on NEAR',
    url: window.location.origin,
    icons: [`${window.location.origin}/favicon.ico`],
  };
  const wagmiAdapter = new WagmiAdapter({
    projectId: REOWN_PROJECT_ID,
    networks: [chain],
    connectors: [
      walletConnect({ projectId: REOWN_PROJECT_ID, metadata, showQrModal: false }),
      injected({ shimDisconnect: true }),
    ],
  });
  const web3Modal = createAppKit({
    adapters: [wagmiAdapter],
    projectId: REOWN_PROJECT_ID,
    networks: [chain],
    defaultNetwork: chain,
    enableWalletConnect: true,
    features: { analytics: false, swaps: false, onramp: false, email: false, socials: false },
    metadata,
    coinbasePreference: 'eoaOnly', // NEAR 上只支援 EOA，不支援 smart account
    allWallets: 'SHOW',
  });
  return setupEthereumWallets({
    wagmiConfig: wagmiAdapter.wagmiConfig,
    web3Modal,
    alwaysOnboardDuringSignIn: true,
  });
}

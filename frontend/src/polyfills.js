// @near-wallet-selector/okx-wallet 直接使用全域 Buffer，瀏覽器需要 polyfill。
import { Buffer } from 'buffer';
globalThis.Buffer = globalThis.Buffer || Buffer;

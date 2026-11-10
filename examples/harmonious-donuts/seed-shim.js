// 讓 fxhash 時代的作品在 NEAR 上跑：提供相同的 fxhash / fxrand / fxpreview API。
//   ?seed=<hex>     NEAR 合約存在 TokenMetadata.extra 的 64 字元 hex seed
//   ?fxhash=oo...   原本 fxhash 的 base58 hash（可重現 fxhash 上的原作）
// fxrand 用與 fxhash 官方 snippet 相同的 sfc32 變體，所以同一組 4 個 32-bit 狀態會得到同一串亂數。
(function () {
  var params = new URLSearchParams(location.search);

  function sfc32(a, b, c, d) {
    return function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      var t = (a + b | 0) + d | 0;
      d = d + 1 | 0;
      a = b ^ b >>> 9;
      b = c + (c << 3) | 0;
      c = c << 21 | c >>> 11;
      c = c + t | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  var states;
  var fxhashParam = params.get('fxhash');
  if (fxhashParam) {
    // 原 fxhash snippet 的 base58 解碼（含它對 58**11 的修補）
    var _pow = Math.pow;
    Math.pow = function (a, b) { return (a === 58 && b === 11) ? 24986644000165536000 : _pow(a, b); };
    var alphabet = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
    var b58dec = function (str) {
      return [].reduce.call(str, function (p, c) { return p * alphabet.length + alphabet.indexOf(c) | 0; }, 0);
    };
    var trunc = fxhashParam.slice(2);
    var re = new RegExp('.{' + ((trunc.length / 4) | 0) + '}', 'g');
    states = trunc.match(re).map(b58dec);
    window.fxhash = fxhashParam;
  } else {
    // NEAR：hex seed 前 32 個字元 → 4 個 uint32
    var hex = (params.get('seed') || '').toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{8,}$/.test(hex)) hex = '0'.repeat(64);
    hex = (hex + '0'.repeat(32)).slice(0, 32);
    states = [0, 1, 2, 3].map(function (i) { return parseInt(hex.slice(i * 8, i * 8 + 8), 16) | 0; });
    window.fxhash = hex;
  }

  window.fxrand = sfc32.apply(null, states);
  window.isFxpreview = params.get('preview') === '1';
  window.fxpreview = function () { window.dispatchEvent(new Event('fxhash-preview')); };

  // fxhash 的 features 查詢協定，順便讓 grid 頁面可以讀到特徵
  window.addEventListener('message', function (event) {
    if (event.data === 'fxhash_getFeatures') {
      parent.postMessage({ id: 'fxhash_getFeatures', data: window.$fxhashFeatures }, '*');
    }
  });
})();

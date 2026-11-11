/*
 * mini-p5: the subset of p5.js 1.x global mode that "Harmonious donuts" uses, small enough to live
 * inside the NEAR contract. random/noise/colour/shape code follows p5.js 1.x line by line, so a seed
 * draws the same pixels as the original p5.min.js build. p5.js is LGPL-2.1 (https://p5js.org).
 */
(function (w) {
  'use strict';
  var M = 4294967296, A = 1664525, C = 1013904223, KAPPA = 0.5522847498;
  var rnd = null, perlin = null;
  var mode = 'rgb', maxes = { rgb: [255, 255, 255, 255], hsb: [360, 100, 100, 1] };
  var cnv = null, ctx = null, pd = w.devicePixelRatio || 1;
  var doFill = true, doStroke = true, fillStyle = '#FFFFFF', strokeStyle = '#000000';
  var looping = true, shape = null, started = false, last = 0;

  w.PI = Math.PI; w.TWO_PI = Math.PI * 2;
  w.RGB = 'rgb'; w.HSB = 'hsb'; w.BLEND = 'source-over'; w.SCREEN = 'screen'; w.POINTS = 'points';
  w.frameCount = 0; w.width = 100; w.height = 100; w.key = '';
  w.sin = Math.sin; w.cos = Math.cos; w.abs = Math.abs; w.min = Math.min; w.max = Math.max;
  w.int = function (n) { return n | 0; };

  // --- random (p5 1.x LCG) ---
  w.randomSeed = function (s) { rnd = (s == null ? Math.random() * M : s) >>> 0; };
  w.random = function (a, b) {
    var r;
    if (rnd != null) { rnd = (A * rnd + C) % M; r = rnd / M; } else r = Math.random();
    if (a === undefined) return r;
    if (b === undefined) return a instanceof Array ? a[Math.floor(r * a.length)] : r * a;
    if (b < a) { var t = a; a = b; b = t; }
    return r * (b - a) + a;
  };

  // --- noise (p5 1.x Perlin, 4 octaves, falloff 0.5) ---
  w.noiseSeed = function (s) {
    var z = (s == null ? Math.random() * M : s) >>> 0;
    perlin = new Array(4096);
    for (var i = 0; i < 4096; i++) { z = (A * z + C) % M; perlin[i] = z / M; }
  };
  function sc(i) { return 0.5 * (1 - Math.cos(i * Math.PI)); }
  w.noise = function (x, y, z) {
    y = y || 0; z = z || 0;
    if (perlin == null) { perlin = new Array(4096); for (var k = 0; k < 4096; k++) perlin[k] = Math.random(); }
    if (x < 0) x = -x; if (y < 0) y = -y; if (z < 0) z = -z;
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi, r = 0, amp = 0.5, n1, n2, n3, rx, ry;
    for (var o = 0; o < 4; o++) {
      var of = xi + (yi << 4) + (zi << 8);
      rx = sc(xf); ry = sc(yf);
      n1 = perlin[of & 4095]; n1 += rx * (perlin[(of + 1) & 4095] - n1);
      n2 = perlin[(of + 16) & 4095]; n2 += rx * (perlin[(of + 17) & 4095] - n2);
      n1 += ry * (n2 - n1);
      of += 256;
      n2 = perlin[of & 4095]; n2 += rx * (perlin[(of + 1) & 4095] - n2);
      n3 = perlin[(of + 16) & 4095]; n3 += rx * (perlin[(of + 17) & 4095] - n3);
      n2 += ry * (n3 - n2);
      n1 += sc(zf) * (n2 - n1);
      r += n1 * amp; amp *= 0.5;
      xi <<= 1; xf *= 2; yi <<= 1; yf *= 2; zi <<= 1; zf *= 2;
      if (xf >= 1) { xi++; xf--; } if (yf >= 1) { yi++; yf--; } if (zf >= 1) { zi++; zf--; }
    }
    return r;
  };

  // --- colour (p5.Color._parseInputs + toString) ---
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function hsbToRgb(f) {
    var h = f[0] * 6, s = f[1], v = f[2];
    if (s === 0) return [v, v, v, f[3]];
    var sec = Math.floor(h), t1 = v * (1 - s), t2 = v * (1 - s * (h - sec)), t3 = v * (1 - s * (1 + sec - h));
    var c = sec === 1 ? [t2, v, t1] : sec === 2 ? [t1, v, t3] : sec === 3 ? [t1, t2, v]
      : sec === 4 ? [t3, t1, v] : sec === 5 ? [v, t1, t2] : [v, t3, t1];
    c[3] = f[3];
    return c;
  }
  function parse(a) {
    var c = maxes[mode], v = a[0], f, m;
    if (a.length >= 3) {
      f = [v / c[0], a[1] / c[1], a[2] / c[2], typeof a[3] === 'number' ? a[3] / c[3] : 1].map(clamp);
      return mode === 'hsb' ? hsbToRgb(f) : f;
    }
    if (typeof v === 'string') {
      m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(v.trim().toLowerCase());
      if (!m) throw new Error('mini-p5: unsupported colour ' + v);
      f = [1, 2, 3].map(function (i) { return parseInt(m[i], 16) / 255; });
      f[3] = m[4] ? parseInt(m[4], 16) / 255 : 1;
      return f;
    }
    return [v / c[2], v / c[2], v / c[2], typeof a[1] === 'number' ? a[1] / c[3] : 1].map(clamp);
  }
  function css(args) {
    var f = parse(args);
    return 'rgba(' + Math.round(f[0] * 255) + ',' + Math.round(f[1] * 255) + ',' + Math.round(f[2] * 255) + ',' + f[3] + ')';
  }
  w.colorMode = function (m, a, b, c, d) {
    mode = m;
    var x = maxes[m];
    if (arguments.length === 2) { x[0] = x[1] = x[2] = x[3] = a; }
    else if (arguments.length === 4) { x[0] = a; x[1] = b; x[2] = c; }
    else if (arguments.length === 5) { x[0] = a; x[1] = b; x[2] = c; x[3] = d; }
  };
  w.fill = function () { doFill = true; ctx.fillStyle = fillStyle = css(arguments); };
  w.stroke = function () { doStroke = true; ctx.strokeStyle = strokeStyle = css(arguments); };
  w.noStroke = function () { doStroke = false; };
  w.strokeWeight = function (n) { ctx.lineWidth = n === undefined || n === 0 ? 1e-4 : n; };
  w.blendMode = function (m) { ctx.globalCompositeOperation = m; };
  w.background = function () {
    ctx.save();
    ctx.setTransform(pd, 0, 0, pd, 0, 0);
    ctx.fillStyle = css(arguments);
    ctx.fillRect(0, 0, w.width, w.height);
    ctx.restore();
  };

  // --- canvas and shapes (p5.Renderer2D) ---
  w.createCanvas = function (cw, ch) {
    if (!cnv) {
      cnv = document.createElement('canvas');
      cnv.id = 'defaultCanvas0';
      cnv.className = 'p5Canvas';
      var main = document.querySelector('main') || document.body.appendChild(document.createElement('main'));
      main.appendChild(cnv);
    }
    cnv.width = cw * pd; cnv.height = ch * pd;
    cnv.style.width = cw + 'px'; cnv.style.height = ch + 'px';
    ctx = cnv.getContext('2d');
    ctx.scale(pd, pd);
    ctx.fillStyle = fillStyle = '#FFFFFF';
    ctx.strokeStyle = strokeStyle = '#000000';
    ctx.lineCap = 'round';
    w.width = cw; w.height = ch;
    return cnv;
  };
  w.ellipse = function (x, y, ew, eh) {
    if (eh === undefined) eh = ew;
    ew = Math.abs(ew); eh = Math.abs(eh);
    x -= ew / 2; y -= eh / 2;
    if (!doFill && !doStroke) return;
    var ox = ew / 2 * KAPPA, oy = eh / 2 * KAPPA, xe = x + ew, ye = y + eh, xm = x + ew / 2, ym = y + eh / 2;
    ctx.beginPath();
    ctx.moveTo(x, ym);
    ctx.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
    ctx.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
    ctx.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
    ctx.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);
    if (doFill) ctx.fill();
    if (doStroke) ctx.stroke();
  };
  w.line = function (x1, y1, x2, y2) {
    if (!doStroke) return;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  w.point = function (x, y) {
    if (!doStroke) return;
    x = Math.round(x); y = Math.round(y);
    ctx.fillStyle = strokeStyle;
    if (ctx.lineWidth > 1) { ctx.beginPath(); ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2, false); ctx.fill(); }
    else ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = fillStyle;
  };
  w.beginShape = function (kind) { shape = { kind: kind, v: [] }; };
  w.vertex = function (x, y) { shape.v.push([x, y, strokeStyle]); };
  w.endShape = function () {
    var s = shape; shape = null;
    if (!s || !s.v.length || (!doStroke && !doFill)) return;
    if (s.kind !== 'points') throw new Error('mini-p5: only POINTS shapes are supported');
    for (var i = 0; i < s.v.length; i++) {
      if (doStroke) ctx.strokeStyle = strokeStyle = s.v[i][2];
      w.point(s.v[i][0], s.v[i][1]);
    }
  };

  // --- loop, input, save ---
  w.redraw = function () {
    ctx.setTransform(pd, 0, 0, pd, 0, 0);
    w.frameCount++;
    w.draw();
  };
  function frame(now) {
    if (!looping) return;
    if (now - last >= 1000 / 60 - 5) { // p5 caps at 60 fps, same epsilon
      last = now;
      w.redraw();
    }
    if (looping) requestAnimationFrame(frame);
  }
  w.noLoop = function () { looping = false; };
  w.loop = function () { if (!looping) { looping = true; if (started) requestAnimationFrame(frame); } };
  w.save = function (c, name) {
    var a = document.createElement('a');
    a.download = name || 'canvas.png';
    a.href = (c || cnv).toDataURL('image/png');
    a.click();
  };
  w.addEventListener('keydown', function (e) { w.key = e.key; if (typeof w.keyPressed === 'function') w.keyPressed(e); });
  w.addEventListener('click', function (e) { if (typeof w.mouseClicked === 'function') w.mouseClicked(e); });
  // p5 global mode copies every p5 function onto window at load time, overwriting same-named
  // functions declared by the sketch. The sketch declares its own shuffle(), but the original
  // piece therefore always ran p5's seeded shuffle; reproduce that here.
  function p5shuffle(arr, inPlace) {
    var isView = ArrayBuffer && ArrayBuffer.isView && ArrayBuffer.isView(arr);
    arr = inPlace || isView ? arr : arr.slice();
    for (var i = arr.length, r, t; i > 1;) {
      r = (w.random(0, 1) * i) | 0;
      t = arr[--i]; arr[i] = arr[r]; arr[r] = t;
    }
    return arr;
  }
  w.addEventListener('load', function () {
    w.shuffle = p5shuffle;
    w.createCanvas(100, 100);
    if (typeof w.setup === 'function') w.setup();
    started = true;
    if (typeof w.draw === 'function' && looping) requestAnimationFrame(frame);
  });
})(window);

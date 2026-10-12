/* Flatbed Schedule — POD / BOL scanner.
 *
 *   Dept12Scanner.open({ title, onDone(pdfBlob, pageCount) })
 *
 * Take a photo (or upload ones already taken) → the page is found, straightened
 * and cleaned into a black-and-white scan automatically → Done → one PDF,
 * built with vendor/pdf-lib. Everything runs on the iPad.
 */
(function () {
"use strict";

var MAX_SRC = 3400;      // longest side of the photo we work from, px (was 2000: that alone made text soft)
var MAX_OUT = 2200;      // longest side of a finished page: 2200px = 200 dpi on a letter page
var $ = function (s, r) { return (r || document).querySelector(s); };
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

/* ── Geometry ─────────────────────────────────────────────────────────── */
// Homography taking dest (x,y) → source (u,v) from 4 point pairs.
function homography(dst, src) {
  var A = [], b = [];
  for (var i = 0; i < 4; i++) {
    var x = dst[i][0], y = dst[i][1], u = src[i][0], v = src[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (var c = 0; c < 8; c++) {                 // Gaussian elimination, partial pivot
    var p = c;
    for (var r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    var tA = A[c]; A[c] = A[p]; A[p] = tA; var tb = b[c]; b[c] = b[p]; b[p] = tb;
    for (r = c + 1; r < 8; r++) {
      var f = A[r][c] / A[c][c];
      for (var k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  var h = new Array(8);
  for (r = 7; r >= 0; r--) {
    var sum = b[r];
    for (k = r + 1; k < 8; k++) sum -= A[r][k] * h[k];
    h[r] = sum / A[r][r];
  }
  return h;
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

/* ── Finding the paper ────────────────────────────────────────────────
   Nobody drags corners, so this has to hold up in a dark cab, under a hard
   shadow, a yellow dome light, on a light seat, with pink/yellow carbon
   copies. On a small copy of the photo it builds several "which pixels are
   paper" maps — brightness, brightness minus color (paper is gray-ish,
   seats and wood aren't), and two "enclosed by an edge" maps that ignore
   lighting altogether — fits the biggest four-sided shape to each, scores
   how much each looks like a sheet of paper, and keeps the best. When
   nothing looks like a page (e.g. the page fills the whole photo) it uses
   the whole photo, so the driver always gets a scan. */
function otsu(v, n) {
  var lo = Infinity, hi = -Infinity, i;
  for (i = 0; i < n; i++) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; }
  if (hi - lo < 1e-6) return hi;
  var bins = 256, hist = new Float64Array(bins), sc = (bins - 1) / (hi - lo);
  for (i = 0; i < n; i++) hist[((v[i] - lo) * sc) | 0]++;
  var sumAll = 0; for (i = 0; i < bins; i++) sumAll += i * hist[i];
  var sumB = 0, wB = 0, best = -1, t = 0;
  for (i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    var wF = n - wB; if (!wF) break;
    sumB += i * hist[i];
    var mB = sumB / wB, mF = (sumAll - sumB) / wF, b = wB * wF * (mB - mF) * (mB - mF);
    if (b > best) { best = b; t = i; }
  }
  return lo + (t + 0.5) / sc;
}
function boxBlur(src, w, h, r) {           // integral-image box blur
  var I = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h), x, y;
  for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += src[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    out[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return out;
}
function morph(m, w, h, r, dilate) {       // square dilate/erode, separable
  var t = new Uint8Array(w * h), o = new Uint8Array(w * h), x, y, k, v;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    v = dilate ? 0 : 1;
    for (k = -r; k <= r; k++) { var xx = x + k; var p = xx < 0 || xx >= w ? (dilate ? 0 : 1) : m[y * w + xx]; if (dilate ? p : !p) { v = dilate ? 1 : 0; break; } }
    t[y * w + x] = v;
  }
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    v = dilate ? 0 : 1;
    for (k = -r; k <= r; k++) { var yy = y + k; var q = yy < 0 || yy >= h ? (dilate ? 0 : 1) : t[yy * w + x]; if (dilate ? q : !q) { v = dilate ? 1 : 0; break; } }
    o[y * w + x] = v;
  }
  return o;
}
// Connected components of a mask → the few biggest, as pixel-index lists.
function components(m, w, h, keep) {
  var lab = new Int32Array(w * h).fill(-1), comps = [], stack = [], id = 0;
  for (var s0 = 0; s0 < w * h; s0++) {
    if (!m[s0] || lab[s0] !== -1) continue;
    var pts = []; stack.push(s0); lab[s0] = id;
    while (stack.length) {
      var q = stack.pop(), x = q % w, y = (q / w) | 0; pts.push(q);
      if (x > 0 && m[q - 1] && lab[q - 1] === -1) { lab[q - 1] = id; stack.push(q - 1); }
      if (x < w - 1 && m[q + 1] && lab[q + 1] === -1) { lab[q + 1] = id; stack.push(q + 1); }
      if (y > 0 && m[q - w] && lab[q - w] === -1) { lab[q - w] = id; stack.push(q - w); }
      if (y < h - 1 && m[q + w] && lab[q + w] === -1) { lab[q + w] = id; stack.push(q + w); }
    }
    comps.push(pts); id++;
  }
  return comps.sort(function (a, b) { return b.length - a.length; }).slice(0, keep);
}
function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
function polyArea(p) { var a = 0; for (var i = 0; i < p.length; i++) { var j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(a) / 2; }
function hullOf(pts, w) {                  // row extremes → monotone-chain hull
  var rows = {}, P = [];
  pts.forEach(function (q) { var x = q % w, y = (q / w) | 0, r = rows[y]; if (!r) rows[y] = [x, x]; else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; } });
  Object.keys(rows).forEach(function (y) { y = +y; P.push([rows[y][0], y], [rows[y][1] + 1, y], [rows[y][0], y + 1], [rows[y][1] + 1, y + 1]); });
  P.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  var lo = [], up = [], i;
  for (i = 0; i < P.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
  for (i = P.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop(); up.push(P[i]); }
  up.pop(); lo.pop(); return lo.concat(up);
}
// Biggest quadrilateral using hull vertices: start from the extremes, then
// move one corner at a time along the hull while the area grows.
function bestQuad(hull) {
  var n = hull.length; if (n < 4) return null;
  function ext(f) { var bi = 0; for (var i = 1; i < n; i++) if (f(hull[i]) > f(hull[bi])) bi = i; return bi; }
  var starts = [
    [ext(function (p) { return -p[0] - p[1]; }), ext(function (p) { return p[0] - p[1]; }), ext(function (p) { return p[0] + p[1]; }), ext(function (p) { return p[1] - p[0]; })],
    [ext(function (p) { return -p[1]; }), ext(function (p) { return p[0]; }), ext(function (p) { return p[1]; }), ext(function (p) { return -p[0]; })]
  ];
  var best = null, bestA = -1;
  starts.forEach(function (idx) {
    idx = idx.slice().sort(function (a, b) { return a - b; });
    if (new Set(idx).size < 4) return;
    for (var pass = 0; pass < 4; pass++) {
      for (var c = 0; c < 4; c++) {
        var prev = idx[(c + 3) % 4], next = idx[(c + 1) % 4], bi = idx[c], ba = -1;
        for (var k = (prev + 1) % n; k !== next; k = (k + 1) % n) {
          var t = idx.slice(); t[c] = k;
          var a = polyArea(t.map(function (j) { return hull[j]; }));
          if (a > ba) { ba = a; bi = k; }
        }
        idx[c] = bi;
      }
    }
    var q = idx.map(function (j) { return hull[j]; }), A = polyArea(q);
    if (A > bestA) { bestA = A; best = q; }
  });
  return best;
}
// Put a quad in TL, TR, BR, BL order.
function orderQuad(q) {
  var cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  var s = q.slice().sort(function (a, b) { return Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx); });
  var start = 0, m = Infinity; s.forEach(function (p, i) { if (p[0] + p[1] < m) { m = p[0] + p[1]; start = i; } });
  return [0, 1, 2, 3].map(function (i) { return s[(start + i) % 4]; });
}
function angleOk(q) {
  for (var i = 0; i < 4; i++) {
    var a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
    var v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    var ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1)))) * 180 / Math.PI;
    if (ang < 45 || ang > 135) return false;
  }
  return true;
}
// How much of a quad's outline sits on a real paper edge: along each side,
// compare brightness just inside vs just outside. A shape that swallowed
// part of a seat or dash has sides with nothing on them.
function edgeSupport(q, L, w, h) {
  var cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4, hit = 0, tot = 0;
  function at(x, y) { x = Math.round(x); y = Math.round(y); return x < 0 || y < 0 || x >= w || y >= h ? null : L[y * w + x]; }
  for (var sd = 0; sd < 4; sd++) {
    var a = q[sd], b = q[(sd + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny; }       // n points inward
    for (var k = 1; k < 20; k++) {
      var px = a[0] + dx * k / 20, py = a[1] + dy * k / 20, vin = at(px + nx * 3, py + ny * 3), vout = at(px - nx * 3, py - ny * 3);
      if (vin === null) continue;
      tot++;
      if (vout === null) { hit += 0.6; continue; }                             // side runs along the photo's edge
      if (Math.abs(vin - vout) / (Math.max(vin, vout) + 10) > 0.1) hit++;
    }
  }
  return tot ? hit / tot : 0;
}
function detectCorners(img, W, H) {
  var s = 320 / Math.max(W, H), w = Math.max(16, Math.round(W * s)), h = Math.max(16, Math.round(H * s)), n = w * h, i;
  var c = document.createElement("canvas"); c.width = w; c.height = h;
  var g = c.getContext("2d"); g.drawImage(img, 0, 0, w, h);
  var d = g.getImageData(0, 0, w, h).data, L0 = new Float32Array(n), S0 = new Float32Array(n);
  for (i = 0; i < n; i++) {
    var r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
    L0[i] = r * 0.299 + gg * 0.587 + b * 0.114;
    S0[i] = Math.max(r, gg, b) - Math.min(r, gg, b);
  }
  var L = boxBlur(L0, w, h, 1), S = boxBlur(S0, w, h, 1), masks = [];
  var m = new Uint8Array(n), t = otsu(L, n);
  for (i = 0; i < n; i++) m[i] = L[i] > t ? 1 : 0;
  masks.push(m);
  var P = new Float32Array(n); for (i = 0; i < n; i++) P[i] = L[i] - 1.1 * S[i];
  var m2 = new Uint8Array(n); t = otsu(P, n); for (i = 0; i < n; i++) m2[i] = P[i] > t ? 1 : 0;
  masks.push(m2);
  // Paper is neutral (white/gray) wherever the light falls; wood, seats and dashboards are not. Shadows dim
  // paper but don't tint it, so "how colorful" survives a hard shadow across the page.
  var CS = new Float32Array(n);
  for (i = 0; i < n; i++) { var mx = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]), mn = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); CS[i] = (mx - mn) / (mx + 14); }
  CS = boxBlur(CS, w, h, 1);
  var m6 = new Uint8Array(n); t = otsu(CS, n); for (i = 0; i < n; i++) m6[i] = CS[i] < t ? 1 : 0;
  masks.push(m6);
  // Brightness relative to the surroundings: paper beats a light seat even
  // when one side of the photo is lit and the other isn't.
  var Lbig = boxBlur(L, w, h, Math.round(Math.max(w, h) / 5)), N = new Float32Array(n);
  for (i = 0; i < n; i++) N[i] = L[i] / (Lbig[i] + 8);
  var m3 = new Uint8Array(n); t = otsu(N, n); for (i = 0; i < n; i++) m3[i] = N[i] > t ? 1 : 0;
  masks.push(m3);
  // Edges relative to local brightness, so a paper edge in deep shadow
  // counts as much as one in full light. Paper = what the border can't
  // reach without crossing an edge.
  var Lm = boxBlur(L, w, h, 3), G = new Float32Array(n);
  for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
    var k = y * w + x;
    var gx = L[k - w + 1] + 2 * L[k + 1] + L[k + w + 1] - L[k - w - 1] - 2 * L[k - 1] - L[k + w - 1];
    var gy = L[k + w - 1] + 2 * L[k + w] + L[k + w + 1] - L[k - w - 1] - 2 * L[k - w] - L[k - w + 1];
    G[k] = Math.hypot(gx, gy) / (Lm[k] + 12);
  }
  [0.5, 1.0].forEach(function (thr) {
    var e = new Uint8Array(n); for (i = 0; i < n; i++) e[i] = G[i] > thr ? 1 : 0;
    e = morph(e, w, h, 1, true);
    var out = new Uint8Array(n), st = [];
    for (i = 0; i < w; i++) { st.push(i, (h - 1) * w + i); }
    for (i = 0; i < h; i++) { st.push(i * w, i * w + w - 1); }
    while (st.length) { var q = st.pop(); if (out[q] || e[q]) continue; out[q] = 1; var qx = q % w;
      if (qx > 0) st.push(q - 1); if (qx < w - 1) st.push(q + 1); if (q >= w) st.push(q - w); if (q < n - w) st.push(q + w); }
    var inside = new Uint8Array(n); for (i = 0; i < n; i++) inside[i] = out[i] ? 0 : 1;
    masks.push(inside);
  });
  var best = null, bestScore = 0, bestRank = 0;
  masks.forEach(function (mk) {
    // Close small gaps (text, fold lines), then cut thin bridges to clutter.
    mk = morph(morph(mk, w, h, 2, true), w, h, 2, false);
    mk = morph(morph(mk, w, h, 2, false), w, h, 2, true);
    components(mk, w, h, 3).forEach(function (pts) {
      if (pts.length < n * 0.015) return;
      var hull = hullOf(pts, w), q = bestQuad(hull); if (!q) return;
      q = orderQuad(q);
      var qa = polyArea(q), ha = polyArea(hull), frac = qa / n;
      if (!angleOk(q) || frac < 0.025) return;
      var fill = Math.min(1, pts.length / qa), fit = qa / ha;
      var size = Math.min(1, (frac - 0.025) / 0.1) * (frac > 0.97 ? 0.6 : 1);
      // quality: does it look like a sheet (0–1)? rank: prefer the bigger of
      // two good candidates (the whole page over the half that's in light).
      var quality = fill * fit * fit * Math.pow(edgeSupport(q, L, w, h), 2) * (frac > 0.97 ? 0.6 : 1) * Math.min(1, size * 4);
      var rank = quality * Math.sqrt(frac);
      if (rank > bestRank) { bestRank = rank; bestScore = quality; best = q; }
    });
  });
  if (!best || bestScore < 0.4) return [[0, 0], [W, 0], [W, H], [0, H]];
  // Back to full size, pulled in a hair so no table edge sneaks into the scan.
  var cx = 0, cy = 0; best.forEach(function (p) { cx += p[0] / 4; cy += p[1] / 4; });
  return best.map(function (p) {
    var dx = cx - p[0], dy = cy - p[1], len = Math.hypot(dx, dy) || 1, pull = 2;
    return [Math.max(0, Math.min(W, (p[0] + dx / len * pull) / s)), Math.max(0, Math.min(H, (p[1] + dy / len * pull) / s))];
  });
}

// Separable max (dilate) or min (erode) filter of radius r.
function morphGray(src, w, h, r, isMax) {
  var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, k, v, u;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    v = src[y * w + x];
    for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { u = src[y * w + k]; if (isMax ? u > v : u < v) v = u; }
    tmp[y * w + x] = v;
  }
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    v = tmp[y * w + x];
    for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { u = tmp[k * w + x]; if (isMax ? u > v : u < v) v = u; }
    out[y * w + x] = v;
  }
  return out;
}
/* Straighten + clean one page. mode "bw" (document) or "color". */
function renderPage(srcCanvas, corners, mode) {
  var W = srcCanvas.width, H = srcCanvas.height;
  var ow = Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2]));
  var oh = Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2]));
  var k = Math.min(1, MAX_OUT / Math.max(ow, oh)); ow = Math.max(50, Math.round(ow * k)); oh = Math.max(50, Math.round(oh * k));
  var hm = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], corners);
  var src = srcCanvas.getContext("2d").getImageData(0, 0, W, H).data;
  var out = document.createElement("canvas"); out.width = ow; out.height = oh;
  var og = out.getContext("2d"), img = og.createImageData(ow, oh), o = img.data;
  var x, y, i, n = ow * oh;
  // 1. Perspective warp with bilinear sampling.
  for (y = 0; y < oh; y++) {
    for (x = 0; x < ow; x++) {
      var den = hm[6] * x + hm[7] * y + 1, u = (hm[0] * x + hm[1] * y + hm[2]) / den, v = (hm[3] * x + hm[4] * y + hm[5]) / den;
      var x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0, di = (y * ow + x) * 4;
      if (x0 < 0) { x0 = 0; fx = 0; } if (y0 < 0) { y0 = 0; fy = 0; }
      if (x0 >= W - 1) { x0 = W - 2; fx = 1; } if (y0 >= H - 1) { y0 = H - 2; fy = 1; }
      var a = (y0 * W + x0) * 4, b2 = a + 4, c = a + W * 4, d = c + 4;
      for (var ch = 0; ch < 3; ch++) {
        o[di + ch] = (src[a + ch] * (1 - fx) + src[b2 + ch] * fx) * (1 - fy) + (src[c + ch] * (1 - fx) + src[d + ch] * fx) * fy;
      }
      o[di + 3] = 255;
    }
  }
  // 2. Estimate the paper's brightness everywhere (so shadows and uneven
  //    light don't turn into gray smudges), on a coarse grid of blocks.
  var L0 = new Float32Array(n);
  for (i = 0; i < n; i++) L0[i] = o[i * 4] * 0.299 + o[i * 4 + 1] * 0.587 + o[i * 4 + 2] * 0.114;
  // Grain: measure it (median of the fine detail), then work from a lightly
  // smoothed copy so a dark, noisy photo doesn't turn into sand.
  var L = boxBlur(L0, ow, oh, 1), dev = [];
  for (i = 0; i < n; i += 97) dev.push(Math.abs(L0[i] - L[i]));
  dev.sort(function (a, b) { return a - b; });
  var grain = 1.4826 * dev[dev.length >> 1] / 3;   // what's left after the smoothing
  // Sharpen the fine detail (unsharp mask) so small print stays crisp after the warp; the smoothed copy is only
  // used to measure the paper's brightness.
  var Lb = boxBlur(L0, ow, oh, 2), Ls = new Float32Array(n);
  for (i = 0; i < n; i++) { var sv = L0[i] + 0.9 * (L0[i] - Lb[i]); Ls[i] = sv < 0 ? 0 : sv > 255 ? 255 : sv; }
  Lb = null;
  // Paper brightness under whatever light is on it. Average each 4x4 block, then "close" the picture: the biggest
  // brightness within 28px, then the smallest of that. Print and pen strokes are thinner than the window, so they vanish
  // and only the paper's own brightness is left, and a hard shadow edge stays a hard edge in the map (smoothing
  // across it is what used to leave a gray streak along every shadow).
  var B = 4, gw = Math.ceil(ow / B), gh = Math.ceil(oh / B), grid = new Float32Array(gw * gh);
  for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
    var sum = 0, cnt = 0, xs = gx * B, ys = gy * B, xe = Math.min(ow, xs + B), ye = Math.min(oh, ys + B);
    for (y = ys; y < ye; y++) for (x = xs; x < xe; x++) { sum += L[y * ow + x]; cnt++; }
    grid[gy * gw + gx] = sum / cnt;
  }
  var sm = boxBlur(morphGray(morphGray(grid, gw, gh, 4, true), gw, gh, 4, false), gw, gh, 1);
  // Shadows only dim paper to a third or so. Anything far darker than that is ink (a black bar with white lettering),
  // so the paper map never goes below 12% of the page's brightest paper.
  var srt = Array.prototype.slice.call(sm).sort(function (a, b) { return a - b; }), floor = Math.max(25, srt[Math.floor(srt.length * 0.9)] * 0.12);
  for (i = 0; i < sm.length; i++) if (sm[i] < floor) sm[i] = floor;
  // 3. Divide out the paper, then set the look.
  for (y = 0; y < oh; y++) {
    var fyg = Math.min(gh - 1, Math.max(0, y / B - 0.5)), y0g = Math.floor(fyg), y1g = Math.min(gh - 1, y0g + 1), wy = fyg - y0g;
    for (x = 0; x < ow; x++) {
      var fxg = Math.min(gw - 1, Math.max(0, x / B - 0.5)), x0g = Math.floor(fxg), x1g = Math.min(gw - 1, x0g + 1), wx = fxg - x0g;
      var bg = (sm[y0g * gw + x0g] * (1 - wx) + sm[y0g * gw + x1g] * wx) * (1 - wy) + (sm[y1g * gw + x0g] * (1 - wx) + sm[y1g * gw + x1g] * wx) * wy;
      i = (y * ow + x) * 4;
      if (mode === "bw") {
        // Where the paper is dark (shadow, night) the grain is a bigger share
        // of the signal, so "white" starts lower there.
        var white = Math.max(0.62, Math.min(0.88, 1 - 3.2 * grain / bg)), black = white - 0.56;
        var r = Ls[y * ow + x] / bg, val;
        if (r >= white) val = 255;
        else { var tt = Math.max(0, (r - black) / (white - black)); val = 255 * Math.pow(tt, 1.25); }
        o[i] = o[i + 1] = o[i + 2] = val;
      } else {
        var gain = 245 / bg;
        o[i] = Math.min(255, o[i] * gain); o[i + 1] = Math.min(255, o[i + 1] * gain); o[i + 2] = Math.min(255, o[i + 2] * gain);
      }
    }
  }
  og.putImageData(img, 0, 0);
  return trimEdges(out, o, ow, oh);
}
// Shave off any dark strip along the page's edges (table or seat that got
// caught at the border) — at most 5% per side.
function trimEdges(canvas, o, w, h) {
  function darkRow(y) { var d = 0; for (var x = 0; x < w; x += 3) if (o[(y * w + x) * 4] < 110) d++; return d / Math.ceil(w / 3) > 0.35; }
  function darkCol(x) { var d = 0; for (var y = 0; y < h; y += 3) if (o[(y * w + x) * 4] < 110) d++; return d / Math.ceil(h / 3) > 0.35; }
  var t = 0, b = h - 1, l = 0, r = w - 1, my = Math.round(h * 0.05), mx = Math.round(w * 0.05);
  // Scan a little past the last dark line too, so a gray fringe goes with it.
  while (t < my && darkRow(t)) t++; if (t) t = Math.min(my, t + 2);
  while (h - 1 - b < my && darkRow(b)) b--; if (b < h - 1) b = Math.max(h - 1 - my, b - 2);
  while (l < mx && darkCol(l)) l++; if (l) l = Math.min(mx, l + 2);
  while (w - 1 - r < mx && darkCol(r)) r--; if (r < w - 1) r = Math.max(w - 1 - mx, r - 2);
  if (!t && !l && b === h - 1 && r === w - 1) return canvas;
  var c = document.createElement("canvas"); c.width = r - l + 1; c.height = b - t + 1;
  c.getContext("2d").drawImage(canvas, l, t, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

/* ── UI: take (or upload) a photo, it cleans itself up, hit Done ────── */
var ST = null;   // { title, onDone, pages:[{out, thumb}], step }

function open(opts) {
  close();
  ST = { title: opts.title || "", onDone: opts.onDone, pages: [], step: "capture" };
  var el = document.createElement("div");
  el.className = "scan"; el.id = "scan"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Scan POD / BOL");
  el.innerHTML = '<div class="scan-top"><button class="btn drv-hbtn" data-sc="cancel">Cancel</button>' +
    '<div class="scan-title"><b>Scan POD / BOL</b><span>' + esc(ST.title) + "</span></div>" +
    '<button class="btn pri drv-hbtn" data-sc="done" disabled>Done</button></div>' +
    '<div class="scan-stage" id="scan-stage"></div><div class="scan-bar" id="scan-bar"></div><div class="scan-pages" id="scan-pages"></div>' +
    '<input type="file" id="scan-cam" accept="image/*" capture="environment" hidden>' +
    '<input type="file" id="scan-lib" accept="image/*" multiple hidden>';
  document.body.appendChild(el);
  el.addEventListener("click", onClick);
  el.addEventListener("change", onFile);
  paint();
}
function close() { var el = $("#scan"); if (el) el.remove(); ST = null; }
function paint() {
  var stage = $("#scan-stage"), bar = $("#scan-bar");
  $("#scan [data-sc=done]").disabled = !ST.pages.length || ST.step === "busy";
  if (ST.step === "capture") {
    stage.innerHTML = '<div class="scan-capture"><div class="scan-hint"><b>' + (ST.pages.length ? "Page " + (ST.pages.length + 1) : "Scan the POD / BOL") + "</b>" +
      "Lay it flat and get the whole page in the picture.</div>" +
      '<button class="btn pri scan-big" data-sc="camera">Take Photo</button>' +
      '<button class="btn scan-big" data-sc="library">Upload Photo</button></div>';
    bar.innerHTML = ST.pages.length ? '<span class="scan-tip">' + ST.pages.length + " page" + (ST.pages.length > 1 ? "s" : "") +
      " ready. Hit Done, or add another page.</span>" : "";
  } else if (ST.step === "busy") {
    stage.innerHTML = '<div class="scan-capture"><div class="scan-hint"><b>' + esc(ST.busyText || "Scanning…") + "</b></div></div>";
    bar.innerHTML = "";
  } else if (ST.step === "review") {
    var pg = ST.pages[ST.pages.length - 1];
    stage.innerHTML = '<div class="scan-review"><img alt="Scanned page ' + ST.pages.length + '" src="' + pg.out.toDataURL("image/jpeg", 0.9) + '"></div>';
    bar.innerHTML = '<button class="btn drv-hbtn" data-sc="redo">Retake</button>' +
      (ST.last ? '<button class="btn drv-hbtn" data-sc="adjust">Adjust Edges</button>' : "") + '<span class="scan-tip"></span>' +
      '<button class="btn drv-hbtn" data-sc="more">Add Page</button>';
  } else if (ST.step === "adjust") {
    stage.innerHTML = '<div class="scan-live"><div class="scan-vwrap" id="scan-awrap"></div></div>';
    bar.innerHTML = '<button class="btn drv-hbtn" data-sc="adjcancel">' + (ST.adjTarget && ST.adjTarget.redo ? "Cancel" : "Retake") + '</button>' +
      '<span class="scan-tip">Drag each corner onto a corner of the paper.' + (ST.queue && ST.queue.length ? " " + ST.queue.length + " more photo" + (ST.queue.length > 1 ? "s" : "") + " after this one." : "") + '</span>' +
      '<button class="btn pri drv-hbtn" data-sc="adjapply">' + (ST.adjTarget && ST.adjTarget.redo ? "Apply" : "Scan") + '</button>';
    adjustSetup();
  }
  $("#scan-pages").innerHTML = ST.pages.map(function (p, i) {
    return '<span class="scan-thumb"><img alt="Page ' + (i + 1) + '" src="' + p.thumb + '"><span>' + (i + 1) + "</span></span>";
  }).join("");
}
function alertIn(msg) { var b = $("#scan-bar"); if (b) b.innerHTML = '<span class="scan-tip scan-err">' + esc(msg) + "</span>"; }
function thumbOf(canvas) {
  var t = document.createElement("canvas"), k = 120 / Math.max(canvas.width, canvas.height);
  t.width = Math.round(canvas.width * k); t.height = Math.round(canvas.height * k);
  t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.7);
}
// Heavy work runs after the "Scanning…" screen has painted.
function later(fn) { requestAnimationFrame(function () { setTimeout(fn, 30); }); }
function loadPhoto(file) {
  return new Promise(function (ok, fail) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var k = Math.min(1, MAX_SRC / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(c);
    };
    img.onerror = function () { URL.revokeObjectURL(url); fail(new Error("That photo couldn't be opened. Try another one.")); };
    img.src = url;
  });
}
// Straighten + clean a photo with these corners and add it as the next page. The photo and corners are kept for the
// page being reviewed, so Adjust Edges can redo it.
function addPage(src, corners) {
  var out = renderPage(src, corners, "bw");
  ST.pages.push({ out: out, thumb: thumbOf(out) });
  ST.last = { src: src, corners: corners };
}
/* ── Set the edges: every photo goes through this before it is scanned. The finder's guess is drawn on the photo with a
   handle on each corner; drag them onto the paper's corners (a magnifier shows the spot under your finger), then Scan.
   The same screen is used by Adjust Edges on a page that is already scanned. ── */
function adjustSetup() {
  var T = ST.adjTarget, wrap = $("#scan-awrap"), st = $("#scan-stage"); if (!T || !wrap) return;
  var W = T.src.width, H = T.src.height, sw = st.clientWidth - 24, sh = st.clientHeight - 24, f = Math.min(sw / W, sh / H);
  wrap.style.width = Math.round(W * f) + "px"; wrap.style.height = Math.round(H * f) + "px"; wrap.style.touchAction = "none";
  var disp = document.createElement("canvas"); disp.width = Math.round(W * f * 2); disp.height = Math.round(H * f * 2);
  disp.getContext("2d").drawImage(T.src, 0, 0, disp.width, disp.height);
  var img = document.createElement("img"); img.src = disp.toDataURL("image/jpeg", 0.85); img.alt = "Photo"; img.className = "scan-aimg";
  wrap.innerHTML = ""; wrap.appendChild(img);
  var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("class", "scan-ov");
  var poly = document.createElementNS(NS, "polygon"); svg.appendChild(poly); wrap.appendChild(svg);
  var loupe = document.createElement("canvas"); loupe.className = "scan-loupe"; loupe.width = loupe.height = 220; loupe.hidden = true; wrap.appendChild(loupe);
  ST.adj = { corners: T.corners.map(function (p) { return [p[0], p[1]]; }), W: W, H: H, poly: poly, wrap: wrap, hs: [], loupe: loupe };
  ST.adj.corners.forEach(function (p, i) {
    var hd = document.createElement("div"); hd.className = "scan-handle"; hd.setAttribute("data-i", i); wrap.appendChild(hd); ST.adj.hs.push(hd);
    hd.addEventListener("pointerdown", function (e) {
      try { hd.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ } e.preventDefault();
      var move = function (ev) {
        var r = wrap.getBoundingClientRect();
        ST.adj.corners[i] = [Math.max(0, Math.min(W, (ev.clientX - r.left) / r.width * W)), Math.max(0, Math.min(H, (ev.clientY - r.top) / r.height * H))];
        adjustDraw(i);
      };
      var up = function () { loupe.hidden = true; hd.removeEventListener("pointermove", move); hd.removeEventListener("pointerup", up); hd.removeEventListener("pointercancel", up); };
      hd.addEventListener("pointermove", move); hd.addEventListener("pointerup", up); hd.addEventListener("pointercancel", up);
      move(e);
    });
  });
  adjustDraw();
}
function adjustDraw(active) {
  var A = ST && ST.adj; if (!A) return;
  A.poly.setAttribute("points", A.corners.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "));
  A.hs.forEach(function (hd, i) { hd.style.left = (A.corners[i][0] / A.W * 100) + "%"; hd.style.top = (A.corners[i][1] / A.H * 100) + "%"; });
  if (active == null) return;
  // magnifier: 3x of the photo around the corner being dragged, shown above it (below it near the top edge)
  var T = ST.adjTarget, lp = A.loupe, g = lp.getContext("2d"), cx = A.corners[active][0], cy = A.corners[active][1], span = A.W * 0.07;
  g.clearRect(0, 0, 220, 220); g.save(); g.beginPath(); g.arc(110, 110, 108, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#222"; g.fillRect(0, 0, 220, 220); g.drawImage(T.src, cx - span, cy - span, span * 2, span * 2, 0, 0, 220, 220); g.restore();
  g.strokeStyle = "#7BD36F"; g.lineWidth = 3; g.beginPath(); g.arc(110, 110, 107, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.5; g.beginPath(); g.moveTo(110, 90); g.lineTo(110, 130); g.moveTo(90, 110); g.lineTo(130, 110); g.stroke();
  var px = cx / A.W * 100, py = cy / A.H * 100, above = py > 28;
  lp.style.left = Math.max(12, Math.min(88, px)) + "%"; lp.style.top = (above ? py : py) + "%";
  lp.style.transform = "translate(-50%," + (above ? "-135%" : "35%") + ")"; lp.hidden = false;
}
// Apply the corners: scan the photo (a new one, or Adjust Edges on a finished page) and move on.
function adjustApply() {
  var A = ST && ST.adj, T = ST && ST.adjTarget; if (!A || !T) return;
  var q = orderQuad(A.corners.map(function (p) { return [p[0], p[1]]; }));
  if (!angleOk(q) || polyArea(q) < A.W * A.H * 0.02) { alertIn("Those corners don't make a page. Drag them onto the paper's corners."); return; }
  ST.step = "busy"; ST.busyText = "Scanning…"; paint();
  later(function () {
    try {
      if (T.redo) {
        var out = renderPage(T.src, q, "bw"), pg = ST.pages[ST.pages.length - 1];
        pg.out = out; pg.thumb = thumbOf(out); ST.last.corners = q;
      } else addPage(T.src, q);
      ST.adj = null; ST.adjTarget = null;
      if (!T.redo && ST.queue && ST.queue.length) nextPhoto(); else { ST.step = "review"; paint(); }
    } catch (err) { ST.adj = null; ST.step = ST.pages.length ? "review" : "capture"; paint(); alertIn("That didn't scan. Try again."); }
  });
}
// Photos picked or taken: one at a time, each one through the corner screen.
function nextPhoto() {
  var f = ST.queue.shift();
  ST.step = "busy"; ST.busyText = "Finding the page…"; paint();
  later(function () {
    loadPhoto(f).then(function (c) {
      var q = detectCorners(c, c.width, c.height), W = c.width, H = c.height;
      // nothing found: start from a box a little inside the photo so every handle can be grabbed
      var full = q.every(function (p, i) { return Math.abs(p[0] - [0, W, W, 0][i]) < 2 && Math.abs(p[1] - [0, 0, H, H][i]) < 2; });
      if (full) q = [[W * 0.08, H * 0.06], [W * 0.92, H * 0.06], [W * 0.92, H * 0.94], [W * 0.08, H * 0.94]];
      ST.adjTarget = { src: c, corners: q, redo: false }; ST.step = "adjust"; paint();
    }, function (err) {
      ST.step = ST.pages.length ? "review" : "capture"; paint(); alertIn(err.message);
    });
  });
}
function onFile(e) {
  var files = [].slice.call(e.target.files || []); e.target.value = "";
  if (!files.length || !ST) return;
  ST.queue = files; nextPhoto();
}
function finish() {
  var pages = ST.pages.slice(), done = ST.onDone;
  if (!window.PDFLib) { alertIn("The PDF tool didn't load. Check the connection and try again."); return; }
  ST.step = "busy"; ST.busyText = "Saving PDF…"; paint();
  later(function () {
    var P = window.PDFLib;
    P.PDFDocument.create().then(function (doc) {
      return pages.reduce(function (chain, p) {
        return chain.then(function () {
          return doc.embedJpg(p.out.toDataURL("image/jpeg", 0.9)).then(function (jpg) {
            // Letter-size pages (landscape for wide paperwork), the scan fit
            // inside with a small margin. Tickets and notes just sit centered.
            var wide = jpg.width > jpg.height * 1.1, PW = wide ? 792 : 612, PH = wide ? 612 : 792, m = 18, k = Math.min((PW - 2 * m) / jpg.width, (PH - 2 * m) / jpg.height);
            var w = jpg.width * k, h = jpg.height * k, page = doc.addPage([PW, PH]);
            page.drawImage(jpg, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h });
          });
        });
      }, Promise.resolve()).then(function () { return doc.save(); });
    }).then(function (bytes) {
      close();
      if (done) done(new Blob([bytes], { type: "application/pdf" }), pages.length);
    }, function (err) { ST.step = "review"; paint(); alertIn("Couldn't make the PDF: " + (err && err.message || err)); });
  });
}
function onClick(e) {
  var b = e.target.closest("[data-sc]"); if (!b || !ST) return;
  var a = b.getAttribute("data-sc");
  if (a === "cancel") close();
  else if (a === "camera") $("#scan-cam").click();
  else if (a === "library") $("#scan-lib").click();
  else if (a === "redo") { ST.pages.pop(); ST.last = null; ST.step = "capture"; paint(); }
  else if (a === "adjust") { ST.adjTarget = { src: ST.last.src, corners: ST.last.corners, redo: true }; ST.step = "adjust"; paint(); }
  else if (a === "adjcancel") {
    var wasRedo = ST.adjTarget && ST.adjTarget.redo; ST.adj = null; ST.adjTarget = null;
    if (wasRedo) { ST.step = "review"; paint(); }
    else if (ST.queue && ST.queue.length) nextPhoto();
    else { ST.step = "capture"; paint(); $("#scan-cam").click(); }   // Retake: straight back to the camera
  }
  else if (a === "adjapply") adjustApply();
  else if (a === "more") { ST.last = null; ST.step = "capture"; paint(); }
  else if (a === "done") finish();
}
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ST) close(); });

window.Dept12Scanner = { open: open, close: close,
  // For the local test bench (.claude/scan-bench.html) only.
  _test: { detectCorners: detectCorners, renderPage: renderPage, last: function () { return ST && ST.last; }, adj: function () { return ST && ST.adj; } } };
})();

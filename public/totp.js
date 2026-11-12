// Minimal RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) for the in-page demo authenticator.
// Pure JS on purpose: crypto.subtle is unavailable on plain-HTTP origins such as http://<ec2-ip>:3510.
(function (root) {
  'use strict';
  function sha1(bytes) {
    const ml = bytes.length; const len = ((ml + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(len); m.set(bytes); m[ml] = 0x80;
    const dv = new DataView(m.buffer); const bits = ml * 8;
    dv.setUint32(len - 4, bits >>> 0); dv.setUint32(len - 8, Math.floor(bits / 4294967296));
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);
    for (let off = 0; off < len; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20); const o = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((h, i) => o.setUint32(i * 4, h));
    return out;
  }
  function hmacSha1(key, msg) {
    if (key.length > 64) key = sha1(key);
    const k = new Uint8Array(64); k.set(key);
    const inner = new Uint8Array(64 + msg.length); const outer = new Uint8Array(84);
    for (let i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
    inner.set(msg, 64); outer.set(sha1(inner), 64);
    return sha1(outer);
  }
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32dec(s) {
    let bits = 0, val = 0; const out = [];
    for (const ch of String(s).toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
    return new Uint8Array(out);
  }
  function code(secret, t) {
    const counter = Math.floor((t == null ? Date.now() : t) / 30000);
    const msg = new Uint8Array(8); const dv = new DataView(msg.buffer);
    dv.setUint32(0, Math.floor(counter / 4294967296)); dv.setUint32(4, counter >>> 0);
    const h = hmacSha1(b32dec(secret), msg); const o = h[19] & 15;
    const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 1000000).padStart(6, '0');
  }
  root.SaifeTOTP = { code, sha1, hmacSha1, b32dec, secondsLeft: () => 30 - (Math.floor(Date.now() / 1000) % 30) };
})(typeof window !== 'undefined' ? window : globalThis);

/* Camera scanning for the donation card: reads the eCash QR code a wallet shows, including
   animated ones, and hands back the token or notes string.
   - Fedi: every eCash QR is a qrloop frame (base64 of a 5 byte header and a chunk, plus XOR
     "fountain" frames that fill in missed ones); the payload is the notes string, or for base64
     notes the decoded bytes.
   - Cashu wallets (NUT-16): a static cashuA/cashuB string, or ur:bytes parts with fountain codes,
     decoded by bcur.js (@gandlaf21/bc-ur, bundled).
   jsQR (Apache-2.0) decodes camera frames where the browser has no BarcodeDetector.
   Loaded on demand by give.js; exposes window.GiveScan. */
(function () {
  "use strict";
  var BASE = (document.currentScript && document.currentScript.src || "").replace(/[^/]*$/, "");

  function loadScript(name) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = BASE + name;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load the scanner.")); };
      document.head.appendChild(s);
    });
  }

  function b64ToBytes(s) {
    var t = s.replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    var bin = atob(t), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function xorInto(target, src) { for (var j = 0; j < src.length && j < target.length; j++) target[j] ^= src[j]; }

  /* qrloop 1.4.1 importer, ported (MIT, Gaetan Renaudeau). The MD5 check is left out: QR error
     correction catches corrupt frames, and the donations service rejects notes that do not parse. */
  function QrLoop() { this.total = 0; this.frames = {}; this.fountains = []; this.seen = {}; }
  QrLoop.looksLike = function (text) {
    if (!/^[A-Za-z0-9+/_=-]{8,}$/.test(text)) return false;
    try { var b = b64ToBytes(text); return b.length > 5 && (b[0] < 10 || b[0] === 100); } catch (e) { return false; }
  };
  QrLoop.prototype.add = function (text) {
    var b = b64ToBytes(text);
    if (b[0] === 100) {
      if (this.seen[text]) return;
      this.seen[text] = 1;
      var k = u16(b, 1), idx = [];
      for (var i = 0; i < k; i++) idx.push(u16(b, 3 + 2 * i));
      this.fountains.push({ idx: idx, data: b.slice(3 + 2 * k) });
    } else {
      var total = u16(b, 1), index = u16(b, 3);
      if (!total || index >= total) return;
      if (total !== this.total) { this.total = total; this.frames = {}; }
      this.frames[index] = b.slice(5);
    }
    this.resolve();
  };
  QrLoop.prototype.resolve = function () {
    var i = 0;
    while (i < this.fountains.length && this.total) {
      var f = this.fountains[i], have = [], missing = [];
      for (var j = 0; j < f.idx.length; j++) {
        var fr = this.frames[f.idx[j]];
        if (fr) have.push(fr); else missing.push(f.idx[j]);
      }
      var minLen = have.length ? Math.min.apply(null, have.map(function (h) { return h.length; })) : f.data.length;
      if (have.length && f.data.length !== minLen) { this.fountains.splice(i, 1); }
      else if (!missing.length) { this.fountains.splice(i, 1); }
      else if (missing.length === 1) {
        var rec = new Uint8Array(have.length ? have[0] : f.data);
        for (var h = 1; h < have.length; h++) xorInto(rec, have[h]);
        if (have.length) xorInto(rec, f.data);
        this.frames[missing[0]] = rec;
        this.fountains.splice(i, 1);
        i = 0;
      } else { i++; }
    }
  };
  QrLoop.prototype.progress = function () { return this.total ? Object.keys(this.frames).length / this.total : 0; };
  QrLoop.prototype.done = function () { return this.total > 0 && Object.keys(this.frames).length === this.total; };
  QrLoop.prototype.result = function () {
    var parts = [], size = 0;
    for (var i = 0; i < this.total; i++) { parts.push(this.frames[i]); size += this.frames[i].length; }
    var all = new Uint8Array(size), o = 0;
    parts.forEach(function (p) { all.set(p, o); o += p.length; });
    var len = ((all[0] << 24) >>> 0) + (all[1] << 16) + (all[2] << 8) + all[3];
    var data = all.slice(20, 20 + len);
    // Fedi frames notes strings that start with "fedimint" as text, and base64 notes as their bytes.
    var text = "";
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch (e) { text = ""; }
    if (/^(fedimint|cashu)/i.test(text)) return text;
    return bytesToB64(data);
  };

  /* Feeds scanned texts; result() once done() is true. */
  function Assembler() { this.kind = null; this.inner = null; this.value = null; }
  Assembler.prototype.add = function (raw) {
    var text = String(raw || "").trim();
    if (!text) return;
    var plain = text.replace(/^(cashu|fedimint):(?=cashu|fedimint)/i, "");
    if (/^(cashu[AB]|fedimint)[A-Za-z0-9+/_=-]{20,}$/.test(plain)) { this.kind = /^cashu/.test(plain) ? "cashu" : "fedimint"; this.value = plain; return; }
    if (/^ur:/i.test(text)) {
      if (!window.BCUR) throw new Error("ur decoder not loaded");
      if (this.kind !== "ur") { this.kind = "ur"; this.inner = window.BCUR.decoder(); }
      this.inner.add(text);
      return;
    }
    if (QrLoop.looksLike(text)) {
      if (this.kind !== "qrloop") { this.kind = "qrloop"; this.inner = new QrLoop(); }
      this.inner.add(text);
    }
  };
  Assembler.prototype.progress = function () { return this.value ? 1 : this.inner ? this.inner.progress() : 0; };
  Assembler.prototype.done = function () { return !!this.value || !!(this.inner && this.inner.done()); };
  Assembler.prototype.result = function () { return this.value || this.inner.result(); };

  /* Camera loop: open the rear camera into `video`, decode frames, call onProgress(0..1), and
     resolve with the scanned string. Returns {promise, stop}. */
  function scan(video, onProgress) {
    var stopped = false, stream = null, asm = new Assembler(), last = "", raf = 0;
    var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    var detector = null;
    var promise = new Promise(function (resolve, reject) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        reject(new Error("This browser cannot use the camera here. Paste the code instead."));
        return;
      }
      var ready = ("BarcodeDetector" in window)
        ? window.BarcodeDetector.getSupportedFormats().then(function (f) {
            if (f.indexOf("qr_code") >= 0) detector = new window.BarcodeDetector({ formats: ["qr_code"] });
            return detector ? null : loadScript("jsqr.js");
          }).catch(function () { return loadScript("jsqr.js"); })
        : loadScript("jsqr.js");
      Promise.all([ready, navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })])
        .then(function (r) {
          stream = r[1];
          if (stopped) { stop(); return; }
          video.srcObject = stream;
          video.setAttribute("playsinline", "");
          video.muted = true;
          return video.play().then(tick);
        })
        .catch(function (e) {
          stop();
          reject(new Error(e && e.name === "NotAllowedError"
            ? "Camera access was refused. Allow the camera for this site, or paste the code instead."
            : (e && e.message) || "The camera did not start."));
        });

      var busy = false, lastAt = 0;
      function tick(ts) {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (busy || (ts && ts - lastAt < 60) || video.readyState < 2) return;
        lastAt = ts || 0;
        busy = true;
        decode().then(function (text) {
          busy = false;
          if (!text || text === last) return;
          last = text;
          var needUR = /^ur:/i.test(text) && !window.BCUR;
          (needUR ? loadScript("bcur.js") : Promise.resolve()).then(function () {
            try { asm.add(text); } catch (e) { return; }
            onProgress && onProgress(asm.progress());
            if (asm.done()) {
              var out;
              try { out = asm.result(); } catch (e) { stop(); reject(new Error("The code was read but could not be put back together. Try again.")); return; }
              stop();
              resolve(out);
            }
          });
        }, function () { busy = false; });
      }
      function decode() {
        if (detector) {
          return detector.detect(video).then(function (codes) { return codes.length ? codes[0].rawValue : ""; });
        }
        var w = video.videoWidth, h = video.videoHeight, scale = Math.min(1, 720 / Math.max(w, h));
        canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        return Promise.resolve(code ? code.data : "");
      }
    });
    function stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
      try { video.srcObject = null; } catch (e) {}
    }
    return { promise: promise, stop: stop };
  }

  window.GiveScan = { scan: scan, Assembler: Assembler, QrLoop: QrLoop };
})();

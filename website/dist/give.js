/* Donation card for the eCash Card fund pages. Progressive enhancement: the page
   works without this file (the Lightning address and offer stay readable).
   Needs qrcode.js (Kazuhiko Arase, MIT) loaded first. */
(function () {
  "use strict";
  var root = document.querySelector("[data-give]");
  if (!root) return;

  var API = root.getAttribute("data-api");
  var SITE = root.getAttribute("data-site");
  var CONTACT = root.getAttribute("data-contact");
  var LN_ADDRESS = root.getAttribute("data-address");
  var ONCHAIN_HINT = 100000;
  var MIN = 1000, MAX = 10000000;

  var state = { rail: "lightning", sats: 21000, price: null, invoice: null, address: null,
                poll: null, tick: null, baseline: null, step: "amount" };

  function $(sel, ctx) { return (ctx || root).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function usd(sats) {
    if (!state.price) return "";
    var v = sats / 1e8 * state.price;
    return "about $" + (v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US"));
  }
  function btc(sats) { return (sats / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, ""); }
  function getJSON(path) {
    return fetch(API + path, { cache: "no-store" }).then(function (r) {
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || ("HTTP " + r.status)); return d; });
    });
  }
  function announce(msg) { var live = $("[data-live]"); if (live) live.textContent = msg; }

  /* ---------- QR as crisp SVG ---------- */
  function qrSVG(text, level) {
    var qr = qrcode(0, level || "M");
    var upper = /^[0-9A-Z $%*+\-./:]*$/.test(text);
    qr.addData(text, upper ? "Alphanumeric" : "Byte");
    qr.make();
    var n = qr.getModuleCount(), m = 2, size = n + m * 2, d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++)
      if (qr.isDark(r, c)) d += "M" + (c + m) + " " + (r + m) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + " " + size +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path fill="#0b0f0d" d="' + d + '"/></svg>';
  }

  /* ---------- steps ---------- */
  function show(step) {
    state.step = step;
    $all("[data-step]").forEach(function (el) {
      var on = el.getAttribute("data-step") === step;
      el.hidden = !on;
      if (on) el.classList.add("is-entering");
      setTimeout(function () { el.classList.remove("is-entering"); }, 420);
    });
    root.setAttribute("data-current", step);
    var panel = $('[data-step="' + step + '"]');
    if (step !== "amount" && panel) setTimeout(function () { panel.focus({ preventScroll: true }); }, 60);
    if (step !== "amount" && window.matchMedia("(max-width: 900px)").matches) {
      var top = root.getBoundingClientRect().top + window.scrollY - 16;
      if (Math.abs(window.scrollY - top) > 80) window.scrollTo({ top: top, behavior: "smooth" });
    }
  }
  function stopWatching() {
    clearInterval(state.poll); clearInterval(state.tick); state.poll = state.tick = null;
  }

  /* ---------- amount ---------- */
  function setSats(n, fromChip) {
    state.sats = n;
    $all("[data-sats]").forEach(function (b) {
      b.setAttribute("aria-checked", String(fromChip && +b.getAttribute("data-sats") === n));
    });
    var label = $("[data-continue-label]");
    var valid = n >= MIN && n <= MAX;
    $("[data-continue]").disabled = !valid;
    label.textContent = valid ? "Continue with " + fmt(n) + " sats" : "Enter at least " + fmt(MIN) + " sats";
    $("[data-continue-usd]").textContent = valid ? usd(n) : "";
    var hint = $("[data-onchain-hint]");
    if (hint) hint.hidden = !(state.rail === "onchain" && valid && n < ONCHAIN_HINT);
  }
  function setRail(rail) {
    state.rail = rail;
    $all("[data-rail]").forEach(function (t) {
      var on = t.getAttribute("data-rail") === rail;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    root.setAttribute("data-rail-current", rail);
    setSats(state.sats, !!$('[data-sats][aria-checked="true"]'));
  }

  /* ---------- lightning ---------- */
  function startLightning() {
    show("lightning");
    var box = $("[data-ln-qr]");
    box.innerHTML = ""; box.classList.add("is-loading");
    $("[data-ln-amount]").textContent = fmt(state.sats) + " sats";
    $("[data-ln-usd]").textContent = usd(state.sats);
    setStatus("ln", "loading", "Creating your invoice");
    $("[data-ln-actions]").hidden = true;
    getJSON("/api/invoice?site=" + encodeURIComponent(SITE) + "&sats=" + state.sats).then(function (inv) {
      state.invoice = inv;
      box.innerHTML = qrSVG(("lightning:" + inv.pr).toUpperCase(), "L");
      box.classList.remove("is-loading");
      $("[data-ln-open]").href = "lightning:" + inv.pr;
      $("[data-ln-actions]").hidden = false;
      setStatus("ln", "waiting", "Waiting for payment");
      announce("Invoice ready for " + fmt(inv.sats) + " sats. Scan the code or open your wallet.");
      var left = (inv.expires_at || 0) - Date.now() / 1000;
      if (left > 0 && left < 8 * 86400) countdown(inv.expires_at);
      state.poll = setInterval(checkInvoice, 2000);
    }).catch(function (e) {
      box.classList.remove("is-loading");
      setStatus("ln", "error", "The invoice could not be created. " + e.message + ". The Lightning address below works too.");
    });
  }
  function countdown(expiresAt) {
    var el = $("[data-ln-expiry]");
    function draw() {
      var s = Math.max(0, Math.floor(expiresAt - Date.now() / 1000));
      var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
      el.textContent = s ? "Valid for " + (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0") : "Expired";
      if (!s) { stopWatching(); setStatus("ln", "error", "This invoice expired. Choose an amount again for a new one."); }
    }
    draw(); state.tick = setInterval(draw, 1000);
  }
  function checkInvoice() {
    if (document.hidden || !state.invoice || !state.invoice.payment_hash) return;
    getJSON("/api/invoice/status?hash=" + state.invoice.payment_hash).then(function (s) {
      if (s.paid) thanks("lightning", s.amount_sat || state.invoice.sats, state.invoice.payment_hash);
    }).catch(function () {});
  }

  /* ---------- on-chain ---------- */
  function startOnchain() {
    show("onchain");
    var box = $("[data-oc-qr]");
    box.innerHTML = ""; box.classList.add("is-loading");
    $("[data-oc-amount]").textContent = btc(state.sats) + " BTC";
    $("[data-oc-usd]").textContent = fmt(state.sats) + " sats" + (state.price ? ", " + usd(state.sats) : "");
    setStatus("oc", "loading", "Getting a fresh address");
    getJSON("/api/address?site=" + encodeURIComponent(SITE)).then(function (a) {
      state.address = a.address;
      var uri = "bitcoin:" + a.address + "?amount=" + btc(state.sats);
      box.innerHTML = qrSVG(uri, "M");
      box.classList.remove("is-loading");
      var grouped = a.address.match(/.{1,4}/g).join(" ");
      $("[data-oc-address]").textContent = grouped;
      $("[data-oc-address]").setAttribute("data-copy-value", a.address);
      $("[data-oc-btc]").textContent = btc(state.sats);
      $("[data-oc-btc]").setAttribute("data-copy-value", btc(state.sats));
      $("[data-oc-open]").href = uri;
      setStatus("oc", "waiting", "Watching the address");
      announce("Address ready. Send " + btc(state.sats) + " bitcoin.");
      state.baseline = null;
      checkAddress();
      state.poll = setInterval(checkAddress, 20000);
    }).catch(function (e) {
      box.classList.remove("is-loading");
      setStatus("oc", "error", "The address could not be loaded. " + e.message + ".");
    });
  }
  function checkAddress() {
    if (document.hidden || !state.address) return;
    getJSON("/api/onchain/status?address=" + state.address).then(function (s) {
      if (!s.known) return;
      var seen = s.confirmed_sat + s.pending_sat;
      if (state.baseline === null) { state.baseline = seen; return; }
      if (seen > state.baseline) thanks("onchain", seen - state.baseline, state.address, s.pending_sat > 0);
    }).catch(function () {});
  }

  /* ---------- shared ---------- */
  function setStatus(which, kind, text) {
    var el = $("[data-" + which + "-status]");
    el.setAttribute("data-kind", kind);
    $(".give-status-text", el).textContent = text;
  }
  function thanks(rail, sats, ref, pending) {
    stopWatching();
    $("[data-thanks-amount]").textContent = fmt(sats) + " sats";
    $("[data-thanks-detail]").textContent = rail === "onchain"
      ? (pending ? "We see your transaction in the mempool. It joins the ledger once it confirms." : "Your transaction confirmed and joins the ledger shortly.")
      : "It arrived just now and joins the public ledger within a few minutes.";
    var subject = encodeURIComponent("Gift of " + fmt(sats) + " sats");
    var body = encodeURIComponent("Please list this gift as:\n\n\nReference: " + String(ref).slice(0, 16));
    $("[data-thanks-name]").href = "mailto:" + CONTACT + "?subject=" + subject + "&body=" + body;
    show("thanks");
    announce("Payment received. Thank you for " + fmt(sats) + " sats.");
    loadPublic();
  }
  function copy(btn) {
    var target = btn.getAttribute("data-copy"), value;
    if (target === "invoice") value = state.invoice && state.invoice.pr;
    else {
      var el = document.querySelector(target);
      value = el && (el.getAttribute("data-copy-value") || el.textContent.trim());
    }
    if (!value) return;
    var done = function (ok) {
      var label = btn.querySelector("[data-copy-label]") || btn;
      var prev = label.getAttribute("data-label") || label.textContent;
      label.setAttribute("data-label", prev);
      label.textContent = ok ? "Copied" : "Press and hold to copy";
      btn.classList.toggle("is-copied", ok);
      announce(ok ? "Copied to the clipboard." : "Copy failed.");
      setTimeout(function () { label.textContent = prev; btn.classList.remove("is-copied"); }, 1800);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(value).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  /* ---------- ledger and totals ---------- */
  var SITE_NAMES = { cashucard: "Cashu Card", fedimintcard: "Fedimint Card" };
  function loadPublic() {
    getJSON("/api/public").then(function (p) {
      if (p.price_usd) state.price = state.price || p.price_usd;
      document.querySelectorAll("[data-raised]").forEach(function (el) { el.textContent = fmt(p.total_sat || 0); });
      document.querySelectorAll("[data-raised-usd]").forEach(function (el) { el.textContent = p.price_usd && p.total_sat ? usd(p.total_sat) : ""; });
      document.querySelectorAll("[data-gifts]").forEach(function (el) { el.textContent = fmt(p.count || 0); });
      var body = document.querySelector("[data-ledger]");
      if (!body) return;
      if (!p.donations || !p.donations.length) return;
      body.innerHTML = p.donations.slice(0, 50).map(function (d) {
        var date = d.date ? new Date(d.date * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Pending";
        var rail = d.rail === "onchain" ? "On-chain" : "Lightning";
        return "<tr><td>" + date + "</td><td class=\"num\">" + fmt(d.amount_sat) + " sats</td><td>" + rail +
          (d.confirmed ? "" : ", unconfirmed") + "</td></tr>";
      }).join("");
    }).catch(function () {});
  }

  /* ---------- wire up ---------- */
  getJSON("/api/presets").then(function (p) {
    state.price = p.price_usd;
    (p.presets || []).forEach(function (x) {
      var el = $('[data-sats="' + x.sats + '"] [data-usd]');
      if (el && x.usd != null) el.textContent = usd(x.sats);
    });
    setSats(state.sats, !!$('[data-sats][aria-checked="true"]'));
  }).catch(function () {});
  loadPublic();

  $all("[data-sats]").forEach(function (b) {
    b.addEventListener("click", function () {
      $("[data-custom]").hidden = true;
      $("[data-other]").setAttribute("aria-checked", "false");
      setSats(+b.getAttribute("data-sats"), true);
    });
  });
  var other = $("[data-other]"), customBox = $("[data-custom]"), input = $("[data-custom-input]");
  other.addEventListener("click", function () {
    $all("[data-sats]").forEach(function (b) { b.setAttribute("aria-checked", "false"); });
    other.setAttribute("aria-checked", "true");
    customBox.hidden = false;
    input.focus();
    setSats(parseInt(input.value, 10) || 0, false);
  });
  input.addEventListener("input", function () {
    var n = parseInt(input.value.replace(/[^0-9]/g, ""), 10) || 0;
    $("[data-custom-usd]").textContent = n ? usd(n) : "";
    setSats(n, false);
  });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("[data-continue]").click(); } });

  var tabs = $all("[data-rail]");
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { setRail(t.getAttribute("data-rail")); });
    t.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus(); next.click();
    });
  });

  $("[data-continue]").addEventListener("click", function () {
    if (state.sats < MIN || state.sats > MAX) return;
    if (state.rail === "onchain") startOnchain(); else startLightning();
  });
  $all("[data-back]").forEach(function (b) {
    b.addEventListener("click", function () { stopWatching(); state.invoice = null; show("amount"); });
  });
  $all("[data-again]").forEach(function (b) { b.addEventListener("click", function () { show("amount"); }); });
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-copy]");
    if (btn) copy(btn);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && (state.step === "lightning" || state.step === "onchain")) {
      stopWatching(); show("amount");
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.step === "lightning") checkInvoice();
    if (!document.hidden && state.step === "onchain") checkAddress();
  });

  // Lightning address and offer QR codes, rendered on demand.
  $all("[data-qr-of]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var holder = document.getElementById(btn.getAttribute("aria-controls"));
      var open = btn.getAttribute("aria-expanded") === "true";
      if (!open && !holder.innerHTML) holder.innerHTML = qrSVG(btn.getAttribute("data-qr-of"), "L");
      holder.hidden = open;
      btn.setAttribute("aria-expanded", String(!open));
      btn.textContent = open ? "Show QR" : "Hide QR";
    });
  });

  root.classList.add("is-ready");
  setRail("lightning");
  setSats(21000, true);
})();

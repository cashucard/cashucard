// The film section: custom controls over the native video, played once (muted) when it comes into view.
// Without JavaScript the browser's own controls stay. With reduced motion the film waits for a press.
(() => {
  const reel = document.getElementById("reel");
  if (!reel) return;
  const byId = (id) => document.getElementById(id);
  const ui = byId("film-ui"), screen = byId("film-screen"), bigPlay = byId("film-play");
  const toggle = byId("film-toggle"), sound = byId("film-sound");
  const tc = byId("film-tc"), scrub = byId("film-scrub"), fill = byId("film-fill"), list = byId("film-chapters");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const FPS = 30;
  const CHAPTERS = [[2, "Card"], [6, "Key"], [12, "Load"], [20, "Tap"], [26, "Sign"], [34, "Settle"], [42, "End"]];
  const ICON = {
    play: '<path d="M2 1 L11 6 L2 11 Z"/>',
    pause: '<rect x="2" y="1" width="3" height="10"/><rect x="7" y="1" width="3" height="10"/>',
    replay: '<path d="M6 1.6a4.4 4.4 0 1 1-4.2 3.1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M0.4 1.6 L2.1 5.4 L5.4 3.1 Z"/>',
  };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  let duration = 48, autoplayed = false, userPaused = false, pausedByScroll = false, raf = 0;
  const dur = () => (isFinite(reel.duration) && reel.duration > 0 ? reel.duration : duration);

  reel.controls = false;
  ui.hidden = false;

  // chapter marks on the scrub bar
  CHAPTERS.forEach(([t, name]) => {
    const li = document.createElement("li");
    li.style.left = (t / duration) * 100 + "%";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.setAttribute("aria-label", "Go to " + name);
    b.addEventListener("click", (e) => { e.stopPropagation(); userPaused = false; seek(t + 0.02); play(); });
    li.appendChild(b);
    list.appendChild(li);
  });
  const marks = [...list.children];

  const chapterAt = (t) => { let name = "Opening"; for (const [s, n] of CHAPTERS) if (t >= s) name = n; return name; };
  function render() {
    const t = reel.currentTime || 0, d = dur(), f = Math.floor(t * FPS);
    tc.textContent = "00:00:" + String(Math.floor(f / FPS)).padStart(2, "0") + ":" + String(f % FPS).padStart(2, "0");
    fill.style.width = clamp((t / d) * 100, 0, 100) + "%";
    scrub.setAttribute("aria-valuenow", t.toFixed(1));
    scrub.setAttribute("aria-valuetext", Math.round(t) + " seconds, " + chapterAt(t));
    marks.forEach((li, i) => li.classList.toggle("on", t >= CHAPTERS[i][0] && t < (CHAPTERS[i + 1] ? CHAPTERS[i + 1][0] : d + 1)));
  }
  // the progress loop runs only while the film plays
  function loop() { render(); raf = reel.paused ? 0 : requestAnimationFrame(loop); }
  function setIcon() {
    const ended = reel.ended, paused = reel.paused;
    toggle.querySelector("svg").innerHTML = ended ? ICON.replay : paused ? ICON.play : ICON.pause;
    toggle.setAttribute("aria-label", ended ? "Replay the film" : paused ? "Play the film" : "Pause the film");
  }
  function play() {
    bigPlay.hidden = true;
    if (reel.ended) reel.currentTime = 0;
    const p = reel.play();
    if (p && p.catch) p.catch(() => { bigPlay.hidden = false; });
  }
  function seek(t) { try { reel.currentTime = clamp(t, 0, dur() - 0.05); } catch (_) { /* metadata not loaded yet */ } render(); }

  reel.addEventListener("play", () => { setIcon(); if (!raf) raf = requestAnimationFrame(loop); });
  reel.addEventListener("pause", setIcon);
  reel.addEventListener("ended", () => { setIcon(); render(); });
  reel.addEventListener("loadedmetadata", () => { duration = dur(); scrub.setAttribute("aria-valuemax", String(Math.round(duration))); render(); });
  reel.addEventListener("timeupdate", () => { if (!raf) render(); });
  toggle.addEventListener("click", () => {
    if (reel.paused || reel.ended) { userPaused = false; play(); } else { userPaused = true; reel.pause(); }
  });
  bigPlay.addEventListener("click", () => { userPaused = false; play(); });
  sound.addEventListener("click", () => {
    reel.muted = !reel.muted;
    sound.textContent = reel.muted ? "Sound off" : "Sound on";
    sound.setAttribute("aria-pressed", String(!reel.muted));
    if (!reel.muted && reel.paused && !reel.ended) { userPaused = false; play(); }
  });

  // scrubbing: pointer drag, the arrow keys, Home and End
  let dragging = false;
  const scrubTo = (e) => { const r = scrub.getBoundingClientRect(); seek(clamp((e.clientX - r.left) / r.width, 0, 1) * dur()); };
  scrub.addEventListener("pointerdown", (e) => { dragging = true; scrub.setPointerCapture(e.pointerId); scrubTo(e); });
  scrub.addEventListener("pointermove", (e) => { if (dragging) scrubTo(e); });
  scrub.addEventListener("pointerup", () => { dragging = false; });
  scrub.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowUp") seek(reel.currentTime + 1);
    else if (k === "ArrowLeft" || k === "ArrowDown") seek(reel.currentTime - 1);
    else if (k === "Home") seek(0);
    else if (k === "End") seek(dur());
    else return;
    e.preventDefault();
  });

  // load as the section nears, play once when the film is mostly in view, pause when it leaves and resume on return
  if (reduce.matches) bigPlay.hidden = false;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) reel.preload = "auto";
      if (e.intersectionRatio >= 0.6) {
        if (!autoplayed && !reduce.matches) { autoplayed = true; play(); }
        else if (pausedByScroll && !userPaused) { pausedByScroll = false; play(); }
      } else if (e.intersectionRatio < 0.25 && !reel.paused) { pausedByScroll = true; reel.pause(); }
    }), { threshold: [0, 0.25, 0.6] }).observe(screen);
  }

  // the screen settles to full size as it scrolls up into place
  if (!reduce.matches) {
    let ticking = false;
    const settle = () => {
      ticking = false;
      const r = screen.getBoundingClientRect();
      const k = clamp((innerHeight - r.top) / (innerHeight * 0.9), 0, 1);
      screen.style.transform = "scale(" + (0.94 + 0.06 * k).toFixed(4) + ")";
    };
    addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(settle); } }, { passive: true });
    settle();
  }
  setIcon();
  render();
})();

// "One tap, step by step": rendered frames scrubbed by scroll on wide screens, a stepper on narrow screens and with
// reduced motion. Without JavaScript the steps read as a list beside one frame.
(() => {
  const root = document.getElementById("seq");
  if (!root || !window.TAP_ANCHORS) return;
  const byId = (id) => document.getElementById(id);
  const canvas = byId("seq-canvas"), ctx = canvas.getContext("2d"), leaders = byId("seq-leaders"), callouts = byId("seq-callouts");
  const caption = byId("seq-caption"), poster = byId("seq-poster"), nav = byId("seq-nav");
  const prev = byId("seq-prev"), next = byId("seq-next"), count = byId("seq-count"), slotsCount = byId("slots-count");
  const steps = [...root.querySelectorAll("#steps li")], cells = [...root.querySelectorAll("#slots i")];
  const A = window.TAP_ANCHORS, N = A.length;
  const frameUrl = (i) => "/seq/tap-1/tap_" + String(i).padStart(3, "0") + ".webp";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)"), narrow = matchMedia("(max-width: 900px)");
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
  // steps 1 to 5 take 0.15 of the frames each and step 6 the last 0.25 (the steps' data-a and data-b)
  const SHOW = [0.12, 0.27, 0.41, 0.56, 0.73, 0.99];   // the frame each step rests on in the stepper
  const CALLOUTS = [
    // rx, ry: how far the leader runs out (in multiples of its base reach) before the text shelf
    { k: "reader", a: 0.028, b: 0.15, side: 1, rx: 2.4, ry: 0.4, t: "Till reader", s: "Selects the card's applet" },
    { k: "chip", a: 0.159, b: 0.30, side: -1, rx: 3.4, ry: -0.15, t: "Card chip", s: "Its pieces, read by the till" },
    { k: "screenR", a: 0.309, b: 0.45, side: 1, rx: 1.3, ry: 0.5, t: "Till", s: "Sends its outputs" },
    { k: "chip", a: 0.459, b: 0.60, side: -1, rx: 3.4, ry: -0.15, t: "One signature", s: "The named pieces burn" },
    { k: "screenR", a: 0.609, b: 0.75, side: 1, rx: 1.3, ry: 0.5, t: "Mint signatures", s: "Checked on the till, offline" },
    // step 6: the card leaves the reader, the night passes with the till offline, then the till comes online
    { k: "reader", a: 0.78, b: 0.835, side: 1, rx: 2.4, ry: 1.4, t: "Card removed", s: "The payment is already accepted" },
    { k: "screenR", a: 0.835, b: 0.912, side: 1, rx: 1.3, ry: 0.5, t: "Hours later", s: "The till is still offline" },
    { k: "screenR", a: 0.912, b: 1.01, side: 1, rx: 1.3, ry: 0.5, t: "Back online", s: "Swapped at the mint" },
  ];
  const NAMED = [0, 2, 4];   // the slots holding 1, 4 and 16 sat
  const range = steps.map((li) => [Number(li.dataset.a), Number(li.dataset.b)]);
  const words = steps.map((li) => [li.querySelector("b").textContent, li.querySelector("p").textContent]);
  const imgs = new Array(N);
  let live = false, P = 0, raf = 0, loading = false, drawn = "", current = -1, chosen = 0;   // chosen: the stepper's step

  const notes = CALLOUTS.map((c) => {
    const d = document.createElement("div"), b = document.createElement("b"), s = document.createElement("span");
    d.className = "co" + (c.side < 0 ? " l" : ""); b.textContent = c.t; s.textContent = c.s; d.append(b, s); callouts.appendChild(d);
    return d;
  });

  // frames: every eighth first so scrubbing has something near, then the rest (every other one on narrow screens)
  function load() {
    if (loading) return;
    loading = true;
    const stride = narrow.matches ? 2 : 1, order = [];
    for (let i = 0; i < N; i += 8) order.push(i);
    for (let i = 0; i < N; i += stride) if (!order.includes(i)) order.push(i);
    order.forEach((i) => { const img = new Image(); img.decoding = "async"; img.onload = () => { imgs[i] = img; drawn = ""; request(); }; img.src = frameUrl(i); });
  }
  const nearest = (i) => { if (imgs[i]) return imgs[i]; for (let d = 1; d < N; d++) { if (imgs[i - d]) return imgs[i - d]; if (imgs[i + d]) return imgs[i + d]; } return null; };
  function draw() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; drawn = ""; }
    const i = Math.round(P * (N - 1)), key = i + ":" + w;
    if (key === drawn) return;
    const img = nearest(i);
    if (!img || !w) return;
    ctx.drawImage(img, 0, 0, w, h);
    drawn = key;
    poster.hidden = true;
  }
  function ui() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    // scrolling: the step comes from the frame; the stepper: the step changes as soon as it is chosen
    let on = 0;
    steps.forEach((li, n) => { const [a, b] = range[n]; if (P >= a && (P < b || n === steps.length - 1)) on = n; });
    if (!live) on = chosen;
    steps.forEach((li, n) => {
      const [a, b] = range[n];
      li.classList.toggle("on", n === on);
      li.classList.toggle("done", n < on);
      li.querySelector("i").style.width = (live ? clamp((P - a) / (b - a), 0, 1) * 100 : n <= on ? 100 : 0) + "%";
    });
    if (on !== current) {
      current = on;
      caption.replaceChildren(Object.assign(document.createElement("b"), { textContent: words[on][0] + "." }), document.createTextNode(" " + words[on][1]));
      count.textContent = on + 1 + " of " + steps.length;
      prev.disabled = on === 0;
      next.disabled = on === steps.length - 1;
    }
    // the till names 1, 4 and 16; signing burns them, and a spent slot stays marked until it is freed
    const named = live ? P >= 0.168 && P < 0.521 : on === 1 || on === 2, spent = live ? P >= 0.521 : on >= 3;
    cells.forEach((c, n) => { c.classList.toggle("named", NAMED.includes(n) && named); c.classList.toggle("spent", NAMED.includes(n) && spent); });
    slotsCount.textContent = spent ? "5 unspent, 3 spent" : "8 unspent";
    // callouts follow the rendered points they name
    const f = P * (N - 1), i0 = Math.floor(f), i1 = Math.min(N - 1, i0 + 1), u = f - i0;
    let svg = "";
    CALLOUTS.forEach((c, n) => {
      const el = notes[n], q = (P - c.a) / (c.b - c.a);
      const vis = q < 0 || q > 1 ? 0 : Math.min(1, q / 0.15, c.b > 1 ? 1 : (1 - q) / 0.15);
      if (vis <= 0 || W < 10) { el.style.opacity = 0; return; }
      const p0 = A[i0][c.k], p1 = A[i1][c.k];
      if (!p0 || !p1) { el.style.opacity = 0; return; }   // frames and anchors from different renders
      const ax = lerp(p0[0], p1[0], u) * W, ay = lerp(p0[1], p1[1], u) * H;
      const reach = Math.min(80, W * 0.07), shelf = Math.max(el.firstChild.offsetWidth, el.lastChild.offsetWidth) + 10;
      // run the callout out on its preferred side, or the other side when the text would leave the frame
      let side = c.side, ex = ax + side * reach * c.rx;
      if (ex + side * shelf < 6 || ex + side * shelf > W - 6) { side = -side; ex = ax + side * reach * c.rx; }
      el.classList.toggle("l", side < 0);
      const ey = ay - reach * c.ry, sx = ex + side * shelf, len = Math.hypot(ex - ax, ey - ay) + shelf, d = clamp(vis * 1.2, 0, 1);
      const o = vis.toFixed(2), dot = Math.min(1, vis * 2);
      svg += `<path d="M${ax.toFixed(1)},${ay.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)} L${sx.toFixed(1)},${ey.toFixed(1)}" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${(len * (1 - d)).toFixed(1)}" opacity="${o}"/>`;
      svg += `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${(3.4 * dot).toFixed(2)}" opacity="${o}"/><circle class="halo" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${(9 * dot).toFixed(2)}" opacity="${o}"/>`;
      el.style.opacity = clamp(vis * 1.6 - 0.3, 0, 1);
      el.style.left = ex + "px";
      el.style.top = ey + "px";
    });
    leaders.innerHTML = svg;
  }
  const progress = () => { const r = root.getBoundingClientRect(); return clamp(-r.top / (r.height - innerHeight), 0, 1); };
  function frame() { raf = 0; if (live) P = progress(); draw(); ui(); }
  function request() { if (!raf) raf = requestAnimationFrame(frame); }
  // the stepper eases between steps, longer over longer spans (step 6 holds a night); with reduced motion it cuts
  function tween(to) {
    const from = P, t0 = performance.now(), dur = reduce.matches ? 0 : 900 * clamp(Math.abs(to - from) / 0.15, 1, 2.2);
    const step = (now) => {
      const k = dur ? clamp((now - t0) / dur, 0, 1) : 1;
      P = from + (to - from) * (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
      draw(); ui();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function go(n) {
    n = clamp(n, 0, steps.length - 1);
    if (!live) { chosen = n; ui(); tween(SHOW[n]); return; }
    const r = root.getBoundingClientRect();
    scrollTo({ top: scrollY + r.top + (range[n][0] + 0.03) * (r.height - innerHeight), behavior: "smooth" });
  }
  function mode() {
    live = !narrow.matches && !reduce.matches;
    root.classList.toggle("seq-live", live);
    root.classList.toggle("seq-stepper", !live);
    nav.hidden = live;
    if (!live) { chosen = Math.max(current, 0); P = SHOW[chosen]; }
    drawn = "";
    current = -1;
    frame();
  }
  steps.forEach((li, n) => { const b = li.querySelector("button"); b.disabled = false; b.addEventListener("click", () => go(n)); });
  prev.addEventListener("click", () => go((live ? current : chosen) - 1));
  next.addEventListener("click", () => go((live ? current : chosen) + 1));
  addEventListener("scroll", () => { if (live) request(); }, { passive: true });
  addEventListener("resize", () => { drawn = ""; request(); });
  narrow.addEventListener("change", mode);
  reduce.addEventListener("change", mode);
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) load(); }), { rootMargin: "150% 0px" }).observe(root);
  else load();
  const first = new Image();
  first.onload = () => { if (!imgs[0]) imgs[0] = first; drawn = ""; request(); };
  first.src = frameUrl(0);
  mode();
})();

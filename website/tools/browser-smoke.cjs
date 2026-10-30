const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
async function main() {
  const origin = process.env.SITE_TEST_ORIGIN || "http://127.0.0.1:9117";
  const executable =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "cashu-site-chrome-"),
  );
  const output = process.env.SITE_SCREENSHOTS || "/tmp/cashu-site-preview";
  await fs.mkdir(output, { recursive: true });
  const chrome = spawn(
    executable,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  chrome.on("error", () => {});
  let socket;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try {
        port = (
          await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0];
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(port, "Chrome started");
    const target = await (
      await fetch(
        "http://127.0.0.1:" +
          port +
          "/json/new?" +
          encodeURIComponent(origin + "/"),
        { method: "PUT" },
      )
    ).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let seq = 0;
    const pending = new Map(),
      errors = [];
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === "Runtime.exceptionThrown")
        errors.push(msg.params.exceptionDetails.text);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(Error(msg.error.message)) : resolve(msg.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails)
        throw Error(
          result.exceptionDetails.exception?.description ||
            result.exceptionDetails.text,
        );
      return result.result?.value;
    };
    const until = async (expression, label) => {
      for (let i = 0; i < 150; i++) {
        if (await evaluate(expression)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error("Timed out: " + label);
    };
    // navigate and wait for that document: checking for an element alone can pass on the previous page
    const load = async (url, label) => {
      await send("Page.navigate", { url });
      await until("location.href===" + JSON.stringify(url) + "&&document.readyState==='complete'", label);
    };
    const screenshot = async (name) => {
      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      await fs.writeFile(
        path.join(output, name + ".png"),
        Buffer.from(data, "base64"),
      );
    };
    const viewport = (width, height) =>
      send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });

    await send("Runtime.enable");
    await send("Page.enable");
    // record content security policy violations; DevTools scripts are exempt from the page's policy
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>__csp.push(e.violatedDirective+' '+e.blockedURI))",
    });
    // the host must answer byte ranges (Safari plays the film only then) and apply dist/_headers
    const media = await fetch(origin + "/film/cashu-card-film-3.mp4", { headers: { Range: "bytes=0-1" } });
    assert.equal(media.status, 206, "Host answers byte-range requests for the film");
    await media.arrayBuffer();
    const home = await fetch(origin + "/");
    assert.match(home.headers.get("content-security-policy") || "", /media-src 'self'/, "Host applies _headers, media allowed");
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await viewport(1440, 900);
    await send("Page.navigate", { url: origin });
    await until("!!document.querySelector('#source')", "source section loaded");
    await evaluate("document.fonts.ready");
    assert.equal(await evaluate("!!document.querySelector('#story')"), false, "Four-step section is gone");
    assert.equal(await evaluate("document.querySelectorAll('h1').length"), 1, "One page heading");
    assert.equal(await evaluate("document.querySelector('#hero-title').innerText.replace(/\\s+/g,' ').trim()"), "Cashu, now on a card.", "Hero names the card innovation");
    assert.equal(await evaluate("document.querySelector('.hero-copy p').innerText.trim()"), "Wallets load ecash onto the card. Terminals can accept a tap offline, then settle with the mint when connected.", "Hero distinguishes offline acceptance from mint settlement");
    assert.equal(await evaluate("[...document.querySelectorAll('script[src]')].map(s=>new URL(s.src).pathname).join()"), "/seq/tap-3/anchors.js,/motion.js", "Two scripts: the sequence anchors and the controls");
    // the Cashu Card mark (D120): the header's lockup, the tab icons and the hero card; the mascot stays only in /concepts' studies
    await until("[...document.querySelectorAll('.wordmark img, .hero-mark')].every(i=>i.complete&&i.naturalWidth>0)", "the lockup and the hero card's mark loaded");
    assert.equal(await evaluate("document.querySelector('.wordmark img').getAttribute('src')"), "/assets/cashu-card-lockup.svg", "The header shows the Cashu Card lockup");
    assert.equal(await evaluate("document.querySelector('.hero-card .hero-mark').getAttribute('src')"), "/assets/cashu-card-mark-green.svg", "The hero card carries the mark");
    assert.equal(await evaluate("[...document.querySelectorAll('link[rel~=\"icon\"]')].map(l=>l.getAttribute('href')).join()"), "/favicon.ico,/assets/favicon.svg", "Tab icons are the Cashu Card mark");
    assert.equal(await evaluate("document.querySelectorAll('img[src*=\"cashu.png\"]').length"), 0, "The home page shows no mascot");
    for (const path of ["/favicon.ico", "/assets/favicon.svg", "/assets/apple-touch-icon.png"]) assert.equal((await fetch(origin + path)).status, 200, "Serves " + path);
    const words = await evaluate("document.body.innerText.trim().split(/\\s+/).length");   // \\s survives the string literal
    console.log("words " + words);
    assert.ok(words < 900, "Copy stays concise");   // about half of it is where to get cards and how to install the applet; the risks take about 190
    const screens = await evaluate("document.documentElement.scrollHeight / innerHeight");
    console.log("screens at 1440x900, reduced motion " + screens.toFixed(2));
    assert.ok(screens <= 6.6, "Desktop page stays within its budget");   // the risks section adds about 0.7
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.hero-card')).animationName"), "none", "Reduced motion stops card entrance");
    assert.ok(await evaluate("document.querySelector('.button-bright').href==='https://github.com/cashucard/nut/blob/main/CCP.md'"), "Primary action opens the draft NUT");
    assert.ok(await evaluate("document.querySelector('.button-outline').href==='https://github.com/cashucard/cashucard'"), "Secondary action opens the source repository");
    assert.equal(await evaluate("document.querySelector('#source').tagName"), "FOOTER", "Source links live in the footer");
    assert.equal(await evaluate("[...document.querySelectorAll('.footer-group')].some(g=>g.querySelector('.footer-label')?.textContent.trim()==='APPS' && g.querySelectorAll('a').length===1 && !!g.querySelector('a[href=\"#install\"]'))"), true, "The footer's Apps group holds the provisioner alone");
    assert.equal(await evaluate("[...document.querySelectorAll('a[href^=\"#\"]')].every(a=>!!document.querySelector(a.hash))"), true, "Every page anchor exists");
    assert.ok(await evaluate("[...document.querySelectorAll('#source a')].some(a=>a.href.includes('cashucard/cashucard'))"), "Linked source cashucard/cashucard");
    // the home page links no Flash or Foxy app, by repository or by site; the install guide's footer links their sites (D117, D118)
    assert.equal(await evaluate("[...document.querySelectorAll('a')].filter(a=>/lnflash\\/flash-mobile|getfoxy\\/iOS|lnflash\\/flash-pos|getflash\\.io|getfoxy\\.io/.test(a.href)).length"), 0, "The home page links no Flash, Flash POS or Foxy app");
    // where to buy cards: two shops for blank cards, then custom printed cards whose checkout waits for launch
    assert.equal(await evaluate("document.querySelectorAll('#buy .buy-option').length"), 3, "Three ways to get cards");
    assert.ok(await evaluate("!!document.querySelector('#buy a[href^=\"https://www.amazon.com/dp/\"]')"), "Cards for testing link to an Amazon listing");
    assert.ok(await evaluate("!!document.querySelector('#buy a[href^=\"https://www.cardlogix.com/\"]')"), "Cards in bulk link to CardLogix");
    assert.equal(await evaluate("document.querySelectorAll('#buy input[name=\"buy-qty\"]').length"), 4, "Custom cards come in four quantities");
    assert.equal(await evaluate("[...document.querySelectorAll('#buy .pay')].map(b=>b.getAttribute('aria-disabled')).join()"), "true,true", "Lightning and Stripe checkouts wait for launch");
    // installing the applet: the provisioner's two betas, then the install guide
    assert.equal(await evaluate("document.querySelectorAll('#install .buy-option').length"), 2, "Two ways to install the applet");
    assert.ok(await evaluate("!!document.querySelector('#install a[href=\"https://testflight.apple.com/join/M3JucFNy\"]')"), "The provisioner links its TestFlight beta");
    assert.ok(await evaluate("!!document.querySelector('#install a[href=\"https://play.google.com/apps/testing/com.islandbitcoin.provisioner\"]')"), "The provisioner links its Google Play beta");
    assert.ok(await evaluate("!!document.querySelector('#install a[href=\"/guide\"]')"), "The install section opens the install guide");
    assert.equal(await evaluate("[...document.querySelectorAll('.header nav a')].map(a=>a.textContent).join('|')"), "Get cards|Developers", "The nav holds Get cards and Developers only");
    // the till in the steps is a phone, with the card held to its back
    assert.ok(await evaluate("document.querySelector('#steps li p').textContent.includes(\"to the back of the merchant's phone\")"), "The steps show a phone as the till");
    // the film: custom controls over the native video; with reduced motion it waits for a press
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#film')).backgroundColor"), "rgb(0, 0, 0)", "The film sits on black, like its frame's edge");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#film-screen')).boxShadow"), "none", "Nothing outlines the film's edge");
    assert.equal(await evaluate("document.querySelectorAll('#reel source').length"), 2, "Film has 1080p and 720p sources");
    assert.ok(await evaluate("document.querySelector('#reel').getAttribute('poster').startsWith('/film/')"), "Film has a local poster");
    assert.equal(await evaluate("document.querySelector('#reel').controls"), false, "Custom controls replace the native ones");
    assert.equal(await evaluate("document.querySelector('#film-ui').hidden"), false, "Film controls show");
    assert.equal(await evaluate("document.querySelectorAll('#film-chapters button').length"), 7, "Seven chapters on the scrub bar");
    await screenshot("01-home-desktop");
    await evaluate("document.querySelector('#film').scrollIntoView()");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await evaluate("document.querySelector('#reel').paused"), true, "Reduced motion: the film waits");
    assert.equal(await evaluate("document.querySelector('#film-play').hidden"), false, "Reduced motion: a play button shows");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#film-screen')).transform"), "none", "Reduced motion: the screen does not scale");
    await evaluate("document.querySelector('#film-play').click()");
    await until("document.querySelector('#reel').currentTime > 0.3", "film plays after a press");
    await evaluate("document.querySelector('#film-sound').click()");
    assert.equal(await evaluate("document.querySelector('#reel').muted"), false, "Sound turns on");
    await evaluate("document.querySelector('#film-sound').click()");
    assert.equal(await evaluate("document.querySelector('#reel').muted"), true, "Sound turns off");
    await evaluate("[...document.querySelectorAll('#film-chapters button')].find(b=>b.textContent==='Settle').click()");
    await until("Math.abs(document.querySelector('#reel').currentTime-34)<1", "chapter jump");
    await evaluate("document.querySelector('#film-scrub').focus()");
    const before = await evaluate("document.querySelector('#reel').currentTime");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
    assert.ok(await evaluate("document.querySelector('#reel').currentTime") < before - 0.5, "Arrow keys scrub the film");
    await screenshot("04-film-desktop");
    // the step-by-step section: a stepper with reduced motion
    assert.equal(await evaluate("document.querySelector('#seq').className"), "seq seq-stepper", "Reduced motion: the steps are a stepper");
    assert.equal(await evaluate("document.querySelector('#seq-nav').hidden"), false, "Stepper controls show");
    assert.equal(await evaluate("[...document.querySelectorAll('#steps button')].every(b=>!b.disabled)"), true, "Step buttons are live");
    await evaluate("document.querySelector('#tap').scrollIntoView()");
    await until("document.querySelector('#seq-poster').hidden", "first sequence frame drawn");
    for (let i = 0; i < 3; i++) await evaluate("document.querySelector('#seq-next').click()");
    await until("document.querySelector('#seq-count').textContent==='4 of 6'", "Next moves through the steps");
    assert.ok(await evaluate("document.querySelector('#seq-caption').textContent.startsWith('Sign.')"), "Caption names the step");
    assert.equal(await evaluate("document.querySelector('#slots-count').textContent"), "5 unspent, 3 spent", "Signing marks the named pieces spent");
    await evaluate("document.querySelectorAll('#steps button')[5].click()");
    assert.equal(await evaluate("document.querySelector('#seq-count').textContent"), "6 of 6", "A step button jumps to its step");
    await screenshot("06-steps-stepper");
    assert.deepEqual(await evaluate("window.__csp"), [], "No content security policy violations");
    // with motion allowed it plays once, muted, when in view; pauses out of view; offers a replay at the end
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await load(origin + "/?motion", "page with motion loaded");
    assert.equal(await evaluate("document.querySelector('#reel').paused"), true, "Film waits below the fold");
    await evaluate("document.querySelector('#film').scrollIntoView()");
    await until("document.querySelector('#reel').currentTime>0.5", "film plays once in view");
    assert.equal(await evaluate("document.querySelector('#reel').muted"), true, "Film plays muted");
    await evaluate("scrollTo(0,0)");
    await until("document.querySelector('#reel').paused", "film pauses out of view");
    await evaluate("document.querySelector('#film').scrollIntoView()");
    await until("!document.querySelector('#reel').paused", "film resumes in view");
    await evaluate("(v=>v.currentTime=v.duration-0.5)(document.querySelector('#reel'))");
    await until("document.querySelector('#reel').ended", "film reaches its end");
    assert.equal(await evaluate("document.querySelector('#film-toggle').getAttribute('aria-label')"), "Replay the film", "Ended film offers a replay");
    await screenshot("05-film-end");
    // with motion, wide screens scrub the steps by scroll
    assert.equal(await evaluate("document.querySelector('#seq').className"), "seq seq-live", "Motion: the steps scrub by scroll");
    await evaluate("(r=>scrollTo(0,scrollY+r.top+0.56*(r.height-innerHeight)))(document.querySelector('#seq').getBoundingClientRect())");
    await until("document.querySelector('#steps li.on b')?.textContent==='Sign'", "scroll reaches the signature");
    await until("document.querySelector('#slots-count').textContent==='5 unspent, 3 spent'", "slots follow the scroll");
    await screenshot("07-steps-scroll");
    // the settle step: the card has left and the night passes before the till comes online
    await evaluate("(r=>scrollTo(0,scrollY+r.top+0.86*(r.height-innerHeight)))(document.querySelector('#seq').getBoundingClientRect())");
    await until("document.querySelector('#steps li.on b')?.textContent==='Settle'", "scroll reaches the settle step");
    await until("[...document.querySelectorAll('#seq-callouts .co')].some(c=>c.textContent.startsWith('Hours later')&&+c.style.opacity>0.5)", "the night's callout shows");
    await screenshot("08-steps-night");
    assert.deepEqual(await evaluate("window.__csp"), [], "No content security policy violations with motion");
    // without JavaScript the browser's own controls stay and the custom ones stay hidden
    await send("Emulation.setScriptExecutionDisabled", { value: true });
    await load(origin + "/?nojs", "page without JavaScript loaded");
    assert.equal(await evaluate("document.querySelector('#reel').hasAttribute('controls')"), true, "Without JavaScript the native controls remain");
    assert.equal(await evaluate("document.querySelector('#film-ui').hidden"), true, "Without JavaScript the custom controls stay hidden");
    assert.equal(await evaluate("document.querySelector('#seq').className"), "seq", "Without JavaScript the steps are a list");
    assert.equal(await evaluate("[...document.querySelectorAll('#steps p')].every(p=>getComputedStyle(p).display!=='none')"), true, "Without JavaScript every step's words show");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#slots')).display"), "none", "Without JavaScript the live slots stay hidden");
    await send("Emulation.setScriptExecutionDisabled", { value: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await load(origin + "/", "page reloaded");
    await evaluate("document.querySelector('#source').scrollIntoView()");
    await screenshot("02-source-desktop");
    for (const [width, height, maxScreens] of [
      [1024, 768, 6.8], [768, 900, 7.2], [390, 844, 8.3], [320, 740, 10.1],   // the risks section adds 0.7 to 2.0
    ]) {
      await viewport(width, height);
      await evaluate("scrollTo(0,0)");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "No overflow at " + width);
      // the two-item menu shows at every width, clear of the wordmark and the screen edge
      const nav = await evaluate("(()=>{const a=[...document.querySelectorAll('.header nav a')].map(e=>e.getBoundingClientRect());const w=document.querySelector('.wordmark').getBoundingClientRect();return {n:a.length,shown:a.every(r=>r.width>0),right:Math.max(...a.map(r=>r.right)),left:Math.min(...a.map(r=>r.left)),mark:w.right}})()");
      console.log("menu at " + width + ": " + JSON.stringify(nav));
      assert.ok(nav.n === 2 && nav.shown, "The menu shows at " + width);
      assert.ok(nav.right <= width - 12 && nav.left >= nav.mark + 12, "The menu fits the header at " + width);
      const ratio = await evaluate("document.documentElement.scrollHeight/innerHeight");
      console.log("screens at " + width + "x" + height + " " + ratio.toFixed(2));
      assert.ok(ratio <= maxScreens, "Page within its budget at " + width);
      await screenshot("home-" + width);
      await evaluate("document.querySelector('#source').scrollIntoView()");
      await screenshot("source-" + width);
    }
    await viewport(1440, 900);
    await send("Page.navigate", { url: origin + "/concepts.html" });
    await until("document.querySelectorAll('.concept-option').length===3", "Card artwork options load");
    assert.equal(await evaluate("document.querySelector('meta[name=robots]').content"), "noindex,nofollow", "Artwork options stay unindexed");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Artwork options fit desktop");
    await screenshot("03-card-options");
    await viewport(390, 844);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Artwork options fit mobile");
    // the install guide: its own page, linked from where to get cards, publishing the tracked CAP's hash
    await viewport(1440, 900);
    await send("Page.navigate", { url: origin + "/guide.html" });
    // wait for its stylesheets too: unstyled, its long commands would widen the page
    await until("document.readyState==='complete'&&document.querySelectorAll('.guide-doc h2').length===10", "Install guide loads with its ten sections");
    assert.equal(await evaluate("document.querySelector('.wordmark img').getAttribute('src')"), "/assets/cashu-card-lockup.svg", "The guide's header shows the lockup");
    await evaluate("document.fonts.ready");
    assert.ok(await evaluate("document.body.textContent.includes('f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5')"), "Guide publishes the CAP's sha256");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Install guide fits desktop");
    assert.ok(await evaluate("!!document.querySelector('#need a[href^=\"https://www.amazon.com/dp/\"]')"), "The guide links a card reader to buy");
    assert.ok(await evaluate("!!document.querySelector('#need a[href=\"/#install\"]')"), "The guide points card issuers at the provisioner");
    // its Apps link the wallets' own sites, where its setup step sends a new holder (D118)
    assert.equal(await evaluate("[...[...document.querySelectorAll('.footer-group')].find(g=>g.querySelector('.footer-label')?.textContent.trim()==='APPS').querySelectorAll('a')].map(a=>a.getAttribute('href')).join()"), "https://getflash.io/,https://getfoxy.io/,/#install", "The guide's Apps link Flash's and Foxy's sites, then the provisioner");
    assert.ok(await evaluate("document.querySelector('.agent pre code').textContent.includes('https://cashucard.org/guide.md')"), "The guide hands the install to an AI agent");
    const agentGuide = await fetch(origin + "/guide.md").then(async (r) => ({ status: r.status, type: r.headers.get("content-type") || "", text: await r.text() }));
    assert.equal(agentGuide.status, 200, "The agent's guide is served");
    assert.match(agentGuide.type, /^text\/markdown/, "The agent's guide is Markdown");
    assert.ok(agentGuide.text.includes("f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5"), "The agent's guide publishes the CAP's sha256");
    const llms = await fetch(origin + "/llms.txt").then((r) => r.text());
    assert.ok(llms.includes("https://cashucard.org/guide.md"), "llms.txt points agents at the guide");
    assert.ok(llms.includes("https://github.com/cashucard/nut/blob/main/CCP.md"), "llms.txt points agents at the draft NUT");
    await screenshot("09-install-guide");
    for (const width of [390, 320]) {
      await viewport(width, 844);
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Install guide fits " + width);
    }
    // experimental, said on every page, with the risks once on the home page (site/experimental-faq-developers)
    await viewport(1440, 900);
    await load(origin + "/", "home page for the risks");
    assert.equal(await evaluate("document.querySelector('.hero-copy .eyebrow').textContent.replace(/\\s+/g,' ').trim()"), "EXPERIMENTAL / NUT-CCP DRAFT", "The hero calls the project experimental");
    assert.ok(await evaluate("!!document.querySelector('.hero-status a[href=\"#risks\"]')"), "The hero points to the risks");
    assert.equal(await evaluate("document.querySelectorAll('#risks .risk-list li').length"), 7, "The risks are stated once, in seven points");
    assert.equal(await evaluate("[...document.querySelectorAll('section h2')].filter(h=>/risk/i.test(h.textContent)).length"), 1, "One risks section");
    for (const [page, sections, minItems] of [["/faq.html", 5, 21], ["/developers.html", 9, 0], ["/ops-service.html", 9, 0], ["/support.html", 4, 0], ["/privacy.html", 8, 0], ["/terms.html", 8, 0]]) {
      // the host serves /faq for /faq.html, as it does /guide; the local preview serves the file name
      await send("Page.navigate", { url: origin + page });
      await until("location.pathname.replace(/\\.html$/,'')===" + JSON.stringify(page.replace(".html", "")) + "&&document.readyState==='complete'&&!!document.querySelector('.guide-doc')", page + " loads");
      assert.equal(await evaluate("document.querySelectorAll('.guide-doc > section').length"), sections, page + " has its sections");
      assert.ok(await evaluate("document.querySelectorAll('.faq details').length") >= minItems, page + " answers its questions");
      assert.ok(await evaluate("document.querySelector('.footer-bottom span').textContent.includes('EXPERIMENTAL')"), page + " footer says experimental");
      assert.equal(await evaluate("[...document.querySelectorAll('.guide-rail a')].every(a=>!!document.querySelector(a.hash))"), true, page + " contents links resolve");
      assert.equal(await evaluate("[...document.querySelectorAll('a')].filter(a=>/getflash\\.io|getfoxy\\.io|lnflash|getfoxy\\//.test(a.href)).length"), 0, page + " names no wallet app");
      for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
        await viewport(width, height);
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, page + " fits " + width);
      }
      await viewport(1440, 900);
      await screenshot("10" + page.replace(/\W/g, "-"));
    }
    // privacy, terms and support: footer links on every page, Island Bitcoin LLC named, @cashucard.org contacts (site/legal-support)
    assert.equal(await evaluate("[...document.querySelectorAll('.footer-bottom a')].map(a=>a.getAttribute('href')).filter(h=>h==='/privacy'||h==='/terms').length"), 2, "The footer links privacy and terms");
    for (const path of ["/privacy.html", "/terms.html"]) {
      assert.ok((await fetch(origin + path).then((r) => r.text())).includes("Island Bitcoin LLC"), path + " names Island Bitcoin LLC");
    }
    assert.ok((await fetch(origin + "/support.html").then((r) => r.text())).includes("mailto:support@cashucard.org"), "Support gives the support address");
    for (const path of ["/faq.html", "/developers.html"]) {
      const r = await fetch(origin + path);
      assert.equal(r.status, 200, "Serves " + path);
    }
    assert.ok((await fetch(origin + "/sitemap.xml").then((r) => r.text())).includes("https://cashucard.org/faq"), "The sitemap lists the FAQ");
    for (const r of ["support", "privacy", "terms"]) assert.ok((await fetch(origin + "/sitemap.xml").then((x) => x.text())).includes("https://cashucard.org/" + r), "The sitemap lists " + r);
    assert.deepEqual(errors, [], "No browser exceptions");
    console.log("PASS: landing page, film and steps, direct source links, responsive artwork options, reduced motion, no JavaScript");
    console.log("Screenshots: " + output);
  } finally {
    if (socket) socket.close();
    chrome.kill("SIGTERM");
    await new Promise((resolve) => {
      if (chrome.exitCode !== null) resolve();
      else {
        chrome.once("exit", resolve);
        setTimeout(resolve, 3000);
      }
    });
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});

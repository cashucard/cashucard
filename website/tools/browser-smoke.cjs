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
    const click = (selector) =>
      evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const fill = (selector, value) =>
      evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
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
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await viewport(1440, 900);
    await send("Page.navigate", { url: origin });
    await until("!!document.querySelector('.story-film')", "story loaded");
    assert.ok(await evaluate("!!document.querySelector('.film-card') && !!document.querySelector('.film-device') && !!document.querySelector('.film-mint')"), "One card travels through the physical protocol story");
    await evaluate("document.fonts.ready");
    assert.ok(
      await evaluate("document.body.innerText.trim().split(/\s+/).length < 240"),
      "Concise page copy",
    );
    assert.ok(
      await evaluate("document.documentElement.scrollHeight <= innerHeight * 2.45"),
      "Desktop page fits roughly two screens",
    );
    assert.equal(
      await evaluate("getComputedStyle(document.querySelector('.film-card')).animationName"),
      "none",
      "System reduced motion stops card animation",
    );
    assert.equal(
      await evaluate("document.querySelector('.story-film').dataset.step"),
      "0",
      "Reduced motion starts on first frame",
    );
    await screenshot("01-hero-desktop");
    await evaluate("document.querySelector('#story').scrollIntoView()");
    await screenshot("02-story-desktop");
    for (let i = 0; i < 4; i++) {
      await click("#step-" + i);
      assert.equal(
        await evaluate("document.querySelector('.story-film').dataset.step"),
        String(i),
        "Step " + i,
      );
      assert.equal(
        await evaluate("document.querySelectorAll('.story-steps [aria-selected=true]').length"),
        1,
      );
    }
    await evaluate("document.querySelector('#step-0').focus()");
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "End",
      code: "End",
      windowsVirtualKeyCode: 35,
    });
    assert.equal(
      await evaluate("document.querySelector('.story-film').dataset.step"),
      "3",
    );
    for (const repo of [
      "lnflash/cashu-card",
      "lnflash/flash-mobile",
      "getfoxy/iOS",
      "lnflash/flash-pos",
    ]) {
      assert.ok(
        await evaluate("[...document.querySelectorAll('a[href]')].some(a=>a.href.includes(" + JSON.stringify(repo) + "))"),
        "Linked source " + repo,
      );
    }
    assert.ok(
      await evaluate("[...document.querySelectorAll('a[href]')].some(a=>a.href.includes('/spec/NUT-XX.md'))"),
      "Protocol spec linked",
    );
    assert.equal(
      await evaluate("[...document.querySelectorAll('a[href^=\"#\"]')].every(a=>a.hash===''||!!document.querySelector(a.hash))"),
      true,
      "Internal anchors exist",
    );
    for (const [width, height, maxScreens] of [
      [1024, 768, 2.8],
      [768, 900, 3.1],
      [390, 844, 3.5],
      [320, 740, 4.2],
    ]) {
      await viewport(width, height);
      await evaluate("scrollTo(0,0)");
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
        "No overflow at " + width,
      );
      assert.ok(
        await evaluate("document.documentElement.scrollHeight<=innerHeight*" + maxScreens),
        "Compact page at " + width,
      );
      await screenshot("hero-" + width);
      await evaluate("document.querySelector('#story').scrollIntoView()");
      await screenshot("story-" + width);
      if (width === 390) {
        assert.equal(
          await evaluate("(()=>{const a=document.querySelector('.callout-two').getBoundingClientRect(),b=document.querySelector('.film-status-badge').getBoundingClientRect();return a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top})()"),
          true,
          "Mobile callout is not covered by the settlement badge",
        );
      }
    }
    await viewport(1440, 900);
    await click(".motion-toggle");
    assert.equal(
      await evaluate("document.documentElement.dataset.motion"),
      "full",
    );
    await click("#step-0");
    await click(".story-play");
    assert.equal(
      await evaluate("getComputedStyle(document.querySelector('.film-card')).animationName"),
      "film-card-provision",
      "Play animates the physical card",
    );
    await new Promise((r) => setTimeout(r, 700));
    await screenshot("03-transfer-in-motion");
    await until("document.querySelector('.story-film').dataset.step==='1'", "story advances");
    assert.equal(
      await evaluate("getComputedStyle(document.querySelector('.film-proof')).animationName"),
      "proof-travel",
      "Loading animates mint proofs toward the card",
    );
    await click(".story-play");
    assert.equal(
      await evaluate("document.querySelector('.story-play').getAttribute('aria-label')"),
      "Replay story",
      "The story can be stopped",
    );
    assert.deepEqual(errors, [], "No browser exceptions");
    await send("Page.navigate", { url: origin + "/concepts.html" });
    await until("document.querySelectorAll('.concept-option').length===3", "Three card finishes load");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Card finishes fit desktop");
    await screenshot("04-card-finishes");
    await viewport(390, 844);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Card finishes fit mobile");
    console.log("PASS: compact responsive story, meaningful controls, source links, reduced motion");
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

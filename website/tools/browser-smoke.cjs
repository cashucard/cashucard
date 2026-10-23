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
    await until("!!document.querySelector('#source')", "source section loaded");
    await evaluate("document.fonts.ready");
    assert.equal(await evaluate("!!document.querySelector('#story')"), false, "Four-step section is gone");
    assert.equal(await evaluate("document.querySelectorAll('h1').length"), 1, "One page heading");
    assert.equal(await evaluate("document.querySelectorAll('script[src]').length"), 0, "Unused story script is gone");
    assert.ok(await evaluate("document.body.innerText.trim().split(/\s+/).length < 100"), "Copy stays concise");
    assert.ok(await evaluate("document.documentElement.scrollHeight <= innerHeight * 1.65"), "Desktop page stays short");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.hero-card')).animationName"), "none", "Reduced motion stops card entrance");
    assert.ok(await evaluate("document.querySelector('.button-bright').href.includes('/spec/NUT-XX.md')"), "Primary action opens the draft");
    assert.equal(await evaluate("document.querySelector('.button-outline').hash"), "#source", "Secondary action reaches the code");
    assert.equal(await evaluate("[...document.querySelectorAll('a[href^=\"#\"]')].every(a=>!!document.querySelector(a.hash))"), true, "Every page anchor exists");
    for (const repo of [
      "lnflash/cashu-card", "lnflash/flash-mobile", "getfoxy/iOS", "lnflash/flash-pos",
    ]) {
      assert.ok(await evaluate("[...document.querySelectorAll('.source-links a')].some(a=>a.href.includes(" + JSON.stringify(repo) + "))"), "Linked source " + repo);
    }
    await screenshot("01-home-desktop");
    await evaluate("document.querySelector('#source').scrollIntoView()");
    await screenshot("02-source-desktop");
    for (const [width, height, maxScreens] of [
      [1024, 768, 2.1], [768, 900, 2.3], [390, 844, 2.5], [320, 740, 2.9],
    ]) {
      await viewport(width, height);
      await evaluate("scrollTo(0,0)");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "No overflow at " + width);
      assert.ok(await evaluate("document.documentElement.scrollHeight<=innerHeight*" + maxScreens), "Short page at " + width);
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
    assert.deepEqual(errors, [], "No browser exceptions");
    console.log("PASS: short landing page, direct source links, responsive artwork options, reduced motion");
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

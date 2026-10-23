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
    await viewport(1440, 1000);
    await send("Page.navigate", { url: origin });
    await until(
      "!!document.querySelector('.hero-stack') && document.documentElement.dataset.motion==='reduce'",
      "page ready",
    );
    await evaluate("document.fonts.ready");
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('.front-card')).animationName",
      ),
      "none",
    );
    await screenshot("01-desktop-hero");
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('a[href^=\"#\"]')].every(a=>a.hash===''||!!document.querySelector(a.hash))",
      ),
      true,
      "Internal anchors exist",
    );
    await evaluate("document.querySelector('#how-it-works').scrollIntoView()");
    await screenshot("02-protocol-flow");
    for (let i = 0; i < 4; i++) {
      await click("#step-" + i);
      assert.equal(
        await evaluate("document.querySelector('.flow-stage').dataset.step"),
        String(i),
      );
      assert.equal(
        await evaluate(
          "document.querySelectorAll('.flow-tabs [aria-selected=true]').length",
        ),
        1,
      );
    }
    await click(".flow-next");
    assert.equal(
      await evaluate("document.querySelector('.flow-stage').dataset.step"),
      "0",
    );
    await evaluate("document.querySelector('#step-0').focus()");
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "End",
      code: "End",
      windowsVirtualKeyCode: 35,
    });
    assert.equal(
      await evaluate("document.querySelector('.flow-stage').dataset.step"),
      "3",
    );
    await evaluate("document.querySelector('#build').scrollIntoView()");
    for (const key of ["wallet", "terminal", "card"]) {
      await click("#audience-" + key);
      assert.equal(
        await evaluate(
          "document.querySelector('#audience-panel').getAttribute('aria-labelledby')",
        ),
        "audience-" + key,
      );
      assert.equal(
        await evaluate(
          "document.querySelectorAll('.audience-tabs [aria-selected=true]').length",
        ),
        1,
      );
      assert.ok(
        await evaluate(
          "document.querySelector('#audience-link').href.startsWith('https://github.com/lnflash/cashu-card')",
        ),
      );
    }
    await screenshot("03-builders");
    await evaluate(
      "document.querySelector('.developer-section').scrollIntoView()",
    );
    await click("#copy-command");
    await until(
      "!!document.querySelector('#copy-status').textContent",
      "copy feedback",
    );
    await screenshot("04-developers");
    for (const [width, height] of [
      [1024, 768],
      [768, 900],
      [390, 844],
      [320, 740],
    ]) {
      await viewport(width, height);
      await evaluate("scrollTo(0,0)");
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
        "No overflow at " + width,
      );
      await screenshot("hero-" + width);
      await evaluate("document.querySelector('#build').scrollIntoView()");
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
        "Build section fits " + width,
      );
    }
    await viewport(390, 844);
    await evaluate("scrollTo(0,0)");
    await click(".menu-button");
    assert.equal(
      await evaluate("document.querySelector('#mobile-nav').hidden"),
      false,
    );
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    assert.equal(
      await evaluate("document.querySelector('#mobile-nav').hidden"),
      true,
    );
    await click(".menu-button");
    await click('#mobile-nav a[href=\"#build\"]');
    assert.equal(
      await evaluate("document.querySelector('#mobile-nav').hidden"),
      true,
    );
    await click(".motion-toggle");
    assert.equal(
      await evaluate("document.documentElement.dataset.motion"),
      "full",
    );
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('.front-card')).animationIterationCount",
      ),
      "1",
    );
    await click(".motion-toggle");
    assert.equal(
      await evaluate("document.documentElement.dataset.motion"),
      "reduce",
    );
    assert.deepEqual(errors, [], "No browser exceptions");
    console.log(
      "PASS: responsive layouts, tabs, keyboard, menu, copy, motion settings and internal anchors",
    );
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

"use strict";
(() => {
  const root = document.documentElement;
  const $ = (selector) => document.querySelector(selector);
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  let explicitMotion = false;
  const motionButton = $(".motion-toggle");
  function setMotion(reduce) {
    root.dataset.motion = reduce ? "reduce" : "full";
    motionButton.setAttribute("aria-pressed", String(reduce));
    motionButton.replaceChildren(
      document.createTextNode(reduce ? "Enable motion " : "Reduce motion "),
    );
    const symbol = document.createElement("span");
    symbol.textContent = reduce ? "↗" : "◌";
    motionButton.append(symbol);
  }
  setMotion(motionPreference.matches);
  motionButton.addEventListener("click", () => {
    explicitMotion = true;
    setMotion(root.dataset.motion !== "reduce");
  });
  motionPreference.addEventListener("change", (e) => {
    if (!explicitMotion) setMotion(e.matches);
  });
  if ("IntersectionObserver" in window) {
    root.classList.add("js");
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    document
      .querySelectorAll("[data-reveal]")
      .forEach((element) => observer.observe(element));
  }
  const hero = $(".hero"),
    stack = $(".hero-stack"),
    progress = $(".reading-progress");
  let scheduled = false;
  function updateScroll() {
    scheduled = false;
    const range = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform =
      "scaleX(" + (range > 0 ? Math.min(1, scrollY / range) : 0) + ")";
    if (
      root.dataset.motion !== "reduce" &&
      scrollY < hero.offsetHeight &&
      innerWidth > 800
    )
      stack.style.setProperty("--hero-y", Math.min(scrollY * 0.07, 42) + "px");
  }
  addEventListener(
    "scroll",
    () => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(updateScroll);
      }
    },
    { passive: true },
  );
  addEventListener("resize", updateScroll, { passive: true });
  updateScroll();
  hero.addEventListener(
    "pointermove",
    (e) => {
      if (
        root.dataset.motion === "reduce" ||
        !matchMedia("(pointer:fine)").matches ||
        innerWidth <= 800
      )
        return;
      const rect = hero.getBoundingClientRect();
      stack.style.setProperty(
        "--rx",
        4 - ((e.clientY - rect.top) / rect.height - 0.5) * 7 + "deg",
      );
      stack.style.setProperty(
        "--ry",
        -9 + (e.clientX / innerWidth - 0.5) * 13 + "deg",
      );
    },
    { passive: true },
  );
  hero.addEventListener("pointerleave", () => {
    stack.style.removeProperty("--rx");
    stack.style.removeProperty("--ry");
  });
  const menu = $(".menu-button"),
    mobileNav = $("#mobile-nav");
  function closeMenu(focus = false) {
    mobileNav.hidden = true;
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "Open navigation");
    if (focus) menu.focus();
  }
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    menu.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
    mobileNav.hidden = !open;
  });
  mobileNav.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !mobileNav.hidden) closeMenu(true);
  });
  addEventListener(
    "resize",
    () => {
      if (innerWidth > 520) closeMenu();
    },
    { passive: true },
  );
  const stages = [
    {
      title: "Provision the card",
      copy: "A provisioner installs the applet and prepares the card for holder setup. Provisioning access and holder ownership have separate roles.",
      left: "Provisioner",
      leftDetail: "Install the applet",
      right: "Mint",
      rightDetail: "Issues and redeems ecash",
      wireLeft: "PROVISION",
      wireRight: "CASHU",
    },
    {
      title: "Set up ownership and load ecash",
      copy: "A compatible wallet establishes the holder’s owner key, configures the card and loads Cashu proofs locked to the card’s public key.",
      left: "Holder’s wallet",
      leftDetail: "Owner key and settings",
      right: "Mint",
      rightDetail: "Issues locked proofs",
      wireLeft: "SET UP",
      wireRight: "ISSUE",
    },
    {
      title: "Authorize the payment",
      copy: "The terminal presents the payment inputs and outputs. The card signs the transaction and commits the selected proofs as spent, with change locked back to the card.",
      left: "Payment terminal",
      leftDetail: "Prepare the payment",
      right: "Mint",
      rightDetail: "Settlement participant",
      wireLeft: "AUTHORIZE",
      wireRight: "CASHU",
    },
    {
      title: "Settle with the mint",
      copy: "The terminal submits the signed proofs to the mint. Successful redemption settles the payment; the terminal completes the card’s change flow.",
      left: "Payment terminal",
      leftDetail: "Submit signed proofs",
      right: "Mint",
      rightDetail: "Redeem and settle",
      wireLeft: "CHANGE",
      wireRight: "SETTLE",
    },
  ];
  let currentStep = 0,
    switchTimer;
  const stageElement = $(".flow-stage");
  function selectStage(index) {
    currentStep = index;
    const stage = stages[index];
    document.querySelectorAll(".flow-tabs [role=tab]").forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    stageElement.dataset.step = String(index);
    $("#flow-panel").setAttribute("aria-labelledby", "step-" + index);
    $("#flow-panel-title").textContent = stage.title;
    $("#flow-panel-copy").textContent = stage.copy;
    $("#left-node").textContent = stage.left;
    $("#left-detail").textContent = stage.leftDetail;
    $("#right-node").textContent = stage.right;
    $("#right-detail").textContent = stage.rightDetail;
    $("#wire-left").textContent = stage.wireLeft;
    $("#wire-right").textContent = stage.wireRight;
    clearTimeout(switchTimer);
    stageElement.classList.remove("is-switching");
    requestAnimationFrame(() => stageElement.classList.add("is-switching"));
    switchTimer = setTimeout(
      () => stageElement.classList.remove("is-switching"),
      850,
    );
  }
  document
    .querySelectorAll(".flow-tabs button")
    .forEach((tab) =>
      tab.addEventListener("click", () =>
        selectStage(Number(tab.dataset.step)),
      ),
    );
  $(".flow-next").addEventListener("click", () =>
    selectStage((currentStep + 1) % stages.length),
  );
  const audiences = {
    wallet: {
      title: "Connect a wallet to the card.",
      copy: "Implement the owner-key commands, configure the card and load Cashu proofs through the documented NFC interface.",
      items: [
        "Holder-controlled owner key",
        "Card settings and spending limits",
        "Cashu proof loading and refresh",
      ],
      link: "Explore the card interface",
      url: "https://github.com/lnflash/cashu-card/blob/main/spec/APDU.md",
    },
    terminal: {
      title: "Implement card payments.",
      copy: "Build an NFC reader integration that coordinates card authorization, mint redemption and the card’s change flow.",
      items: [
        "Documented payment command sequence",
        "SIG_ALL transaction authorization",
        "Mint settlement and change handling",
      ],
      link: "Read the payment flow",
      url: "https://github.com/lnflash/cashu-card/blob/main/spec/NUT-XX.md#paying-one-signature-for-the-payment",
    },
    card: {
      title: "Build and provision cards.",
      copy: "Use the JavaCard reference applet, host tools and provisioning library to evaluate compatible card hardware.",
      items: [
        "JavaCard reference implementation",
        "Provisioning and key-rotation tools",
        "Hardware deployment guides and reports",
      ],
      link: "Explore the applet and tools",
      url: "https://github.com/lnflash/cashu-card",
    },
  };
  function selectAudience(key) {
    const item = audiences[key];
    document.querySelectorAll(".audience-tabs [role=tab]").forEach((tab) => {
      const selected = tab.dataset.audience === key;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    $("#audience-panel").setAttribute("aria-labelledby", "audience-" + key);
    $("#audience-title").textContent = item.title;
    $("#audience-copy").textContent = item.copy;
    $("#audience-list").replaceChildren(
      ...item.items.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      }),
    );
    $("#audience-link").replaceChildren(
      document.createTextNode(item.link + " "),
    );
    const arrow = document.createElement("span");
    arrow.textContent = "↗";
    $("#audience-link").append(arrow);
    $("#audience-link").href = item.url;
  }
  document
    .querySelectorAll(".audience-tabs button")
    .forEach((tab) =>
      tab.addEventListener("click", () => selectAudience(tab.dataset.audience)),
    );
  function keyboardTabs(selector, choose) {
    const tabs = Array.from(
      document.querySelectorAll(selector + " [role=tab]"),
    );
    $(selector).addEventListener("keydown", (e) => {
      const index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      let next;
      if (["ArrowRight", "ArrowDown"].includes(e.key))
        next = (index + 1) % tabs.length;
      else if (["ArrowLeft", "ArrowUp"].includes(e.key))
        next = (index + tabs.length - 1) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      else return;
      e.preventDefault();
      choose(tabs[next]);
      tabs[next].focus();
    });
  }
  keyboardTabs(".flow-tabs", (tab) => selectStage(Number(tab.dataset.step)));
  keyboardTabs(".audience-tabs", (tab) => selectAudience(tab.dataset.audience));
  $("#copy-command").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("00A404000BF043415348554341524401");
      $("#copy-status").textContent = "SELECT command copied.";
    } catch {
      $("#copy-status").textContent = "Select the command text to copy it.";
    }
  });
})();

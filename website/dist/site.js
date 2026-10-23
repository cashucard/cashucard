"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const root = document.documentElement;
  const film = $(".story-film");
  const tabs = [...document.querySelectorAll(".story-steps [role=tab]")];
  const playButton = $(".story-play");
  const motionButton = $(".motion-toggle");
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  const stages = [
    {
      label: "PROVISION",
      title: "A provisioner installs the applet.",
      copy: "The card is ready for a holder's wallet to take ownership.",
      actors: [
        ["phone", "Provisioner", "Installs applet"],
        ["card", "Cashu card", "Receives applet"],
        ["check", "Ready", "For holder setup"],
      ],
      rails: ["APPLET", "READY"],
    },
    {
      label: "LOAD",
      title: "The wallet loads mint-issued ecash.",
      copy: "The holder sets the owner key and loads proofs onto the card.",
      actors: [
        ["mint", "Mint", "Issues proofs"],
        ["phone", "Holder's wallet", "Sets owner key"],
        ["card", "Cashu card", "Holds ecash"],
      ],
      rails: ["PROOFS", "LOAD"],
    },
    {
      label: "TAP",
      title: "A tap authorizes the spend.",
      copy: "The terminal requests payment. The card signs; mint settlement follows.",
      actors: [
        ["terminal", "Terminal", "Requests spend"],
        ["card", "Cashu card", "Signs spend"],
        ["signature", "Authorized", "Awaiting mint"],
      ],
      rails: ["TAP", "SIGNED"],
    },
    {
      label: "SETTLE",
      title: "The mint settles the payment.",
      copy: "The terminal redeems the proofs and completes the card's change flow.",
      actors: [
        ["terminal", "Terminal", "Submits proofs"],
        ["mint", "Mint", "Redeems ecash"],
        ["check", "Payment", "Settled"],
      ],
      rails: ["REDEEM", "SETTLED"],
    },
  ];
  let current = 0;
  let playing = false;
  let autoPlayed = false;
  let explicitMotion = false;
  let stepTimer;
  let animationTimer;

  function makeIcon(node, kind) {
    node.className = "actor-icon " + kind + "-icon";
    node.replaceChildren();
    if (kind === "phone") {
      node.append(document.createElement("i"), document.createElement("i"));
    } else if (kind === "card") {
      const image = document.createElement("img");
      image.src = "/assets/cashu.png";
      image.alt = "";
      node.append(image);
    } else {
      node.textContent =
        kind === "mint" ? "◈" : kind === "signature" ? "✦" : kind === "check" ? "✓" : "";
    }
  }
  function selectStage(index, animate = true) {
    current = index;
    const stage = stages[index];
    film.dataset.step = String(index);
    $("#film-number").textContent = String(index + 1).padStart(2, "0") + " / 04";
    $("#film-status").textContent =
      String(index + 1).padStart(2, "0") + " / " + stage.label;
    $(".detail-number").textContent =
      String(index + 1).padStart(2, "0") + " / " + stage.label;
    $("#detail-title").textContent = stage.title;
    $("#detail-copy").textContent = stage.copy;
    $("#story-panel").setAttribute("aria-labelledby", "step-" + index);
    stage.actors.forEach(([kind, name, detail], i) => {
      makeIcon($("#actor-icon-" + i), kind);
      $("#actor-name-" + i).textContent = name;
      $("#actor-detail-" + i).textContent = detail;
    });
    stage.rails.forEach((label, i) => {
      $("#rail-label-" + i).textContent = label;
    });
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    clearTimeout(animationTimer);
    film.classList.remove("is-animating");
    if (animate && root.dataset.motion !== "reduce") {
      void film.offsetWidth;
      film.classList.add("is-animating");
      animationTimer = setTimeout(() => film.classList.remove("is-animating"), 3150);
    }
  }
  function setPlayLabel(label) {
    playButton.setAttribute("aria-label", label + " story");
    $(".play-label").textContent = label;
    playButton.querySelector("span[aria-hidden]").textContent =
      label === "Pause" ? "Ⅱ" : "▶";
  }
  function stopPlay() {
    clearTimeout(stepTimer);
    playing = false;
    setPlayLabel("Replay");
  }
  function advance() {
    if (!playing) return;
    if (current === stages.length - 1) {
      stopPlay();
      return;
    }
    selectStage(current + 1);
    stepTimer = setTimeout(advance, 3400);
  }
  function startPlay() {
    if (root.dataset.motion === "reduce") return;
    clearTimeout(stepTimer);
    autoPlayed = true;
    playing = true;
    setPlayLabel("Pause");
    selectStage(0);
    stepTimer = setTimeout(advance, 3400);
  }
  function setMotion(reduce) {
    root.dataset.motion = reduce ? "reduce" : "full";
    motionButton.setAttribute("aria-pressed", String(reduce));
    motionButton.replaceChildren(
      document.createTextNode(reduce ? "Enable motion " : "Reduce motion "),
    );
    const symbol = document.createElement("span");
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = reduce ? "↗" : "◌";
    motionButton.append(symbol);
    playButton.disabled = reduce;
    playButton.title = reduce ? "Choose a step to explore the flow" : "";
    if (reduce) {
      if (playing) stopPlay();
      film.classList.remove("is-animating");
    }
  }
  setMotion(motionPreference.matches);
  motionButton.addEventListener("click", () => {
    explicitMotion = true;
    setMotion(root.dataset.motion !== "reduce");
  });
  motionPreference.addEventListener("change", (event) => {
    if (!explicitMotion) setMotion(event.matches);
  });
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (playing) stopPlay();
      autoPlayed = true;
      selectStage(Number(tab.dataset.step));
    });
  });
  $(".story-steps").addEventListener("keydown", (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % tabs.length;
    else if (["ArrowLeft", "ArrowUp"].includes(event.key))
      next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].click();
    tabs[next].focus();
  });
  playButton.addEventListener("click", () => {
    if (playing) stopPlay();
    else startPlay();
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          !autoPlayed &&
          root.dataset.motion !== "reduce"
        ) {
          observer.disconnect();
          startPlay();
        }
      },
      { threshold: 0.18 },
    );
    observer.observe($("#story"));
  }
})();

// The install guide: a copy button on each command, and the contents rail marks the section in view.
// Without JavaScript the commands stay selectable text and the rail stays a list of links.
(() => {
  const commands = document.querySelectorAll(".cmd");
  const feedback = document.createElement("span");
  if (commands.length) {
    feedback.className = "guide-copy-feedback";
    feedback.setAttribute("role", "status");
    document.querySelector("main").prepend(feedback);
  }
  commands.forEach((fig) => {
    const head = fig.querySelector(".cmd-head"), code = fig.querySelector("pre code");
    if (!head || !code) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "copy";
    b.textContent = "Copy";
    const section = fig.closest("li, section");
    const heading = section?.querySelector("h3, h2");
    const context = [heading?.textContent.trim(), head.textContent.trim()].filter(Boolean).join(", ");
    b.setAttribute("aria-label", context ? "Copy command: " + context : "Copy command");
    let timer;

    b.addEventListener("click", async () => {
      clearTimeout(timer);
      feedback.textContent = "";
      try {
        await navigator.clipboard.writeText(code.textContent);
        b.textContent = "Copied";
        feedback.textContent = "Command copied.";
        b.classList.add("done");
      } catch (_) {
        // the clipboard is closed to this page: select the command so the keyboard can copy it
        const r = document.createRange();
        r.selectNodeContents(code);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        b.textContent = "Selected";
        feedback.textContent = "Command selected. Use your device’s Copy action.";
      }
      timer = setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1600);
    });
    head.appendChild(b);
  });

  const links = [...document.querySelectorAll(".guide-rail a")];
  const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
  if (!("IntersectionObserver" in window) || !sections.length) return;
  const inView = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? inView.add(e.target) : inView.delete(e.target)));
    const first = sections.find((s) => inView.has(s));
    if (!first) return;
    links.forEach((link) => {
      const active = link.hash === "#" + first.id;
      link.classList.toggle("on", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }, { rootMargin: "-15% 0px -65% 0px" });
  sections.forEach((s) => io.observe(s));
})();

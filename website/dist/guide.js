// The install guide: a copy button on each command, and the contents rail marks the section in view.
// Without JavaScript the commands stay selectable text and the rail stays a list of links.
(() => {
  document.querySelectorAll(".cmd").forEach((fig) => {
    const head = fig.querySelector(".cmd-head"), code = fig.querySelector("pre code");
    if (!head || !code) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "copy";
    b.textContent = "Copy";
    b.setAttribute("aria-label", "Copy the command");
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        b.textContent = "Copied";
        b.classList.add("done");
      } catch (_) {
        // the clipboard is closed to this page: select the command so the keyboard can copy it
        const r = document.createRange();
        r.selectNodeContents(code);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        b.textContent = "Selected";
      }
      setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1600);
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
    if (first) links.forEach((a) => a.classList.toggle("on", a.hash === "#" + first.id));
  }, { rootMargin: "-15% 0px -65% 0px" });
  sections.forEach((s) => io.observe(s));
})();

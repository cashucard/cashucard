// Leave ordinary fragment navigation intact, including browser back and forward.
(() => {
  function openAnswer(hash) {
    const answer = document.getElementById(hash.slice(1));
    if (answer && answer.matches(".faq details")) answer.open = true;
  }
  openAnswer(location.hash);
  window.addEventListener("hashchange", () => openAnswer(location.hash));
  // A second click on the same link has no hashchange event after someone closes the answer.
  document.querySelectorAll(".question-shortcuts a").forEach(link => {
    link.addEventListener("click", () => openAnswer(link.hash));
  });
})();

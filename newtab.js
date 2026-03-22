(() => {
  const input = document.querySelector(".search-input");
  if (!input) return;

  requestAnimationFrame(() => {
    input.focus();
  });
})();

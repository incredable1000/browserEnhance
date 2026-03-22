(() => {
  let badge = null;

  function ensureBadge() {
    if (badge) return badge;

    const el = document.createElement("div");
    el.setAttribute(
      "style",
      [
        "position:fixed",
        "right:16px",
        "top:16px",
        "z-index:2147483647",
        "padding:6px 12px",
        "border-radius:999px",
        "background:rgba(22, 200, 120, 0.92)",
        "color:#fff",
        "font:12px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif",
        "letter-spacing:0.02em",
        "box-shadow:0 10px 22px rgba(22, 200, 120, 0.28)",
        "pointer-events:none",
        "opacity:0",
        "transform:translateY(-6px)",
        "transition:opacity 160ms ease, transform 160ms ease"
      ].join(";")
    );

    document.documentElement.appendChild(el);
    badge = el;
    return el;
  }

  function showBadge(text) {
    const el = ensureBadge();
    el.textContent = `Session: ${text}`;
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  }

  function hideBadge() {
    if (!badge) return;
    badge.style.opacity = "0";
    badge.style.transform = "translateY(-6px)";
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;
    if (message.type === "SESSION_INDICATOR_UPDATE") {
      const name = message.name || "Session";
      showBadge(name);
    }
    if (message.type === "SESSION_INDICATOR_CLEAR") {
      hideBadge();
    }
  });
})();

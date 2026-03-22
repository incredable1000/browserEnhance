(() => {
  const DRAG_THRESHOLD_PX = 24;
  const VERTICAL_TOLERANCE_PX = 80;
  const SUPPRESS_CLICK_MS = 1000;
  const INDICATOR_OFFSET_X = 14;
  const INDICATOR_OFFSET_Y = 18;

  let activeDrag = null;
  let suppressClick = {
    link: null,
    until: 0
  };
  let indicatorEl = null;

  const LINK_SELECTOR = "a[href], area[href], [data-href], [data-url], [role='link'][href]";

  function normalizeUrl(raw) {
    if (!raw || typeof raw !== "string") return null;
    try {
      const url = new URL(raw, document.baseURI);
      if (url.protocol === "javascript:") return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function extractLinkInfo(node) {
    if (!node || node.nodeType !== 1) return null;

    const el = node;
    const tagName = el.tagName;

    if ((tagName === "A" || tagName === "AREA") && el.href) {
      return { element: el, url: el.href };
    }

    if (typeof el.getAttribute === "function") {
      const raw =
        el.getAttribute("href") ||
        el.getAttribute("xlink:href") ||
        el.getAttribute("data-href") ||
        el.getAttribute("data-url");

      const url = normalizeUrl(raw);
      if (url) return { element: el, url };
    }

    return null;
  }

  function getLinkFromEvent(event) {
    if (!event) return null;

    const path = typeof event.composedPath === "function" ? event.composedPath() : null;
    if (path && path.length) {
      for (const node of path) {
        const info = extractLinkInfo(node);
        if (info) return info;

        if (node && typeof node.closest === "function") {
          const closest = node.closest(LINK_SELECTOR);
          const closestInfo = extractLinkInfo(closest);
          if (closestInfo) return closestInfo;
        }
      }
    }

    const target = event.target;
    if (target && typeof target.closest === "function") {
      const closest = target.closest(LINK_SELECTOR);
      const closestInfo = extractLinkInfo(closest || target);
      if (closestInfo) return closestInfo;
    }

    return null;
  }

  function shouldTrigger(event) {
    if (!activeDrag) return false;

    const dx = event.clientX - activeDrag.startX;
    const dy = event.clientY - activeDrag.startY;

    if (dx < DRAG_THRESHOLD_PX) return false;
    if (Math.abs(dy) > VERTICAL_TOLERANCE_PX) return false;

    return true;
  }

  function onPointerDown(event) {
    if (!event.isTrusted) return;
    if (typeof event.button === "number" && event.button !== 0) return;

    const linkInfo = getLinkFromEvent(event);
    if (!linkInfo) return;

    activeDrag = {
      link: linkInfo.element,
      url: linkInfo.url,
      startX: event.clientX,
      startY: event.clientY,
      triggered: false
    };

    if (event.target && typeof event.target.setPointerCapture === "function") {
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures.
      }
    }
  }

  function onPointerMove(event) {
    if (!activeDrag) return;
    if (!event.isTrusted) return;

    if (!activeDrag.triggered && shouldTrigger(event)) {
      activeDrag.triggered = true;
      showIndicator();
    }

    if (activeDrag.triggered) {
      event.preventDefault();
      positionIndicator(event.clientX, event.clientY);
    }
  }

  function openLinkFromActiveDrag() {
    const url = activeDrag && activeDrag.url;
    if (!url) return;

    chrome.runtime.sendMessage(
      {
        type: "OPEN_LINK_NEXT_TO_CURRENT",
        url
      },
      () => {
        if (chrome.runtime.lastError) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      }
    );
  }

  function onPointerUp(event) {
    if (!activeDrag) return;

    if (activeDrag.triggered) {
      suppressClick = {
        link: activeDrag.link,
        until: performance.now() + SUPPRESS_CLICK_MS
      };

      if (event && event.isTrusted) {
        event.preventDefault();
        event.stopPropagation();
      }

      openLinkFromActiveDrag();
    }

    hideIndicator();
    activeDrag = null;
  }

  function cancelActiveDrag() {
    hideIndicator();
    activeDrag = null;
  }

  function onClick(event) {
    if (!suppressClick.link) return;
    if (performance.now() > suppressClick.until) {
      suppressClick.link = null;
      return;
    }

    const linkInfo = getLinkFromEvent(event);
    if (!linkInfo || linkInfo.element !== suppressClick.link) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick.link = null;
  }

  if (typeof PointerEvent !== "undefined") {
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", cancelActiveDrag, true);
  } else {
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("mousemove", onPointerMove, true);
    document.addEventListener("mouseup", onPointerUp, true);
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener(
    "dragstart",
    (event) => {
      if (activeDrag) event.preventDefault();
    },
    true
  );
  window.addEventListener("blur", cancelActiveDrag, true);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) cancelActiveDrag();
    },
    true
  );

  function ensureIndicator() {
    if (indicatorEl) return indicatorEl;

    const el = document.createElement("div");
    el.textContent = "Open in new tab \u2192";
    el.setAttribute(
      "style",
      [
        "position:fixed",
        "z-index:2147483647",
        "top:0",
        "left:0",
        "padding:6px 10px",
        "border-radius:999px",
        "background:rgba(0,0,0,0.78)",
        "color:#fff",
        "font:12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif",
        "box-shadow:0 6px 18px rgba(0,0,0,0.18)",
        "transform:translate(-9999px,-9999px)",
        "pointer-events:none",
        "user-select:none",
        "opacity:0",
        "transition:opacity 120ms ease"
      ].join(";")
    );
    document.documentElement.appendChild(el);
    indicatorEl = el;
    return el;
  }

  function showIndicator() {
    const el = ensureIndicator();
    el.style.opacity = "1";
  }

  function hideIndicator() {
    if (!indicatorEl) return;
    indicatorEl.style.opacity = "0";
    indicatorEl.style.transform = "translate(-9999px,-9999px)";
  }

  function positionIndicator(x, y) {
    const el = ensureIndicator();
    const posX = Math.max(8, x + INDICATOR_OFFSET_X);
    const posY = Math.max(8, y + INDICATOR_OFFSET_Y);
    el.style.transform = `translate(${posX}px, ${posY}px)`;
  }
})();

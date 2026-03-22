(() => {
  const DEADZONE_PX = 6;
  const FIRST_SEGMENT_PX = 24;
  const SECOND_SEGMENT_PX = 36;
  const DIR_RATIO = 1.2;
  const CONTEXTMENU_SUPPRESS_MS = 800;
  const TRAIL_COLOR = "rgba(22, 200, 120, 0.95)";
  const TRAIL_SHADOW = "rgba(22, 200, 120, 0.35)";
  const TRAIL_WIDTH = 3;

  let gesture = null;
  let suppressContextMenuUntil = 0;
  let trailCanvas = null;
  let trailCtx = null;
  let trailPoints = [];
  let drawScheduled = false;

  function ensureCanvas() {
    if (trailCanvas) return trailCanvas;

    const canvas = document.createElement("canvas");
    canvas.setAttribute(
      "style",
      [
        "position:fixed",
        "inset:0",
        "width:100%",
        "height:100%",
        "pointer-events:none",
        "z-index:2147483646"
      ].join(";")
    );
    document.documentElement.appendChild(canvas);
    trailCanvas = canvas;
    trailCtx = canvas.getContext("2d");
    resizeCanvas();
    return canvas;
  }

  function resizeCanvas() {
    if (!trailCanvas || !trailCtx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    trailCanvas.width = Math.round(width * dpr);
    trailCanvas.height = Math.round(height * dpr);
    trailCanvas.style.width = `${width}px`;
    trailCanvas.style.height = `${height}px`;
    trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearTrail();
  }

  function scheduleDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => {
      drawScheduled = false;
      drawTrail();
    });
  }

  function addTrailPoint(x, y) {
    trailPoints.push({ x, y });
    scheduleDraw();
  }

  function drawTrail() {
    if (!trailCtx || !trailCanvas) return;
    trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    if (trailPoints.length < 2) return;

    trailCtx.lineWidth = TRAIL_WIDTH;
    trailCtx.strokeStyle = TRAIL_COLOR;
    trailCtx.lineCap = "round";
    trailCtx.lineJoin = "round";
    trailCtx.shadowColor = TRAIL_SHADOW;
    trailCtx.shadowBlur = 8;

    trailCtx.beginPath();
    trailCtx.moveTo(trailPoints[0].x, trailPoints[0].y);

    for (let i = 1; i < trailPoints.length - 1; i += 1) {
      const current = trailPoints[i];
      const next = trailPoints[i + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      trailCtx.quadraticCurveTo(current.x, current.y, midX, midY);
    }

    const last = trailPoints[trailPoints.length - 1];
    trailCtx.lineTo(last.x, last.y);
    trailCtx.stroke();
    trailCtx.shadowBlur = 0;
  }

  function clearTrail() {
    trailPoints = [];
    if (trailCtx && trailCanvas) {
      trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    }
  }

  function startGesture(event) {
    if (!event.isTrusted) return;
    if (typeof event.button === "number" && event.button !== 2) return;

    gesture = {
      startX: event.clientX,
      startY: event.clientY,
      cornerX: event.clientX,
      cornerY: event.clientY,
      stage: 0,
      type: null,
      completed: null,
      moved: false,
      tick: 0,
      triggered: false
    };
  }

  function updateGesture(event) {
    if (!gesture || !event.isTrusted) return;

    if (typeof event.buttons === "number" && (event.buttons & 2) === 0) {
      cancelGesture();
      return;
    }

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    gesture.tick += 1;

    if (Math.abs(dx) > DEADZONE_PX || Math.abs(dy) > DEADZONE_PX) {
      gesture.moved = true;
      suppressContextMenuUntil = performance.now() + CONTEXTMENU_SUPPRESS_MS;
      ensureCanvas();
      if (trailPoints.length === 0) {
        addTrailPoint(gesture.startX, gesture.startY);
      }
      addTrailPoint(event.clientX, event.clientY);
    }

    if (gesture.stage === 0) {
      if (dy >= FIRST_SEGMENT_PX && dy >= Math.abs(dx) * DIR_RATIO) {
        gesture.stage = 1;
        gesture.type = "DOWN_THEN_H";
        gesture.cornerX = event.clientX;
        gesture.cornerY = event.clientY;
      }
    } else if (gesture.stage === 1 && !gesture.completed) {
      if (gesture.type === "DOWN_THEN_H") {
        const dx2 = event.clientX - gesture.cornerX;
        if (dx2 >= SECOND_SEGMENT_PX) {
          gesture.completed = "RIGHT";
        } else if (dx2 <= -SECOND_SEGMENT_PX) {
          gesture.completed = "LEFT";
        }
      }
    }

    if (gesture.moved) {
      event.preventDefault();
    }
  }

  function endGesture(event) {
    if (!gesture) return;

    const direction = gesture.completed;
    if (direction) {
      gesture.triggered = true;
      chrome.runtime.sendMessage({
        type: direction === "RIGHT" ? "CLOSE_TAB_FOCUS_RIGHT" : "CLOSE_TAB_FOCUS_LEFT"
      });

      if (event && event.isTrusted) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    gesture = null;
    clearTrail();
  }

  function cancelGesture() {
    gesture = null;
    clearTrail();
  }

  function onContextMenu(event) {
    if (!gesture) return;
    if (gesture.triggered || gesture.moved || performance.now() < suppressContextMenuUntil) {
      event.preventDefault();
    }
  }

  if (typeof PointerEvent !== "undefined") {
    document.addEventListener("pointerdown", startGesture, true);
    document.addEventListener("pointermove", updateGesture, true);
    document.addEventListener("pointerup", endGesture, true);
    document.addEventListener("pointercancel", cancelGesture, true);
  } else {
    document.addEventListener("mousedown", startGesture, true);
    document.addEventListener("mousemove", updateGesture, true);
    document.addEventListener("mouseup", endGesture, true);
  }

  document.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("blur", cancelGesture, true);
  window.addEventListener("resize", resizeCanvas, true);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) cancelGesture();
    },
    true
  );
})();

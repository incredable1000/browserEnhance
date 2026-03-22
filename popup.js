(() => {
  const hostStatusEl = document.getElementById("hostStatus");
  const sessionNameInput = document.getElementById("sessionName");
  const createBtn = document.getElementById("createSession");
  const assignBtn = document.getElementById("assignCurrent");
  const detachBtn = document.getElementById("detachCurrent");
  const sessionsContainer = document.getElementById("sessions");

  let currentTabId = null;
  let sessionCache = [];

  function setStatus(ok, text) {
    hostStatusEl.textContent = text;
    hostStatusEl.classList.remove("ok", "error");
    hostStatusEl.classList.add(ok ? "ok" : "error");
  }

  function renderSessions(list) {
    sessionsContainer.innerHTML = "";
    const entries = Object.values(list || {});
    sessionCache = entries;
    if (!entries.length) {
      sessionsContainer.innerHTML = "<div class=\"session-card\">No sessions yet.</div>";
      return;
    }

    for (const session of entries) {
      const card = document.createElement("div");
      card.className = "session-card";

      const title = document.createElement("div");
      title.className = "session-title";
      title.textContent = session.name || session.id;

      const actions = document.createElement("div");
      actions.className = "session-actions";

      const assignButton = document.createElement("button");
      assignButton.textContent = "Assign tab";
      assignButton.addEventListener("click", () => assignSession(session.id));

      const openButton = document.createElement("button");
      openButton.textContent = "Open new tab";
      openButton.addEventListener("click", () => openSessionTab(session.id));

      actions.appendChild(assignButton);
      actions.appendChild(openButton);

      card.appendChild(title);
      card.appendChild(actions);
      sessionsContainer.appendChild(card);
    }
  }

  function loadSessions() {
    chrome.runtime.sendMessage({ type: "SESSION_LIST" }, (response) => {
      renderSessions(response ? response.sessions : {});
    });
  }

  function assignSession(sessionId) {
    if (!currentTabId) return;
    chrome.runtime.sendMessage(
      {
        type: "SESSION_ASSIGN",
        tabId: currentTabId,
        sessionId
      },
      () => {}
    );
  }

  function openSessionTab(sessionId) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const current = tabs && tabs[0];
      const url = current && current.url ? current.url : "about:blank";
      chrome.runtime.sendMessage({ type: "SESSION_OPEN_TAB", sessionId, url }, () => {});
    });
  }

  function detachSession() {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ type: "SESSION_DETACH", tabId: currentTabId }, () => {});
  }

  function createSession() {
    const name = sessionNameInput.value.trim();
    if (!name) return;
    chrome.runtime.sendMessage({ type: "SESSION_CREATE", name }, () => {
      sessionNameInput.value = "";
      loadSessions();
    });
  }

  function checkHost() {
    chrome.runtime.sendMessage({ type: "SESSION_HOST_PING" }, (response) => {
      if (response && response.ok) {
        setStatus(true, "Native host: connected");
      } else {
        setStatus(false, "Native host: not connected");
      }
    });
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    currentTabId = tab ? tab.id : null;
  });

  createBtn.addEventListener("click", createSession);
  sessionNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") createSession();
  });
  assignBtn.addEventListener("click", () => {
    const name = sessionNameInput.value.trim();
    if (name) {
      const match = sessionCache.find(
        (session) => session.name && session.name.toLowerCase() === name.toLowerCase()
      );
      if (match) {
        assignSession(match.id);
        return;
      }
      chrome.runtime.sendMessage({ type: "SESSION_CREATE", name }, (response) => {
        if (response && response.sessionId) {
          assignSession(response.sessionId);
          loadSessions();
          sessionNameInput.value = "";
        }
      });
      return;
    }

    if (sessionCache.length) {
      assignSession(sessionCache[0].id);
    }
  });
  detachBtn.addEventListener("click", detachSession);

  loadSessions();
  checkHost();
})();

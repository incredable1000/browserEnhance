(() => {
  const HOST_NAME = "com.incredable.browserenhance.sessions";
  const STORAGE_SESSIONS_KEY = "sessions";
  const STORAGE_TAB_MAP_KEY = "sessionTabMap";

  let sessions = {};
  let tabSessionMap = new Map();
  const attachedTabs = new Set();

  const nativeClient = {
    port: null,
    nextId: 1,
    pending: new Map(),
    connect() {
      if (this.port) return;
      try {
        this.port = chrome.runtime.connectNative(HOST_NAME);
      } catch (error) {
        this.port = null;
        throw error;
      }

      this.port.onMessage.addListener((message) => {
        const id = message && message.id;
        if (!id || !this.pending.has(id)) return;
        const { resolve } = this.pending.get(id);
        this.pending.delete(id);
        resolve(message);
      });

      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : "Native host disconnected.";
        for (const { reject } of this.pending.values()) {
          reject(new Error(error));
        }
        this.pending.clear();
        this.port = null;
      });
    },
    async send(payload) {
      if (!this.port) this.connect();
      const id = this.nextId++;
      const message = { ...payload, id };
      const response = new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
      });
      this.port.postMessage(message);
      return response;
    }
  };

  async function loadSessions() {
    const stored = await chrome.storage.local.get({
      [STORAGE_SESSIONS_KEY]: {},
      [STORAGE_TAB_MAP_KEY]: {}
    });
    sessions = stored[STORAGE_SESSIONS_KEY] || {};
    const rawMap = stored[STORAGE_TAB_MAP_KEY] || {};
    tabSessionMap = new Map(
      Object.entries(rawMap).map(([tabId, sessionId]) => [Number(tabId), sessionId])
    );
    restoreActiveTabs();
  }

  function persistSessions() {
    return chrome.storage.local.set({ [STORAGE_SESSIONS_KEY]: sessions });
  }

  function persistTabMap() {
    const raw = {};
    for (const [tabId, sessionId] of tabSessionMap.entries()) {
      raw[String(tabId)] = sessionId;
    }
    return chrome.storage.local.set({ [STORAGE_TAB_MAP_KEY]: raw });
  }

  function makeSessionId() {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function getSessionName(sessionId) {
    const entry = sessions[sessionId];
    return entry ? entry.name : "Session";
  }

  function sendIndicator(tabId, sessionId) {
    const name = getSessionName(sessionId);
    chrome.tabs.sendMessage(tabId, {
      type: "SESSION_INDICATOR_UPDATE",
      name
    });
  }

  function clearIndicator(tabId) {
    chrome.tabs.sendMessage(tabId, { type: "SESSION_INDICATOR_CLEAR" });
  }

  function attachDebugger(tabId) {
    if (attachedTabs.has(tabId)) return;
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) return;
      attachedTabs.add(tabId);
      chrome.debugger.sendCommand(
        { tabId },
        "Fetch.enable",
        {
          patterns: [
            { urlPattern: "*", requestStage: "Request" },
            { urlPattern: "*", requestStage: "Response" }
          ]
        },
        () => {}
      );
    });
  }

  function detachDebugger(tabId) {
    if (!attachedTabs.has(tabId)) return;
    chrome.debugger.detach({ tabId }, () => {
      attachedTabs.delete(tabId);
    });
  }

  async function assignSessionToTab(tabId, sessionId) {
    tabSessionMap.set(tabId, sessionId);
    await persistTabMap();
    attachDebugger(tabId);
    sendIndicator(tabId, sessionId);
  }

  async function detachSessionFromTab(tabId) {
    if (!tabSessionMap.has(tabId)) return;
    tabSessionMap.delete(tabId);
    await persistTabMap();
    clearIndicator(tabId);
    detachDebugger(tabId);
  }

  function restoreActiveTabs() {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs || []) {
        if (!tab || typeof tab.id !== "number") continue;
        const sessionId = tabSessionMap.get(tab.id);
        if (sessionId) {
          attachDebugger(tab.id);
          sendIndicator(tab.id, sessionId);
        }
      }
    });
  }

  async function handleRequestPaused(source, params) {
    const tabId = source.tabId;
    if (typeof tabId !== "number") return;

    const sessionId = tabSessionMap.get(tabId);
    if (!sessionId) {
      if (params.responseStatusCode) {
        chrome.debugger.sendCommand(
          source,
          "Fetch.continueResponse",
          { requestId: params.requestId },
          () => {
            if (chrome.runtime.lastError) {
              chrome.debugger.sendCommand(
                source,
                "Fetch.continueRequest",
                { requestId: params.requestId },
                () => {}
              );
            }
          }
        );
      } else {
        chrome.debugger.sendCommand(source, "Fetch.continueRequest", { requestId: params.requestId }, () => {});
      }
      return;
    }

    if (params.responseStatusCode) {
      await handleResponseStage(source, params, sessionId);
    } else {
      await handleRequestStage(source, params, sessionId);
    }
  }

  async function handleRequestStage(source, params, sessionId) {
    const requestId = params.requestId;
    const url = params.request && params.request.url ? params.request.url : "";

    let cookieHeader = "";
    try {
      const response = await nativeClient.send({
        type: "getCookies",
        sessionId,
        url
      });
      cookieHeader = response && response.cookies ? response.cookies : "";
    } catch {
      cookieHeader = "";
    }

    const headers = params.request && params.request.headers ? params.request.headers : {};
    const headerEntries = [];
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === "cookie") continue;
      headerEntries.push({ name, value: String(value) });
    }
    if (cookieHeader) {
      headerEntries.push({ name: "Cookie", value: cookieHeader });
    }

    chrome.debugger.sendCommand(
      source,
      "Fetch.continueRequest",
      {
        requestId,
        headers: headerEntries
      },
      () => {}
    );
  }

  async function handleResponseStage(source, params, sessionId) {
    const requestId = params.requestId;
    const url = params.request && params.request.url ? params.request.url : "";
    const responseHeaders = params.responseHeaders || [];

    const setCookieHeaders = responseHeaders
      .filter((header) => header.name && header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value);

    if (setCookieHeaders.length) {
      try {
        nativeClient
          .send({
            type: "setCookies",
            sessionId,
            url,
            setCookies: setCookieHeaders
          })
          .catch(() => {});
      } catch {
        // Ignore host failures.
      }
    }

    const filteredHeaders = responseHeaders.filter(
      (header) => !(header.name && header.name.toLowerCase() === "set-cookie")
    );

    chrome.debugger.sendCommand(
      source,
      "Fetch.continueResponse",
      {
        requestId,
        responseHeaders: filteredHeaders
      },
      () => {
        if (chrome.runtime.lastError) {
          chrome.debugger.sendCommand(source, "Fetch.continueRequest", { requestId }, () => {});
        }
      }
    );
  }

  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method !== "Fetch.requestPaused") return;
    handleRequestPaused(source, params);
  });

  chrome.debugger.onDetach.addListener((source) => {
    if (source && typeof source.tabId === "number") {
      attachedTabs.delete(source.tabId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (!tabSessionMap.has(tabId)) return;
    tabSessionMap.delete(tabId);
    persistTabMap();
    detachDebugger(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "complete") return;
    const sessionId = tabSessionMap.get(tabId);
    if (sessionId) {
      sendIndicator(tabId, sessionId);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === "SESSION_LIST") {
      sendResponse({ sessions });
      return true;
    }

    if (message.type === "SESSION_CREATE") {
      const name = typeof message.name === "string" && message.name.trim() ? message.name.trim() : "Session";
      const sessionId = makeSessionId();
      sessions[sessionId] = { id: sessionId, name, createdAt: Date.now() };
      persistSessions().then(() => {
        sendResponse({ ok: true, sessionId, sessions });
      });
      return true;
    }

    if (message.type === "SESSION_ASSIGN") {
      const tabId = message.tabId;
      const sessionId = message.sessionId;
      if (typeof tabId !== "number" || !sessionId) {
        sendResponse({ ok: false });
        return true;
      }
      assignSessionToTab(tabId, sessionId).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "SESSION_DETACH") {
      const tabId = message.tabId;
      if (typeof tabId !== "number") {
        sendResponse({ ok: false });
        return true;
      }
      detachSessionFromTab(tabId).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "SESSION_OPEN_TAB") {
      const sessionId = message.sessionId;
      const url = typeof message.url === "string" && message.url ? message.url : "about:blank";
      chrome.tabs.create({ url }, (tab) => {
        if (tab && typeof tab.id === "number") {
          assignSessionToTab(tab.id, sessionId).then(() => {});
        }
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "SESSION_HOST_PING") {
      try {
        nativeClient
          .send({ type: "ping" })
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    return false;
  });

  chrome.runtime.onInstalled.addListener(() => {
    loadSessions();
  });

  chrome.runtime.onStartup.addListener(() => {
    loadSessions();
  });

  loadSessions();
})();

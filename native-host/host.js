const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "sessions.json");

let state = { sessions: {} };

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      state = JSON.parse(raw);
    }
  } catch {
    state = { sessions: {} };
  }
}

function saveState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Ignore write failures.
  }
}

function getSession(sessionId) {
  if (!state.sessions[sessionId]) {
    state.sessions[sessionId] = { cookies: [] };
  }
  return state.sessions[sessionId];
}

function normalizeDomain(domain) {
  return domain.replace(/^\./, "").toLowerCase();
}

function defaultPath(pathname) {
  if (!pathname || !pathname.startsWith("/")) return "/";
  if (pathname === "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return pathname.slice(0, lastSlash + 1);
}

function parseSetCookie(setCookie, urlObj) {
  const parts = setCookie.split(";").map((part) => part.trim());
  const first = parts.shift();
  if (!first) return null;
  const eqIndex = first.indexOf("=");
  if (eqIndex <= 0) return null;

  const name = first.slice(0, eqIndex).trim();
  const value = first.slice(eqIndex + 1).trim();

  const cookie = {
    name,
    value,
    domain: urlObj.hostname.toLowerCase(),
    path: defaultPath(urlObj.pathname),
    expires: null,
    secure: false,
    httpOnly: false,
    sameSite: null,
    hostOnly: true
  };

  for (const attr of parts) {
    const [rawKey, ...rawValue] = attr.split("=");
    const key = rawKey.trim().toLowerCase();
    const valuePart = rawValue.join("=").trim();

    if (key === "domain" && valuePart) {
      cookie.domain = normalizeDomain(valuePart);
      cookie.hostOnly = false;
    } else if (key === "path" && valuePart) {
      cookie.path = valuePart;
    } else if (key === "expires" && valuePart) {
      const expires = Date.parse(valuePart);
      if (!Number.isNaN(expires)) cookie.expires = expires;
    } else if (key === "max-age" && valuePart) {
      const seconds = Number.parseInt(valuePart, 10);
      if (!Number.isNaN(seconds)) cookie.expires = Date.now() + seconds * 1000;
    } else if (key === "secure") {
      cookie.secure = true;
    } else if (key === "httponly") {
      cookie.httpOnly = true;
    } else if (key === "samesite" && valuePart) {
      cookie.sameSite = valuePart;
    }
  }

  return cookie;
}

function domainMatches(hostname, cookie) {
  const host = hostname.toLowerCase();
  const domain = cookie.domain.toLowerCase();
  if (cookie.hostOnly) {
    return host === domain;
  }
  return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(pathname, cookiePath) {
  const requestPath = pathname || "/";
  const targetPath = cookiePath || "/";
  return requestPath.startsWith(targetPath);
}

function isExpired(cookie) {
  return cookie.expires !== null && cookie.expires <= Date.now();
}

function pruneCookies(session) {
  session.cookies = session.cookies.filter((cookie) => !isExpired(cookie));
}

function storeCookie(session, cookie) {
  session.cookies = session.cookies.filter(
    (existing) =>
      !(
        existing.name === cookie.name &&
        existing.domain === cookie.domain &&
        existing.path === cookie.path
      )
  );

  if (!isExpired(cookie)) {
    session.cookies.push(cookie);
  }
}

function getCookieHeader(session, urlObj) {
  pruneCookies(session);
  const isHttps = urlObj.protocol === "https:";
  const path = urlObj.pathname || "/";

  const matches = session.cookies.filter((cookie) => {
    if (cookie.secure && !isHttps) return false;
    if (!domainMatches(urlObj.hostname, cookie)) return false;
    if (!pathMatches(path, cookie.path)) return false;
    return true;
  });

  matches.sort((a, b) => (b.path || "").length - (a.path || "").length);
  return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function handleGetCookies(message) {
  const url = message.url;
  if (!url) return { cookies: "" };

  let urlObj = null;
  try {
    urlObj = new URL(url);
  } catch {
    return { cookies: "" };
  }

  const session = getSession(message.sessionId || "default");
  const cookies = getCookieHeader(session, urlObj);
  saveState();
  return { cookies };
}

function handleSetCookies(message) {
  const url = message.url;
  if (!url) return { ok: false };

  let urlObj = null;
  try {
    urlObj = new URL(url);
  } catch {
    return { ok: false };
  }

  const session = getSession(message.sessionId || "default");
  const setCookies = Array.isArray(message.setCookies) ? message.setCookies : [];

  for (const header of setCookies) {
    const cookie = parseSetCookie(header, urlObj);
    if (!cookie) continue;
    storeCookie(session, cookie);
  }

  saveState();
  return { ok: true };
}

function handleClearSession(message) {
  if (!message.sessionId) return { ok: false };
  delete state.sessions[message.sessionId];
  saveState();
  return { ok: true };
}

function onMessage(message) {
  if (!message || !message.type) return;
  let result = { ok: false };

  if (message.type === "ping") {
    result = { ok: true };
  } else if (message.type === "getCookies") {
    result = handleGetCookies(message);
  } else if (message.type === "setCookies") {
    result = handleSetCookies(message);
  } else if (message.type === "clearSession") {
    result = handleClearSession(message);
  } else {
    result = { ok: false, error: "Unknown message type." };
  }

  sendMessage({ id: message.id, ...result });
}

function sendMessage(message) {
  const json = JSON.stringify(message);
  const length = Buffer.byteLength(json);
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(length, 0);
  process.stdout.write(buffer);
  process.stdout.write(json);
}

function start() {
  loadState();
  let buffer = Buffer.alloc(0);

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const messageLength = buffer.readUInt32LE(0);
      if (buffer.length < messageLength + 4) break;
      const messageBuffer = buffer.slice(4, 4 + messageLength);
      buffer = buffer.slice(4 + messageLength);
      try {
        const message = JSON.parse(messageBuffer.toString("utf8"));
        onMessage(message);
      } catch {
        // Ignore invalid messages.
      }
    }
  });
}

start();

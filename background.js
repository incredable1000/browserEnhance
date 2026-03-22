function openLinkNextToCurrent(url, senderTab) {
  const index = senderTab && typeof senderTab.index === "number" ? senderTab.index + 1 : undefined;
  const openerTabId = senderTab && typeof senderTab.id === "number" ? senderTab.id : undefined;

  const createOptions = { url };
  if (typeof index === "number") createOptions.index = index;
  if (typeof openerTabId === "number") createOptions.openerTabId = openerTabId;

  chrome.tabs.create(createOptions);
}

function closeTabAndFocus(direction, senderTab) {
  if (!senderTab || typeof senderTab.id !== "number") return;

  const windowId = senderTab.windowId;
  const query = windowId ? { windowId } : { currentWindow: true };

  chrome.tabs.query(query, (tabs) => {
    if (!tabs || !tabs.length) return;
    if (tabs.length === 1) {
      chrome.tabs.remove(senderTab.id);
      return;
    }

    const ordered = tabs.slice().sort((a, b) => a.index - b.index);
    const currentPos = ordered.findIndex((tab) => tab.id === senderTab.id);
    if (currentPos === -1) return;

    let target = null;
    if (direction === "right") {
      target = ordered[currentPos + 1] || ordered[currentPos - 1];
    } else {
      target = ordered[currentPos - 1] || ordered[currentPos + 1];
    }

    chrome.tabs.remove(senderTab.id, () => {
      if (target && typeof target.id === "number") {
        chrome.tabs.update(target.id, { active: true });
      }
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  const senderTab = sender && sender.tab ? sender.tab : null;

  if (message.type === "OPEN_LINK_NEXT_TO_CURRENT") {
    const url = message.url;
    if (!url || typeof url !== "string") return false;
    openLinkNextToCurrent(url, senderTab);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "CLOSE_TAB_FOCUS_RIGHT") {
    closeTabAndFocus("right", senderTab);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "CLOSE_TAB_FOCUS_LEFT") {
    closeTabAndFocus("left", senderTab);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

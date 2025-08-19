const subscribers = new Map();
let cookieListenerAttached = false;
let onCookieChangedListener = null;

function originPatternFromUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

function attachCookieListener() {
  if (!chrome.cookies || cookieListenerAttached) return;
  onCookieChangedListener = (changeInfo) => {
    for (const [tabId, sub] of subscribers.entries()) {
      chrome.cookies.getAll({ url: sub.url }, (cookies) => {
        chrome.tabs.sendMessage(Number(tabId), { type: "COOKIES_UPDATED", cookies: cookies || [] }, () => {
          if (chrome.runtime.lastError) subscribers.delete(tabId);
        });
      });
    }
  };
  chrome.cookies.onChanged.addListener(onCookieChangedListener);
  cookieListenerAttached = true;
}

function detachCookieListener() {
  if (!chrome.cookies || !cookieListenerAttached || !onCookieChangedListener) return;
  chrome.cookies.onChanged.removeListener(onCookieChangedListener);
  onCookieChangedListener = null;
  cookieListenerAttached = false;
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender?.tab?.id;
  const originPattern = originPatternFromUrl(msg.url);

  switch (msg.type) {
    case "REQUEST_PERMISSION":
      chrome.permissions.request({ permissions: ["cookies"], origins: [originPattern] }, (granted) => {
        if (granted) attachCookieListener();
        sendResponse({ ok: granted });
      });
      return true;

    case "CHECK_PERMISSION":
      chrome.permissions.contains({ permissions: ["cookies"], origins: [originPattern] }, (has) => {
        sendResponse({ ok: true, has });
      });
      return true;

    case "FETCH_COOKIES":
      if (!chrome.cookies) return sendResponse({ ok: false, error: "No cookie permission" });
      chrome.cookies.getAll({ url: msg.url }, (cookies) => sendResponse({ ok: true, cookies: cookies || [] }));
      return true;

    case "SUBSCRIBE_COOKIE_UPDATES":
      if (tabId) subscribers.set(tabId, { url: msg.url });
      attachCookieListener();
      sendResponse({ ok: true });
      return true;

    case "UNSUBSCRIBE_COOKIE_UPDATES":
      if (tabId) subscribers.delete(tabId);
      if (subscribers.size === 0) detachCookieListener();
      sendResponse({ ok: true });
      return true;

    // case "REVOKE_PERMISSION":
    //   chrome.permissions.remove({ permissions: ["cookies"], origins: [originPattern] }, (removed) => {
    //     if (removed && tabId) subscribers.delete(tabId);
    //     if (subscribers.size === 0) detachCookieListener();
    //     sendResponse({ ok: removed });
    //   });
    //   return true;

    case "CLEAR_DOMAIN_COOKIES":
      chrome.cookies.getAll({ url: msg.url }, (cookies) => {
        let cleared = 0;
        if (!cookies || cookies.length === 0) return sendResponse({ ok: true, cleared: 0 });
        const total = cookies.length;
        cookies.forEach((c) => {
          const details = { url: (c.secure ? "https://" : "http://") + c.domain + c.path, name: c.name };
          if (c.storeId) details.storeId = c.storeId;
          chrome.cookies.remove(details, () => { cleared++; if (cleared === total) sendResponse({ ok: true, cleared }); });
        });
      });
      return true;
  }
});

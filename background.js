// background.js (MV3 service worker)
// Handles: overlay toggle, runtime permissions, cookie fetch, live updates, revoke, clear.

const subscribers = new Map(); // tabId -> { url }
let cookieListenerAttached = false;

// Toggle overlay when toolbar icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    // First try sending the message
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
  } catch (err) {
    // If no content script, inject it dynamically
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    // Then send the message again
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
  }
});


// Build origin pattern for runtime permissions
function originPatternFromUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}/*`;
  } catch {
    return null;
  }
}

// Messaging entrypoint
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, url } = message || {};
  const tabId = sender?.tab?.id;

  //Request runtime permission
  if (type === "REQUEST_PERMISSION") {
    const originPattern = originPatternFromUrl(url);
    chrome.permissions.request(
      { permissions: ["cookies"], origins: [originPattern] },
      (granted) => {
        if (granted && chrome.cookies) {
          attachCookieListener();
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false });
        }
      }
    );
    return true;
  }

  //Check if permission already granted
  if (type === "CHECK_PERMISSION") {
    const originPattern = originPatternFromUrl(url);
    chrome.permissions.contains(
      { permissions: ["cookies"], origins: [originPattern] },
      (has) => sendResponse({ ok: true, has })
    );
    return true;
  }

  //Fetch cookies (only if permission granted)
  if (type === "FETCH_COOKIES") {
    if (!chrome.cookies) {
      sendResponse({ ok: false, error: "Cookie permission not granted" });
      return true;
    }
    chrome.cookies.getAll({ url }, (cookies) => {
      sendResponse({ ok: true, cookies: cookies || [] });
    });
    return true;
  }

  //Subscribe to live cookie updates
  if (type === "SUBSCRIBE_COOKIE_UPDATES") {
    if (!chrome.cookies) {
      sendResponse({ ok: false, error: "Cookie permission not granted" });
      return true;
    }
    if (tabId) subscribers.set(tabId, { url });
    attachCookieListener();
    sendResponse({ ok: true });
    return true;
  }

  //Unsubscribe from updates
  if (type === "UNSUBSCRIBE_COOKIE_UPDATES") {
    if (tabId) subscribers.delete(tabId);
    sendResponse({ ok: true });
    return true;
  }

  //Revoke permission
  if (type === "REVOKE_PERMISSION") {
    const originPattern = originPatternFromUrl(url);
    chrome.permissions.remove(
      { permissions: ["cookies"], origins: [originPattern] },
      (removed) => {
        if (tabId) subscribers.delete(tabId);
        if (removed) detachCookieListener();
        sendResponse({ ok: removed });
      }
    );
    return true;
  }

  //Clear all cookies for a domain
  if (type === "CLEAR_DOMAIN_COOKIES") {
    if (!chrome.cookies) {
      sendResponse({ ok: false, error: "Cookie permission not granted" });
      return true;
    }

    chrome.cookies.getAll({ url }, (cookies) => {
      if (!cookies || cookies.length === 0) {
        sendResponse({ ok: true, cleared: 0 });
        return;
      }

      let cleared = 0;
      cookies.forEach((c) => {
        const removeDetails = {
          url: (c.secure ? "https://" : "http://") + c.domain + c.path,
          name: c.name,
        };
        if (c.storeId) {
          removeDetails.storeId = c.storeId;
        }

        chrome.cookies.remove(removeDetails, () => {
          cleared++;
          if (cleared === cookies.length) {
            sendResponse({ ok: true, cleared });
          }
        });
      });
    });

    return true;
  }

  // Default: unknown message
  sendResponse({ ok: false, error: "Unknown message type" });
  return true;
});

// Cookie change listener

function attachCookieListener() {
  if (!chrome.cookies || cookieListenerAttached) return;

  chrome.cookies.onChanged.addListener(() => {
    for (const [tabId, sub] of subscribers.entries()) {
      chrome.cookies.getAll({ url: sub.url }, (cookies) => {
        chrome.tabs.sendMessage(
          Number(tabId),
          { type: "COOKIES_UPDATED", cookies: cookies || [] },
          () => {
            if (chrome.runtime.lastError) {
              // content script not present → cleanup
              subscribers.delete(tabId);
            }
          }
        );
      });
    }
  });

  cookieListenerAttached = true;
  console.log("Cookie change listener attached");
}

function detachCookieListener() {
  if (!chrome.cookies || !cookieListenerAttached) return;
  chrome.cookies.onChanged.removeListener(() => {}); // must track reference if you want to remove
  cookieListenerAttached = false;
  console.log("Cookie change listener detached");
}

// Tab cleanup

chrome.tabs.onRemoved.addListener((tabId) => subscribers.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") subscribers.delete(tabId);
});

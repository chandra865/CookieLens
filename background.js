// background.js (MV3 service worker)
// Handles: overlay toggle, runtime permissions, cookie fetch, live updates, revoke, clear.

const subscribers = new Map(); // tabId -> { url, origin }

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
  }
});

function originPatternFromUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}/*`;
  } catch {
    return null;
  }
}

// Messaging between content.js and background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const { type, url } = message || {};
    const tabId = sender?.tab?.id;

    // Request runtime permission
    if (type === 'REQUEST_PERMISSION') {
      const originPattern = originPatternFromUrl(url);
      chrome.permissions.request(
        { permissions: ['cookies'], origins: [originPattern] },
        (granted) => sendResponse({ ok: granted })
      );
      return;
    }

    // Check if permission already granted
    if (type === 'CHECK_PERMISSION') {
      const originPattern = originPatternFromUrl(url);
      chrome.permissions.contains(
        { permissions: ['cookies'], origins: [originPattern] },
        (has) => sendResponse({ ok: true, has })
      );
      return;
    }

    // Fetch cookies for the domain
    if (type === 'FETCH_COOKIES') {
      try {
        const cookies = await chrome.cookies.getAll({ url });
        sendResponse({ ok: true, cookies });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return;
    }

    // Subscribe for live updates
    if (type === 'SUBSCRIBE_COOKIE_UPDATES') {
      if (tabId) subscribers.set(tabId, { url });
      sendResponse({ ok: true });
      return;
    }

    // Unsubscribe from updates
    if (type === 'UNSUBSCRIBE_COOKIE_UPDATES') {
      if (tabId) subscribers.delete(tabId);
      sendResponse({ ok: true });
      return;
    }

    // Revoke permission
    if (type === 'REVOKE_PERMISSION') {
      const originPattern = originPatternFromUrl(url);
      chrome.permissions.remove(
        { permissions: ['cookies'], origins: [originPattern] },
        (removed) => {
          if (tabId) subscribers.delete(tabId);
          sendResponse({ ok: removed });
        }
      );
      return;
    }

    // Clear all cookies for domain
    if (type === 'CLEAR_DOMAIN_COOKIES') {
      try {
        const cookies = await chrome.cookies.getAll({ url });
        await Promise.all(
          cookies.map((c) =>
            chrome.cookies.remove({ url, name: c.name, storeId: c.storeId })
          )
        );
        sendResponse({ ok: true, cleared: cookies.length });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return;
    }

    sendResponse({ ok: false, error: 'Unknown message type' });
  })();
  return true; // keeps sendResponse channel open
});

// Listen for real-time cookie changes
chrome.cookies.onChanged.addListener(async (changeInfo) => {
  for (const [tabId, sub] of subscribers.entries()) {
    try {
      const cookies = await chrome.cookies.getAll({ url: sub.url });
      chrome.tabs.sendMessage(Number(tabId), {
        type: 'COOKIES_UPDATED',
        cookies,
      });
    } catch {}
  }
});

// Cleanup when tab closes or reloads
chrome.tabs.onRemoved.addListener((tabId) => subscribers.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') subscribers.delete(tabId);
});

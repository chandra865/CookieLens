// content.js
// This script runs inside the webpage (as a content script).
// It creates the Cookie Lens overlay UI, requests runtime cookie permissions,
// communicates with background.js, and updates UI when cookies change.

(function () {
  // Declare UI elements and constants for current page
  let overlay, btnGrantShow,  btnClear, listEl, statusEl;
  //btnRevoke
  const pageUrl = location.href; // Full URL of current page
  const urlObj = new URL(pageUrl); // Parsed URL object
  const domain = urlObj.hostname; // Domain (e.g., example.com)

  // Function: Create overlay UI if not already created
  function ensureOverlay() {
    if (overlay) return; // Already exists → don't create again

    // Create overlay container
    overlay = document.createElement("div");
    overlay.id = "cookie-lens-overlay";
    overlay.className = "hidden"; // start hidden

    // Define overlay HTML
    overlay.innerHTML = `
      <div class="cl-card">
        <div class="cl-header">
          <span class="cl-title">Cookie Lens</span>
          <button id="cl-close">✕</button>
        </div>
        <div><strong>URL:</strong> ${pageUrl}</div>
        <div><strong>Domain:</strong> ${domain}</div>
        <div><strong>HTTPS:</strong> ${
          urlObj.protocol === "https:" ? "Yes" : "No"
        }</div>
        <div class="cl-actions">
          <button id="cl-grant">Grant Cookie Access</button>
          <button id="cl-clear" disabled>Clear Cookies</button>
        </div>
        <div id="cl-status"></div>
        <div id="cl-list"></div>
      </div>`;
    //<button id="cl-revoke" disabled>Revoke Access</button>


    // Inject overlay into page
    document.body.appendChild(overlay);

    // Get references to buttons and elements
    btnGrantShow = overlay.querySelector("#cl-grant");
    //btnRevoke = overlay.querySelector("#cl-revoke");
    btnClear = overlay.querySelector("#cl-clear");
    listEl = overlay.querySelector("#cl-list");
    statusEl = overlay.querySelector("#cl-status");

    // Close overlay on "✕" click
    overlay.querySelector("#cl-close").onclick = () =>
      overlay.classList.add("hidden");

    // Button handlers
    btnGrantShow.onclick = requestPermission;
    //btnRevoke.onclick = revokePermission;
    btnClear.onclick = clearCookies;

    // On first load, check whether permission already exists
    reflectPermission();
  }

  // Request cookie permission from background.js
  async function requestPermission() {
    setStatus("Requesting permission…");
    const resp = await sendMessage("REQUEST_PERMISSION", { url: pageUrl });

    if (resp?.ok) {
      // Permission granted
      btnGrantShow.textContent = "Show Cookies";
      btnGrantShow.onclick = showCookies;
      //btnRevoke.disabled = false;
      btnClear.disabled = false;
      setStatus("Permission granted.");
    } else {
      // Permission denied
      btnGrantShow.textContent = "Access Denied — Try Again";
      btnGrantShow.onclick = requestPermission;
      setStatus("Permission denied.");
    }
  }

  // Revoke cookie permission
// async function revokePermission() {
//   setStatus("Revoking permission…");
//   const resp = await sendMessage("REVOKE_PERMISSION", { url: pageUrl });

//   if (resp?.ok) {
//     setStatus("Permission revoked.");
//     btnGrantShow.textContent = "Grant Cookie Access";
//     btnGrantShow.onclick = requestPermission;
//     btnRevoke.disabled = true;
//     btnClear.disabled = true;
//     listEl.innerHTML = "";
//   } else {
//     setStatus(`Failed: ${resp?.error || "Could not revoke permission."}`);
//   }
// }



  // Clear all cookies for current domain
  async function clearCookies() {
    if (!confirm("Clear ALL cookies for this domain?")) return; // confirm first
    setStatus("Clearing cookies…");
    const resp = await sendMessage("CLEAR_DOMAIN_COOKIES", { url: pageUrl });

    if (resp?.ok) {
      setStatus(`Cleared ${resp.cleared} cookies.`);
      listEl.innerHTML = "";
    } else {
      setStatus(resp?.error || "Failed to clear cookies.");
    }
  }

  // Fetch and display cookies
  async function showCookies() {
    setStatus("Fetching cookies…");
    const resp = await sendMessage("FETCH_COOKIES", { url: pageUrl });
    if (resp?.ok) {
      renderCookies(resp.cookies || []);
      setStatus(`Loaded ${resp.cookies.length} cookies.`);
      await sendMessage("SUBSCRIBE_COOKIE_UPDATES", { url: pageUrl });
    } else {
      setStatus(resp?.error || "Failed to fetch cookies.");
    }
  }

  // Render cookie list in overlay
  function renderCookies(cookies) {
    if (!cookies.length) {
      listEl.innerHTML = "<div>No cookies found.</div>";
      return;
    }
    listEl.innerHTML = cookies
      .map(
        (c) =>
          `<div><strong>${escapeHtml(c.name)}:</strong> <code>${escapeHtml(
            c.value
          )}</code></div>`
      )
      .join("");
  }

  // Update status message
  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  // Escape HTML to prevent XSS
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Check current permission state and update UI accordingly
  async function reflectPermission() {
    const resp = await sendMessage("CHECK_PERMISSION", { url: pageUrl });

    if (resp?.has) {
      // Already has permission
      btnGrantShow.textContent = "Show Cookies";
      btnGrantShow.onclick = showCookies;
      //btnRevoke.disabled = false;
      btnClear.disabled = false;
    } else {
      // No permission yet
      btnGrantShow.textContent = "Grant Cookie Access";
      btnGrantShow.onclick = requestPermission;
      //btnRevoke.disabled = true;
      btnClear.disabled = true;
    }
  }

  // Utility: send message to background.js
  async function sendMessage(type, payload = {}) {
    try {
      return await chrome.runtime.sendMessage({ type, ...payload });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Listen for messages from background.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_OVERLAY") {
      // Show/hide overlay when user clicks extension icon
      overlay.classList.toggle("hidden");
    }
    if (msg.type === "COOKIES_UPDATED") {
      // Re-render cookies when background detects changes
      renderCookies(msg.cookies || []);
      setStatus(`Updated ${msg.cookies.length} cookies (live).`);
    }
  });

  // Initialize overlay on script load
  ensureOverlay();
})();

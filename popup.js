document.addEventListener("DOMContentLoaded", () => {
  const toggleButton = document.getElementById("toggle");
  const toggleTitle = document.getElementById("toggleTitle");
  const toggleCopy = document.getElementById("toggleCopy");
  const statusChip = document.getElementById("statusChip");
  const siteLabel = document.getElementById("siteLabel");
  const countLabel = document.getElementById("countLabel");
  const resetButton = document.getElementById("reset");
  const pauseButton = document.getElementById("pause");
  const pauseNotice = document.getElementById("pauseNotice");
  const hiddenList = document.getElementById("hiddenList");
  const notice = document.getElementById("notice");
  const highlightToggle = document.getElementById("highlightToggle");
  const persistToggle = document.getElementById("persistToggle");
  const smartSelectToggle = document.getElementById("smartSelectToggle");
  const stubsToggle = document.getElementById("stubsToggle");

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl";
  document.getElementById("shortcutToggle").textContent = `${mod}+Shift+H selection`;

  let tab = null;
  let pageState = null;
  let restricted = false;

  function showNotice(message) {
    notice.textContent = message;
    notice.classList.toggle("hidden", !message);
  }

  function render() {
    const enabled = Boolean(pageState?.selectionMode);
    const paused = Boolean(pageState?.paused);
    const items = pageState?.hiddenItems || [];
    const hostname = pageState?.hostname || (tab ? hostnameFrom(tab.url) : "This page");

    siteLabel.textContent = restricted ? "Unavailable on this page" : hostname;
    statusChip.textContent = enabled ? "Selecting" : paused ? "Paused" : "Idle";
    statusChip.classList.toggle("on", enabled);
    statusChip.classList.toggle("paused", paused && !enabled);

    toggleButton.classList.toggle("active", enabled);
    toggleButton.disabled = restricted;
    toggleTitle.textContent = enabled ? "Stop hiding" : "Start hiding";
    toggleCopy.textContent = enabled
      ? "Click a section · Esc when done"
      : paused
        ? "Start hiding will unpause this site"
        : "Click any section on the page";

    pauseButton.disabled = restricted || (!paused && items.length === 0);
    pauseButton.classList.toggle("active", paused);
    pauseButton.textContent = paused ? "Unpause" : "Pause";
    pauseNotice.classList.toggle("hidden", restricted || !paused);

    countLabel.textContent = items.length
      ? `${items.length} hidden${paused ? " · paused" : ""}`
      : "Nothing hidden yet";
    resetButton.disabled = restricted || items.length === 0;

    hiddenList.innerHTML = "";
    if (restricted) {
      hiddenList.innerHTML = `<div class="empty">Chrome pages cannot be modified.</div>`;
      return;
    }
    if (!items.length) {
      hiddenList.innerHTML = `<div class="empty">Start hiding, then click a section.</div>`;
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <span class="item-tag">${escapeHtml(item.tag || "el")}</span>
        <span class="item-text" title="${escapeHtml(item.text || "")}">${escapeHtml(item.text || "Hidden element")}</span>
        <button type="button">Restore</button>
      `;
      row.querySelector("button").addEventListener("click", () => restoreItem(item.id));
      hiddenList.appendChild(row);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hostnameFrom(url = "") {
    try {
      return new URL(url).hostname || "This page";
    } catch (_) {
      return "This page";
    }
  }

  function canInject(url = "") {
    return Boolean(url) &&
      !/^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url) &&
      !url.startsWith("https://chrome.google.com/webstore") &&
      !url.startsWith("https://chromewebstore.google.com");
  }

  async function send(message) {
    if (!tab?.id) throw new Error("No active tab");
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (_) {
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["content.css"],
        });
      } catch (__) {
        /* css may already be present */
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      return chrome.tabs.sendMessage(tab.id, message);
    }
  }

  async function refresh() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active;
    if (!tab || !canInject(tab.url)) {
      restricted = true;
      pageState = null;
      showNotice("Open a regular website to hide sections. Chrome pages and the Web Store are blocked.");
      render();
      return;
    }

    restricted = false;
    showNotice("");
    try {
      pageState = await send({ action: "getState" });
    } catch (_) {
      restricted = true;
      pageState = null;
      showNotice("Could not connect to this tab. Try refreshing the page.");
    }
    render();
  }

  async function restoreItem(id) {
    try {
      pageState = await send({ action: "restoreElement", id });
      render();
    } catch (_) {
      showNotice("Could not restore that item. Try refreshing the page.");
    }
  }

  chrome.storage.local.get(
    ["highlightEnabled", "persistEnabled", "smartSelectEnabled", "stubsEnabled"],
    (data) => {
      highlightToggle.checked = data.highlightEnabled !== false;
      persistToggle.checked = data.persistEnabled !== false;
      smartSelectToggle.checked = Boolean(data.smartSelectEnabled);
      stubsToggle.checked = data.stubsEnabled !== false;
    }
  );

  toggleButton.addEventListener("click", async () => {
    if (restricted) return;
    try {
      const next = !pageState?.selectionMode;
      pageState = await send({ action: next ? "enable" : "disable" });
      render();
      if (next) window.close();
    } catch (_) {
      showNotice("Could not start hiding on this tab. Try refreshing the page.");
    }
  });

  pauseButton.addEventListener("click", async () => {
    try {
      pageState = await send({ action: "togglePaused" });
      render();
    } catch (_) {
      showNotice("Could not pause this site. Try refreshing the page.");
    }
  });

  resetButton.addEventListener("click", async () => {
    try {
      pageState = await send({ action: "reset" });
      render();
    } catch (_) {
      showNotice("Could not restore items. Try refreshing the page.");
    }
  });

  document.getElementById("openOptions").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  async function saveSetting(patch) {
    await chrome.storage.local.set(patch);
    if (!restricted) {
      try {
        pageState = await send({ action: "setSettings", ...patch });
        render();
      } catch (_) {
        /* settings still persist for the next page load */
      }
    }
  }

  highlightToggle.addEventListener("change", () => {
    saveSetting({ highlightEnabled: highlightToggle.checked });
  });
  persistToggle.addEventListener("change", () => {
    saveSetting({ persistEnabled: persistToggle.checked });
  });
  smartSelectToggle.addEventListener("change", () => {
    saveSetting({ smartSelectEnabled: smartSelectToggle.checked });
  });
  stubsToggle.addEventListener("change", () => {
    saveSetting({ stubsEnabled: stubsToggle.checked });
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && (changes.hiddenByHost || changes.hiddenElements || changes.pausedByHost)) {
      refresh();
    }
  });

  refresh();
});

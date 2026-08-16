const SETTINGS_KEYS = [
  "highlightEnabled",
  "persistEnabled",
  "smartSelectEnabled",
  "stubsEnabled",
];

const siteList = document.getElementById("siteList");
const search = document.getElementById("search");
const summary = document.getElementById("summary");
const banner = document.getElementById("banner");
const importFile = document.getElementById("importFile");

let snapshot = {
  hiddenByHost: {},
  pausedByHost: {},
  highlightEnabled: true,
  persistEnabled: true,
  smartSelectEnabled: false,
  stubsEnabled: true,
};
let importMode = "merge";

function showBanner(message, isError = false) {
  banner.hidden = !message;
  banner.textContent = message;
  banner.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function load() {
  snapshot = await chrome.storage.local.get([
    "hiddenByHost",
    "pausedByHost",
    ...SETTINGS_KEYS,
  ]);
  snapshot.hiddenByHost = snapshot.hiddenByHost || {};
  snapshot.pausedByHost = snapshot.pausedByHost || {};
  render();
}

function hosts() {
  const names = new Set([
    ...Object.keys(snapshot.hiddenByHost || {}),
    ...Object.keys(snapshot.pausedByHost || {}),
  ]);
  const query = search.value.trim().toLowerCase();
  return [...names]
    .filter((host) => (snapshot.hiddenByHost[host] || []).length || snapshot.pausedByHost[host])
    .filter((host) => !query || host.toLowerCase().includes(query))
    .sort((a, b) => a.localeCompare(b));
}

function render() {
  const rows = hosts();
  const totalRules = Object.values(snapshot.hiddenByHost || {}).reduce((sum, list) => sum + (list?.length || 0), 0);
  summary.textContent = `${rows.length} site${rows.length === 1 ? "" : "s"} · ${totalRules} rule${totalRules === 1 ? "" : "s"}`;

  if (!rows.length) {
    siteList.innerHTML = `<div class="empty">No saved hides yet. Hide a section on a website, then it will show up here.</div>`;
    return;
  }

  siteList.innerHTML = "";
  rows.forEach((host) => {
    const items = snapshot.hiddenByHost[host] || [];
    const paused = Boolean(snapshot.pausedByHost[host]);
    const card = document.createElement("article");
    card.className = "site";
    card.innerHTML = `
      <div class="site-head">
        <h2 title="${escapeHtml(host)}">${escapeHtml(host)}</h2>
        ${paused ? `<span class="pill">Paused</span>` : ""}
        <span class="count">${items.length} hidden</span>
        <button type="button" data-act="pause">${paused ? "Unpause" : "Pause"}</button>
        <button type="button" class="danger" data-act="clear">Clear</button>
      </div>
      <div class="items">
        ${items.map((item) => `
          <div class="item">
            <code>${escapeHtml(item.tag || "el")}</code>
            <span title="${escapeHtml(item.text || "")}">${escapeHtml(item.text || item.selector || "Hidden element")}</span>
          </div>
        `).join("")}
      </div>
    `;
    card.querySelector('[data-act="pause"]').addEventListener("click", () => togglePause(host, !paused));
    card.querySelector('[data-act="clear"]').addEventListener("click", () => clearHost(host));
    siteList.appendChild(card);
  });
}

async function togglePause(host, paused) {
  const pausedByHost = { ...(snapshot.pausedByHost || {}) };
  if (paused) pausedByHost[host] = true;
  else delete pausedByHost[host];
  await chrome.storage.local.set({ pausedByHost });
  await load();
}

async function clearHost(host) {
  const hiddenByHost = { ...(snapshot.hiddenByHost || {}) };
  const pausedByHost = { ...(snapshot.pausedByHost || {}) };
  delete hiddenByHost[host];
  delete pausedByHost[host];
  await chrome.storage.local.set({ hiddenByHost, pausedByHost });
  await load();
}

function backupPayload() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      highlightEnabled: snapshot.highlightEnabled !== false,
      persistEnabled: snapshot.persistEnabled !== false,
      smartSelectEnabled: Boolean(snapshot.smartSelectEnabled),
      stubsEnabled: snapshot.stubsEnabled !== false,
    },
    pausedByHost: snapshot.pausedByHost || {},
    hiddenByHost: snapshot.hiddenByHost || {},
  };
}

function downloadBackup() {
  const blob = new Blob([JSON.stringify(backupPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `content-hider-backup-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showBanner("Backup downloaded.");
}

function parseBackup(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object") throw new Error("Invalid file");
  const hiddenByHost = data.hiddenByHost && typeof data.hiddenByHost === "object" ? data.hiddenByHost : {};
  const pausedByHost = data.pausedByHost && typeof data.pausedByHost === "object" ? data.pausedByHost : {};
  const settings = data.settings && typeof data.settings === "object" ? data.settings : data;
  return { hiddenByHost, pausedByHost, settings };
}

async function applyImport(parsed, mode) {
  const nextHidden = mode === "replace" ? {} : { ...(snapshot.hiddenByHost || {}) };
  const nextPaused = mode === "replace" ? {} : { ...(snapshot.pausedByHost || {}) };

  Object.entries(parsed.hiddenByHost).forEach(([host, items]) => {
    if (!Array.isArray(items)) return;
    if (mode === "replace") nextHidden[host] = items;
    else {
      const existing = nextHidden[host] || [];
      const seen = new Set(existing.map((item) => item.id || item.selector));
      const merged = [...existing];
      items.forEach((item) => {
        const key = item.id || item.selector;
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(item);
      });
      nextHidden[host] = merged;
    }
  });

  Object.entries(parsed.pausedByHost).forEach(([host, value]) => {
    if (value) nextPaused[host] = true;
  });

  const patch = {
    hiddenByHost: nextHidden,
    pausedByHost: nextPaused,
  };
  SETTINGS_KEYS.forEach((key) => {
    if (typeof parsed.settings[key] === "boolean") patch[key] = parsed.settings[key];
  });

  await chrome.storage.local.set(patch);
  await load();
  showBanner(mode === "replace" ? "Backup restored (replaced existing rules)." : "Backup merged into existing rules.");
}

search.addEventListener("input", render);
document.getElementById("exportBtn").addEventListener("click", downloadBackup);
document.getElementById("importMergeBtn").addEventListener("click", () => {
  importMode = "merge";
  importFile.click();
});
document.getElementById("importReplaceBtn").addEventListener("click", () => {
  importMode = "replace";
  importFile.click();
});
importFile.addEventListener("change", async () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = "";
  if (!file) return;
  try {
    const parsed = parseBackup(await file.text());
    await applyImport(parsed, importMode);
  } catch (error) {
    showBanner(error.message || "Could not import that file.", true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") load();
});

load();

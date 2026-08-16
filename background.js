const DEFAULTS = {
  highlightEnabled: true,
  persistEnabled: true,
  smartSelectEnabled: false,
  stubsEnabled: true,
  hiddenByHost: {},
  pausedByHost: {},
  storageSchema: 2,
};

const SETTINGS_KEYS = [
  "highlightEnabled",
  "persistEnabled",
  "smartSelectEnabled",
  "stubsEnabled",
  "pausedByHost",
];

const CHUNK_SIZE = 7000;
const MAX_CHUNKS = 8;
const RESTRICTED = /^(chrome|chrome-extension|edge|about|devtools|view-source):/i;

let mirroring = false;
let menuSetup = Promise.resolve();

function initStorage() {
  chrome.storage.local.get(Object.keys(DEFAULTS), (data) => {
    const patch = {};
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (data[key] === undefined) patch[key] = value;
    }
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
}

function setupMenus() {
  menuSetup = menuSetup
    .then(async () => {
      await chrome.contextMenus.removeAll();
      chrome.contextMenus.create({
        id: "sch-hide",
        title: "Hide this element",
        contexts: ["page", "frame", "selection", "link", "image", "video", "audio"],
      });
      chrome.contextMenus.create({
        id: "sch-restore",
        title: "Restore hidden elements on this page",
        contexts: ["page", "frame"],
      });
      chrome.contextMenus.create({
        id: "sch-pause",
        title: "Pause or unpause hiding on this site",
        contexts: ["page", "frame"],
      });
    })
    .catch(() => {});
  return menuSetup;
}

function canInject(url = "") {
  return Boolean(url) &&
    !RESTRICTED.test(url) &&
    !url.startsWith("https://chrome.google.com/webstore") &&
    !url.startsWith("https://chromewebstore.google.com");
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"],
      });
    } catch (_) {
      /* css may already be present */
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

async function withActiveTab(fn) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !canInject(tab.url)) return;
  return fn(tab);
}

function setBadge(tabId, { count = 0, selectionMode = false, paused = false } = {}) {
  if (selectionMode) {
    chrome.action.setBadgeText({ tabId, text: "ON" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#0f766e" });
    return;
  }
  if (paused) {
    chrome.action.setBadgeText({ tabId, text: "II" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#b45309" });
    return;
  }
  chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#6d28d9" });
}

function readRulesFromSync(syncData) {
  const count = Number(syncData.sch_rules_count) || 0;
  if (!count || syncData.sch_rules_overflow) return null;
  let json = "";
  for (let i = 0; i < count; i += 1) json += syncData[`sch_rules_${i}`] || "";
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function writeSyncSettings(patch) {
  try {
    await chrome.storage.sync.set(patch);
  } catch (_) {
    /* quota or signed-out Chrome profile */
  }
}

async function syncRules(hiddenByHost) {
  const json = JSON.stringify(hiddenByHost || {});
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) {
    chunks.push(json.slice(i, i + CHUNK_SIZE));
  }
  const payload = {
    sch_rules_overflow: chunks.length > MAX_CHUNKS,
    sch_rules_count: 0,
  };
  for (let i = 0; i < MAX_CHUNKS + 2; i += 1) payload[`sch_rules_${i}`] = "";
  if (chunks.length <= MAX_CHUNKS) {
    payload.sch_rules_overflow = false;
    payload.sch_rules_count = chunks.length;
    chunks.forEach((chunk, index) => {
      payload[`sch_rules_${index}`] = chunk;
    });
  }
  try {
    await chrome.storage.sync.set(payload);
  } catch (_) {
    try {
      await chrome.storage.sync.set({ sch_rules_overflow: true, sch_rules_count: 0 });
    } catch (__) {
      /* ignore */
    }
  }
}

async function hydrateFromSync() {
  const [local, sync] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.storage.sync.get(null),
  ]);
  const patch = {};
  const localRules = local.hiddenByHost || {};
  const localEmpty = !Object.keys(localRules).length;
  const syncRules = readRulesFromSync(sync || {});

  SETTINGS_KEYS.forEach((key) => {
    if (local[key] === undefined && sync[key] !== undefined) patch[key] = sync[key];
  });
  if (localEmpty && syncRules && Object.keys(syncRules).length) {
    patch.hiddenByHost = syncRules;
  }
  if (local.storageSchema === undefined) patch.storageSchema = 2;
  if (!Object.keys(patch).length) return;

  mirroring = true;
  await chrome.storage.local.set(patch);
  mirroring = false;
}

async function pushLocalToSync() {
  const local = await chrome.storage.local.get([...SETTINGS_KEYS, "hiddenByHost"]);
  const settings = {};
  SETTINGS_KEYS.forEach((key) => {
    if (local[key] !== undefined) settings[key] = local[key];
  });
  if (Object.keys(settings).length) await writeSyncSettings(settings);
  await syncRules(local.hiddenByHost || {});
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (mirroring) return;
  if (area === "local") {
    const settingsPatch = {};
    SETTINGS_KEYS.forEach((key) => {
      if (changes[key]) settingsPatch[key] = changes[key].newValue;
    });
    if (Object.keys(settingsPatch).length) writeSyncSettings(settingsPatch);
    if (changes.hiddenByHost) syncRules(changes.hiddenByHost.newValue);
    return;
  }
  if (area !== "sync") return;

  mirroring = true;
  const patch = {};
  SETTINGS_KEYS.forEach((key) => {
    if (changes[key]) patch[key] = changes[key].newValue;
  });
  const rulesTouched = Boolean(changes.sch_rules_count) ||
    Object.keys(changes).some((key) => key.startsWith("sch_rules_"));
  const apply = async () => {
    if (rulesTouched) {
      const syncData = await chrome.storage.sync.get(null);
      const rules = readRulesFromSync(syncData);
      if (rules) patch.hiddenByHost = rules;
    }
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    mirroring = false;
  };
  apply();
});

async function boot() {
  await hydrateFromSync();
  initStorage();
  setupMenus();
  await pushLocalToSync();
}

chrome.runtime.onInstalled.addListener(() => {
  boot();
});

chrome.runtime.onStartup.addListener(() => {
  boot();
});

boot();

chrome.commands.onCommand.addListener(async (command) => {
  await withActiveTab(async (tab) => {
    if (command === "toggle_hiding") {
      await sendToTab(tab.id, { action: "toggle" });
    } else if (command === "reset_hidden") {
      await sendToTab(tab.id, { action: "reset" });
    }
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !canInject(tab.url)) return;
  if (info.menuItemId === "sch-hide") {
    await sendToTab(tab.id, { action: "hideContextTarget" });
  } else if (info.menuItemId === "sch-restore") {
    await sendToTab(tab.id, { action: "reset" });
  } else if (info.menuItemId === "sch-pause") {
    await sendToTab(tab.id, { action: "togglePaused" });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateBadge" && sender.tab?.id) {
    setBadge(sender.tab.id, request);
    sendResponse({ ok: true });
  }
  return false;
});

/**
 * Selective Content Hider — content script
 * Per-site hiding, overlay selection, restore stubs, and pause.
 */
(() => {
  if (window.__SCH_CONTENT__) return;
  window.__SCH_CONTENT__ = true;

  const HIDDEN_ATTR = "data-sch-hidden";
  const HIDING_ATTR = "data-sch-hiding";
  const ID_ATTR = "data-sch-id";
  const STUB_ATTR = "data-sch-stub";
  const ROOT_ID = "sch-root";
  const STYLE_ID = "sch-page-style";
  const DISPLAY_ATTR = "data-sch-display";
  const HOST_STYLE = "all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none;";
  const MAX_LIST = 80;
  const UNDO_MS = 7000;

  const state = {
    selectionMode: false,
    highlightEnabled: true,
    persistEnabled: true,
    smartSelectEnabled: false,
    stubsEnabled: true,
    paused: false,
    hovered: null,
    hoverStack: [],
    similar: [],
    pendingSmart: null,
    hiddenNow: [],
    lastMouse: { x: 0, y: 0 },
    undo: null,
  };

  let rootEl = null;
  let shadow = null;
  let highlightLayer = null;
  let hudEl = null;
  let toastEl = null;
  let promptEl = null;
  let rafId = 0;
  let observer = null;
  let applyTimer = 0;
  let legacyMigrated = false;

  function hostKey() {
    return location.hostname || location.href;
  }

  function uid() {
    return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function isStub(node) {
    return Boolean(node && node.nodeType === 1 && (node.hasAttribute?.(STUB_ATTR) || node.closest?.(`[${STUB_ATTR}]`)));
  }

  function isOurUI(node) {
    return Boolean(node && rootEl && (node === rootEl || rootEl.contains(node))) || isStub(node);
  }

  function isSkippable(el) {
    if (!el || el.nodeType !== 1) return true;
    const tag = el.tagName;
    if (!tag) return true;
    if (["HTML", "BODY", "HEAD", "SCRIPT", "STYLE", "LINK", "META", "TITLE"].includes(tag)) {
      return true;
    }
    if (el.id === ROOT_ID || isOurUI(el) || isStub(el)) return true;
    return false;
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function injectPageStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${HIDDEN_ATTR}="1"] { display: none !important; }
      [${HIDING_ATTR}="1"] {
        opacity: 0 !important;
        transition: opacity 0.16s ease !important;
        pointer-events: none !important;
      }
      [${STUB_ATTR}] { display: block; }
      tr[${STUB_ATTR}] { display: table-row; }
      li[${STUB_ATTR}] { display: list-item; list-style: none; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureUI() {
    injectPageStyle();
    if (rootEl && rootEl.isConnected && shadow) return;
    if (rootEl && !rootEl.isConnected) {
      shadow = null;
      rootEl = null;
    }

    rootEl = document.getElementById(ROOT_ID);
    if (rootEl) rootEl.style.cssText = HOST_STYLE;
    if (!rootEl) {
      rootEl = document.createElement("div");
      rootEl.id = ROOT_ID;
      rootEl.setAttribute("data-sch-ui", "1");
      rootEl.style.cssText = HOST_STYLE;
      (document.documentElement || document.body).appendChild(rootEl);
    }

    if (!shadow) {
      try {
        shadow = rootEl.attachShadow({ mode: "closed" });
      } catch (_) {
        rootEl.remove();
        rootEl = document.createElement("div");
        rootEl.id = ROOT_ID;
        rootEl.setAttribute("data-sch-ui", "1");
        rootEl.style.cssText = HOST_STYLE;
        (document.documentElement || document.body).appendChild(rootEl);
        shadow = rootEl.attachShadow({ mode: "closed" });
      }
    }
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
        .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
        .box {
          position: fixed;
          border: 2px solid #2dd4bf;
          background: rgba(45, 212, 191, 0.12);
          border-radius: 6px;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.25);
          transition: top 0.05s linear, left 0.05s linear, width 0.05s linear, height 0.05s linear;
        }
        .box.similar {
          border-color: #c084fc;
          background: rgba(192, 132, 252, 0.12);
        }
        .label {
          position: fixed;
          max-width: min(420px, calc(100vw - 24px));
          padding: 4px 8px;
          border-radius: 6px;
          background: #0f172a;
          color: #f8fafc;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          line-height: 1.3;
          box-shadow: 0 6px 20px rgba(0,0,0,0.35);
          pointer-events: none;
        }
        .label span { color: #2dd4bf; margin-right: 6px; }
        .hud, .toast, .prompt {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          z-index: 2147483647;
          pointer-events: auto;
          color: #f8fafc;
          background: rgba(15, 23, 42, 0.94);
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 18px 50px rgba(0,0,0,0.4);
          backdrop-filter: blur(10px);
        }
        .hud {
          top: 16px;
          display: none;
          align-items: center;
          gap: 10px;
          padding: 10px 12px 10px 14px;
          border-radius: 999px;
          font-size: 13px;
        }
        .hud.visible { display: flex; }
        .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #2dd4bf;
          box-shadow: 0 0 0 4px rgba(45, 212, 191, 0.18);
        }
        .hud kbd {
          font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 4px;
          padding: 1px 5px;
          margin: 0 2px;
        }
        .hud button, .toast button, .prompt button {
          appearance: none;
          border: 0;
          cursor: pointer;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 600;
          color: #0f172a;
          background: #2dd4bf;
        }
        .hud button.ghost, .prompt button.ghost {
          background: rgba(255,255,255,0.08);
          color: #f8fafc;
        }
        .toast {
          bottom: 20px;
          display: none;
          align-items: center;
          gap: 12px;
          padding: 10px 12px 10px 16px;
          border-radius: 12px;
          font-size: 13px;
          max-width: min(440px, calc(100vw - 24px));
        }
        .toast.visible { display: flex; }
        .toast span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .prompt {
          bottom: 20px;
          display: none;
          flex-direction: column;
          gap: 10px;
          width: min(420px, calc(100vw - 24px));
          padding: 14px;
          border-radius: 14px;
        }
        .prompt.visible { display: flex; }
        .prompt p { margin: 0; font-size: 13px; line-height: 1.45; color: #e2e8f0; }
        .prompt .row { display: flex; gap: 8px; justify-content: flex-end; }
      </style>
      <div class="layer" id="highlight"></div>
      <div class="hud" id="hud">
        <span class="dot"></span>
        <span id="hud-text">Click any section to hide it</span>
        <button class="ghost" id="hud-stop" type="button">Done</button>
      </div>
      <div class="toast" id="toast">
        <span id="toast-text">Hidden</span>
        <button type="button" id="toast-undo">Undo</button>
      </div>
      <div class="prompt" id="prompt">
        <p id="prompt-text"></p>
        <div class="row">
          <button class="ghost" type="button" id="prompt-cancel">Cancel</button>
          <button class="ghost" type="button" id="prompt-one">Just this</button>
          <button type="button" id="prompt-all">Hide all</button>
        </div>
      </div>
    `;

    highlightLayer = shadow.getElementById("highlight");
    hudEl = shadow.getElementById("hud");
    toastEl = shadow.getElementById("toast");
    promptEl = shadow.getElementById("prompt");

    shadow.getElementById("hud-stop").addEventListener("click", () => setSelectionMode(false));
    shadow.getElementById("toast-undo").addEventListener("click", undoLast);
    shadow.getElementById("prompt-cancel").addEventListener("click", cancelSmartPrompt);
    shadow.getElementById("prompt-one").addEventListener("click", () => confirmSmartPrompt(false));
    shadow.getElementById("prompt-all").addEventListener("click", () => confirmSmartPrompt(true));
  }

  function setHudVisible(on) {
    ensureUI();
    hudEl.classList.toggle("visible", on);
    updateHudCopy();
  }

  function updateHudCopy() {
    if (!hudEl) return;
    const text = shadow.getElementById("hud-text");
    if (state.pendingSmart) {
      text.innerHTML = `Hide this and <b>${state.similar.length}</b> similar?`;
      return;
    }
    text.innerHTML = `Click a section · <kbd>↑</kbd> parent · <kbd>Esc</kbd>`;
  }

  function clearHighlight() {
    if (highlightLayer) highlightLayer.innerHTML = "";
  }

  function drawHighlight() {
    ensureUI();
    if (!state.selectionMode || !state.highlightEnabled) {
      clearHighlight();
      return;
    }

    const targets = [];
    if (state.hovered && visible(state.hovered)) {
      targets.push({ el: state.hovered, similar: false });
    }
    if (state.pendingSmart) {
      state.similar.forEach((el) => {
        if (visible(el)) targets.push({ el, similar: true });
      });
    }

    highlightLayer.innerHTML = "";
    targets.forEach(({ el, similar }, index) => {
      const r = el.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = similar ? "box similar" : "box";
      box.style.top = `${r.top}px`;
      box.style.left = `${r.left}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      highlightLayer.appendChild(box);

      if (index === 0 && !similar) {
        const label = document.createElement("div");
        label.className = "label";
        const tag = el.tagName.toLowerCase();
        label.innerHTML = `<span>${tag}</span>${escapeHtml(getElementText(el))}`;
        const top = r.top > 32 ? r.top - 26 : r.bottom + 8;
        label.style.top = `${top}px`;
        label.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 220))}px`;
        highlightLayer.appendChild(label);
      }
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getElementText(el) {
    if (!el) return "";
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clip(aria.trim());
    const altImg = el.matches("img") ? el : el.querySelector("img[alt]");
    if (altImg && altImg.alt) return clip(altImg.alt);
    const heading = el.querySelector("h1, h2, h3, h4, h5, h6");
    if (heading && heading.textContent.trim()) return clip(heading.textContent);
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return clip(text);
    if (el.id) return `#${el.id}`;
    const cls = [...el.classList].find((c) => c && !c.startsWith("_"));
    if (cls) return `${el.tagName.toLowerCase()}.${cls}`;
    return el.tagName.toLowerCase();
  }

  function clip(text, max = 56) {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max)}…` : clean;
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function getSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) {
      const idSel = `#${cssEscape(el.id)}`;
      try {
        if (document.querySelectorAll(idSel).length === 1) return idSel;
      } catch (_) {
        /* ignore invalid id */
      }
    }

    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && depth < 8) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${cssEscape(node.id)}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (sameTag.length > 1) {
          part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
      depth += 1;
    }
    return parts.join(" > ");
  }

  function querySafe(selector) {
    if (!selector) return [];
    try {
      return [...document.querySelectorAll(selector)];
    } catch (_) {
      return [];
    }
  }

  function findSimilar(el) {
    const classes = [...el.classList].filter((c) => c && !c.startsWith("_") && !c.startsWith("sch") && c.length > 1);
    if (!classes.length) return [];

    const ranked = [...classes].sort((a, b) => b.length - a.length).slice(0, 2);
    const selector = `${el.tagName.toLowerCase()}${ranked.map((c) => `.${cssEscape(c)}`).join("")}`;
    const matches = querySafe(selector).filter((node) => {
      if (node === el) return false;
      if (node.hasAttribute(HIDDEN_ATTR) || isStub(node)) return false;
      if (el.contains(node) || node.contains(el)) return false;
      return visible(node);
    });

    if (matches.length > 30) return [];
    return matches;
  }

  function stubHostTag(el) {
    const parent = el.parentElement;
    if (!parent) return null;
    const parentTag = parent.tagName;
    if (el.tagName === "TR" || parentTag === "TBODY" || parentTag === "THEAD" || parentTag === "TFOOT" || parentTag === "TABLE") {
      return "tr";
    }
    if (parentTag === "UL" || parentTag === "OL" || parentTag === "MENU") return "li";
    if (parentTag === "TR") return null;
    return "div";
  }

  function removeStub(id) {
    document.querySelectorAll(`[${STUB_ATTR}="${id}"]`).forEach((node) => node.remove());
  }

  function removeAllStubs() {
    document.querySelectorAll(`[${STUB_ATTR}]`).forEach((node) => node.remove());
  }

  function insertStub(el, item) {
    if (!state.stubsEnabled || state.paused || !el || !item) return;
    if (document.querySelector(`[${STUB_ATTR}="${item.id}"]`)) return;
    const tag = stubHostTag(el);
    if (!tag || !el.parentNode) return;

    try {
      const host = document.createElement(tag);
      host.setAttribute(STUB_ATTR, item.id);
      host.setAttribute("data-sch-ui", "1");

      let mount = host;
      if (tag === "tr") {
        const cell = document.createElement("td");
        cell.colSpan = Math.max(1, el.children.length || el.cells?.length || 1);
        host.appendChild(cell);
        mount = cell;
      }

      const wrap = document.createElement("div");
      mount.appendChild(wrap);
      const stubShadow = wrap.attachShadow({ mode: "closed" });
      stubShadow.innerHTML = `
        <style>
          :host { all: initial; display: block; }
          .bar {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 6px 0;
            padding: 6px 10px;
            border: 1px dashed rgba(45, 212, 191, 0.45);
            border-radius: 8px;
            background: #0f172a;
            color: #e2e8f0;
            font: 12px/1.3 Inter, ui-sans-serif, system-ui, sans-serif;
          }
          .bar span {
            flex: 1;
            min-width: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .bar b { color: #2dd4bf; font-weight: 700; margin-right: 6px; }
          button {
            appearance: none;
            border: 0;
            cursor: pointer;
            flex-shrink: 0;
            border-radius: 999px;
            padding: 4px 8px;
            font: 700 11px Inter, ui-sans-serif, system-ui, sans-serif;
            color: #0f172a;
            background: #2dd4bf;
          }
        </style>
        <div class="bar">
          <span><b>Hidden</b>${escapeHtml(item.text || item.tag || "section")}</span>
          <button type="button">Restore</button>
        </div>
      `;
      stubShadow.querySelector("button").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        restoreById(item.id);
      });
      el.parentNode.insertBefore(host, el);
    } catch (_) {
      /* stub is optional; hiding must still happen */
    }
  }

  function hideDom(el, itemId, { animate = true } = {}) {
    if (!el || el.hasAttribute(HIDDEN_ATTR)) return;
    el.setAttribute(ID_ATTR, itemId);
    if (!el.hasAttribute(DISPLAY_ATTR)) {
      el.setAttribute(DISPLAY_ATTR, el.style.getPropertyValue("display") || "");
    }
    const apply = () => {
      el.removeAttribute(HIDING_ATTR);
      el.setAttribute(HIDDEN_ATTR, "1");
      el.style.setProperty("display", "none", "important");
    };
    if (!animate || el.hasAttribute(HIDING_ATTR)) {
      apply();
      return;
    }
    el.setAttribute(HIDING_ATTR, "1");
    window.setTimeout(apply, 160);
  }

  function showDom(el) {
    if (!el) return;
    const original = el.getAttribute(DISPLAY_ATTR);
    el.removeAttribute(HIDDEN_ATTR);
    el.removeAttribute(HIDING_ATTR);
    el.removeAttribute(ID_ATTR);
    el.removeAttribute(DISPLAY_ATTR);
    if (original) el.style.setProperty("display", original);
    else el.style.removeProperty("display");
  }

  function hideAndStub(el, item, { animate = true } = {}) {
    if (state.paused) return;
    try {
      insertStub(el, item);
    } catch (_) {
      /* ignore stub failures */
    }
    hideDom(el, item.id, { animate });
  }

  function revealItem(item) {
    querySafe(`[${ID_ATTR}="${item.id}"]`).forEach(showDom);
    querySafe(item.selector).forEach(showDom);
    removeStub(item.id);
  }

  function applyVisualHides({ animate = false } = {}) {
    if (state.paused) return;
    state.hiddenNow.forEach((item) => {
      const nodes = querySafe(item.selector);
      if (nodes.length) {
        nodes.forEach((el) => hideAndStub(el, item, { animate }));
        return;
      }
      querySafe(`[${ID_ATTR}="${item.id}"]`).forEach((el) => hideAndStub(el, item, { animate }));
    });
  }

  function unpauseForEdit() {
    if (!state.paused) return;
    state.paused = false;
    savePaused();
    applyVisualHides({ animate: false });
  }

  function hideElements(elements, { persist = state.persistEnabled, recordUndo = true } = {}) {
    unpauseForEdit();
    const unique = [...new Set(elements.filter((el) => el && !isSkippable(el) && !el.hasAttribute(HIDDEN_ATTR)))];
    if (!unique.length) return [];

    const created = unique.map((el) => {
      const item = {
        id: uid(),
        selector: getSelector(el),
        text: getElementText(el),
        tag: el.tagName.toLowerCase(),
        timestamp: Date.now(),
        persist,
      };
      hideAndStub(el, item, { animate: true });
      state.hiddenNow.unshift(item);
      return item;
    });

    state.hiddenNow = state.hiddenNow.slice(0, MAX_LIST);
    if (persist) savePersisted();
    if (recordUndo) showUndo(created);
    notifyBadge();
    return created;
  }

  function restoreById(id, { persist = true } = {}) {
    const item = state.hiddenNow.find((entry) => entry.id === id);
    if (item) revealItem(item);
    else {
      querySafe(`[${ID_ATTR}="${id}"]`).forEach(showDom);
      removeStub(id);
    }
    state.hiddenNow = state.hiddenNow.filter((entry) => entry.id !== id);
    if (persist) savePersisted();
    notifyBadge();
  }

  function restoreAll() {
    state.hiddenNow.forEach((item) => revealItem(item));
    document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach(showDom);
    removeAllStubs();
    state.hiddenNow = [];
    if (state.paused) {
      state.paused = false;
      savePaused();
    }
    savePersisted();
    notifyBadge();
    hideToast();
  }

  function setPaused(paused, { persist = true } = {}) {
    state.paused = Boolean(paused);
    if (state.paused) {
      setSelectionMode(false);
      state.hiddenNow.forEach((item) => revealItem(item));
      document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach(showDom);
      removeAllStubs();
    } else {
      applyVisualHides({ animate: false });
    }
    if (persist) savePaused();
    notifyBadge();
  }

  function setStubsEnabled(enabled) {
    state.stubsEnabled = Boolean(enabled);
    if (!state.stubsEnabled || state.paused) {
      removeAllStubs();
      return;
    }
    applyVisualHides({ animate: false });
  }

  function savePersisted() {
    const persisted = state.hiddenNow.filter((item) => item.persist);
    chrome.storage.local.get(["hiddenByHost"], (data) => {
      const hiddenByHost = data.hiddenByHost || {};
      if (persisted.length) hiddenByHost[hostKey()] = persisted;
      else delete hiddenByHost[hostKey()];
      chrome.storage.local.set({ hiddenByHost });
    });
  }

  function savePaused() {
    chrome.storage.local.get(["pausedByHost"], (data) => {
      const pausedByHost = { ...(data.pausedByHost || {}) };
      if (state.paused) pausedByHost[hostKey()] = true;
      else delete pausedByHost[hostKey()];
      chrome.storage.local.set({ pausedByHost });
    });
  }

  function applyStored(items) {
    items.forEach((item) => {
      const already = state.hiddenNow.some((entry) => entry.id === item.id || entry.selector === item.selector);
      if (!already) {
        state.hiddenNow.push({ ...item, persist: true });
      }
    });
    if (!state.paused) applyVisualHides({ animate: false });
    notifyBadge();
  }

  function migrateLegacy(selectors) {
    const matched = [];
    const leftover = [];
    selectors.forEach((selector) => {
      const nodes = querySafe(selector);
      if (nodes.length) {
        const item = {
          id: uid(),
          selector,
          text: getElementText(nodes[0]),
          tag: nodes[0].tagName.toLowerCase(),
          timestamp: Date.now(),
          persist: true,
        };
        matched.push(item);
        state.hiddenNow.push(item);
        if (!state.paused) nodes.forEach((el) => hideAndStub(el, item, { animate: false }));
      } else {
        leftover.push(selector);
      }
    });
    if (!matched.length) return;
    chrome.storage.local.get(["hiddenByHost", "hiddenElements", "recentElements"], (data) => {
      const hiddenByHost = data.hiddenByHost || {};
      const existing = hiddenByHost[hostKey()] || [];
      hiddenByHost[hostKey()] = [...existing, ...matched];
      chrome.storage.local.set({
        hiddenByHost,
        hiddenElements: leftover,
        recentElements: leftover.length ? data.recentElements || [] : [],
      });
    });
    notifyBadge();
  }

  function loadAndApply() {
    chrome.storage.local.get(
      ["highlightEnabled", "persistEnabled", "smartSelectEnabled", "stubsEnabled", "pausedByHost", "hiddenByHost", "hiddenElements"],
      (data) => {
        state.highlightEnabled = data.highlightEnabled !== false;
        state.persistEnabled = data.persistEnabled !== false;
        state.smartSelectEnabled = Boolean(data.smartSelectEnabled);
        state.stubsEnabled = data.stubsEnabled !== false;
        state.paused = Boolean(data.pausedByHost && data.pausedByHost[hostKey()]);

        if (state.persistEnabled) {
          const stored = (data.hiddenByHost && data.hiddenByHost[hostKey()]) || [];
          applyStored(stored);
        }

        if (!legacyMigrated && Array.isArray(data.hiddenElements) && data.hiddenElements.length) {
          legacyMigrated = true;
          migrateLegacy(data.hiddenElements);
        }
      }
    );
  }

  function setSelectionMode(on) {
    if (on) unpauseForEdit();
    state.selectionMode = Boolean(on);
    if (!state.selectionMode) {
      state.hovered = null;
      state.hoverStack = [];
      state.similar = [];
      state.pendingSmart = null;
      hidePrompt();
      clearHighlight();
    }
    ensureUI();
    setHudVisible(state.selectionMode);
    drawHighlight();
    notifyBadge();
  }

  function pickFromPoint(x, y) {
    const stack = document.elementsFromPoint(x, y) || [];
    return stack.find((el) => !isSkippable(el) && !isOurUI(el)) || null;
  }

  function setHovered(el) {
    if (el === state.hovered) {
      drawHighlight();
      return;
    }
    state.hovered = el;
    state.hoverStack = el ? [el] : [];
    drawHighlight();
  }

  function expandParent() {
    const current = state.hovered;
    if (!current || !current.parentElement) return;
    const parent = current.parentElement;
    if (isSkippable(parent)) return;
    state.hoverStack.push(parent);
    state.hovered = parent;
    drawHighlight();
  }

  function shrinkSelection() {
    if (state.hoverStack.length < 2) return;
    state.hoverStack.pop();
    state.hovered = state.hoverStack[state.hoverStack.length - 1];
    drawHighlight();
  }

  function hideHovered() {
    const el = state.hovered;
    if (!el) return;

    if (state.smartSelectEnabled) {
      const similar = findSimilar(el);
      if (similar.length) {
        state.similar = similar;
        state.pendingSmart = el;
        showSmartPrompt(el, similar);
        drawHighlight();
        return;
      }
    }

    hideElements([el]);
  }

  function showSmartPrompt(el, similar) {
    ensureUI();
    const text = shadow.getElementById("prompt-text");
    text.textContent = `Found ${similar.length} similar ${el.tagName.toLowerCase()} elements. Hide just this one, or all of them?`;
    promptEl.classList.add("visible");
    updateHudCopy();
  }

  function hidePrompt() {
    if (promptEl) promptEl.classList.remove("visible");
    state.pendingSmart = null;
    state.similar = [];
    updateHudCopy();
  }

  function cancelSmartPrompt() {
    hidePrompt();
    drawHighlight();
  }

  function confirmSmartPrompt(all) {
    const primary = state.pendingSmart;
    const extras = all ? state.similar : [];
    hidePrompt();
    if (primary) hideElements([primary, ...extras]);
    drawHighlight();
  }

  function showUndo(items) {
    state.undo = { items, timer: window.setTimeout(hideToast, UNDO_MS) };
    ensureUI();
    const label = items.length > 1 ? `Hidden ${items.length} elements` : `Hidden “${items[0].text}”`;
    shadow.getElementById("toast-text").textContent = label;
    toastEl.classList.add("visible");
  }

  function hideToast() {
    if (state.undo && state.undo.timer) window.clearTimeout(state.undo.timer);
    state.undo = null;
    if (toastEl) toastEl.classList.remove("visible");
  }

  function undoLast() {
    if (!state.undo) return;
    const items = state.undo.items;
    hideToast();
    items.forEach((item) => restoreById(item.id));
  }

  function notifyBadge() {
    chrome.runtime.sendMessage({
      action: "updateBadge",
      count: state.hiddenNow.length,
      selectionMode: state.selectionMode,
      paused: state.paused,
    }, () => {
      void chrome.runtime.lastError;
    });
  }

  function getPublicState() {
    return {
      selectionMode: state.selectionMode,
      highlightEnabled: state.highlightEnabled,
      persistEnabled: state.persistEnabled,
      smartSelectEnabled: state.smartSelectEnabled,
      stubsEnabled: state.stubsEnabled,
      paused: state.paused,
      hostname: hostKey(),
      hiddenItems: state.hiddenNow.map(({ id, text, tag, timestamp }) => ({ id, text, tag, timestamp })),
    };
  }

  function isChromeEvent(event) {
    if (isStub(event.target)) return true;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.some((node) => node === hudEl || node === toastEl || node === promptEl);
  }

  function onMouseMove(event) {
    if (!state.selectionMode || state.pendingSmart) return;
    if (isChromeEvent(event)) return;
    state.lastMouse = { x: event.clientX, y: event.clientY };
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      setHovered(pickFromPoint(state.lastMouse.x, state.lastMouse.y));
    });
  }

  function onClick(event) {
    if (!state.selectionMode) return;
    if (isChromeEvent(event)) return;
    if (state.pendingSmart) return;
    const el = pickFromPoint(event.clientX, event.clientY);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    state.hovered = el;
    hideHovered();
  }

  function onKeyDown(event) {
    if (!state.selectionMode) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (state.pendingSmart) cancelSmartPrompt();
      else setSelectionMode(false);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      expandParent();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      shrinkSelection();
    }
  }

  function onContextMenu(event) {
    if (isChromeEvent(event)) return;
    state.contextTarget = pickFromPoint(event.clientX, event.clientY) || event.target;
  }

  function scheduleApply() {
    window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(() => {
      if (state.paused || !state.persistEnabled) return;
      applyVisualHides({ animate: false });
    }, 80);
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "ping" || request.action === "getState") {
      sendResponse({ ok: true, ...getPublicState() });
      return true;
    }
    if (request.action === "enable") setSelectionMode(true);
    if (request.action === "disable") setSelectionMode(false);
    if (request.action === "toggle") setSelectionMode(!state.selectionMode);
    if (request.action === "reset") restoreAll();
    if (request.action === "restoreElement") restoreById(request.id);
    if (request.action === "setPaused") setPaused(Boolean(request.paused));
    if (request.action === "togglePaused") setPaused(!state.paused);
    if (request.action === "hideContextTarget") {
      const el = state.contextTarget && state.contextTarget.nodeType === 3
        ? state.contextTarget.parentElement
        : state.contextTarget;
      if (el && !isSkippable(el)) hideElements([el]);
    }
    if (request.action === "setSettings") {
      if (typeof request.highlightEnabled === "boolean") {
        state.highlightEnabled = request.highlightEnabled;
        drawHighlight();
      }
      if (typeof request.persistEnabled === "boolean") state.persistEnabled = request.persistEnabled;
      if (typeof request.smartSelectEnabled === "boolean") state.smartSelectEnabled = request.smartSelectEnabled;
      if (typeof request.stubsEnabled === "boolean") setStubsEnabled(request.stubsEnabled);
    }
    sendResponse(getPublicState());
    return true;
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local") return;
    if (changes.highlightEnabled) {
      state.highlightEnabled = changes.highlightEnabled.newValue !== false;
      drawHighlight();
    }
    if (changes.persistEnabled) {
      state.persistEnabled = changes.persistEnabled.newValue !== false;
    }
    if (changes.smartSelectEnabled) {
      state.smartSelectEnabled = Boolean(changes.smartSelectEnabled.newValue);
    }
    if (changes.stubsEnabled) {
      setStubsEnabled(changes.stubsEnabled.newValue !== false);
    }
    if (changes.pausedByHost) {
      const nextPaused = Boolean(changes.pausedByHost.newValue && changes.pausedByHost.newValue[hostKey()]);
      if (nextPaused !== state.paused) setPaused(nextPaused, { persist: false });
    }
    if (changes.hiddenByHost && state.persistEnabled) {
      const next = (changes.hiddenByHost.newValue || {})[hostKey()] || [];
      const nextIds = new Set(next.map((item) => item.id));
      state.hiddenNow
        .filter((item) => item.persist && !nextIds.has(item.id))
        .forEach((item) => restoreById(item.id, { persist: false }));
      applyStored(next);
    }
  });

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("scroll", () => drawHighlight(), true);
  window.addEventListener("resize", () => drawHighlight());

  observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        if (node.nodeType !== 1) return false;
        if (node.id === ROOT_ID || node.hasAttribute?.(STUB_ATTR)) return false;
        return true;
      })
    );
    if (relevant) scheduleApply();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  injectPageStyle();
  loadAndApply();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ensureUI();
      loadAndApply();
    });
  } else {
    ensureUI();
  }
  window.addEventListener("load", loadAndApply);
})();

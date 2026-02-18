import * as PanelUI from "./modules/panel-ui";
import * as OllamaAPI from "./modules/ollama-api";
import * as ChatEngine from "./modules/chat-engine";
import * as ToolsDialog from "./modules/tools-dialog";

declare const Zotero: any;
declare const addon: any;

// ── Required handler types (for scaffold compatibility) ──────────
type DialogHandler = (dialogWindow: Window) => void | Promise<void>;
type ShortcutHandler = () => void | Promise<void>;
type NotifyHandler = (
  event?: string,
  type?: string,
  ids?: any,
  extraData?: any,
) => void | Promise<void>;

const dialogHandlers = new Map<string, DialogHandler>();
const shortcutHandlers = new Map<string, ShortcutHandler>();
const notifyHandlers: NotifyHandler[] = [];

// ── Element IDs ──────────────────────────────────────────────────
const MENU_IDS = {
  submenu: "zotero-local-ai-submenu",
  toggle: "zotero-local-ai-tools-toggle",
  chat: "zotero-local-ai-tools-chat",
} as const;

const TOOLBAR_BTN_ID = "zotero-local-ai-toolbar-btn";

// ── Keyboard shortcuts ───────────────────────────────────────────
function handleKeyDown(ev: KeyboardEvent) {
  const win =
    (ev.target as Element)?.ownerDocument?.defaultView ??
    Zotero.getMainWindow?.();
  if (!win) return;

  // Ctrl+T → open chat with selected paper
  if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.key === "t") {
    ev.preventDefault();
    ev.stopPropagation();
    void PanelUI.startChatWithSelected(win);
    return;
  }

  // Ctrl+Shift+F → open Library Tools dialog
  if (ev.ctrlKey && ev.shiftKey && !ev.altKey && ev.key === "F") {
    ev.preventDefault();
    ev.stopPropagation();
    ToolsDialog.toggleDialog(win);
    return;
  }
}

function registerShortcuts(win: Window) {
  if ((win as any).__zoteroLocalAIShortcuts) return;
  (win as any).__zoteroLocalAIShortcuts = true;
  win.addEventListener("keydown", handleKeyDown as EventListener, true);
}

function unregisterShortcuts(win: Window) {
  if (!(win as any).__zoteroLocalAIShortcuts) return;
  win.removeEventListener("keydown", handleKeyDown as EventListener, true);
  delete (win as any).__zoteroLocalAIShortcuts;
}

// ── Menu registration ────────────────────────────────────────────
function registerToolsMenus() {
  const mainWin = Zotero.getMainWindow?.();
  if (mainWin?.document?.getElementById(MENU_IDS.submenu)) return;
  try {
    addon.data.ztoolkit.Menu.register("menuTools", {
      tag: "menu",
      id: MENU_IDS.submenu,
      label: "Zotero Infinity",
      children: [
        {
          tag: "menuitem",
          id: MENU_IDS.toggle,
          label: "Toggle Panel",
          commandListener: (ev: Event) => {
            const w = (ev.target as Element)?.ownerDocument?.defaultView;
            if (w) PanelUI.togglePanel(w);
          },
        },
        {
          tag: "menuitem",
          id: MENU_IDS.chat,
          label: "Chat with Selected Paper(s)",
          commandListener: (ev: Event) => {
            const w = (ev.target as Element)?.ownerDocument?.defaultView;
            if (w) void PanelUI.startChatWithSelected(w);
          },
        },
        {
          tag: "menuitem",
          id: "zotero-local-ai-tools-dialog",
          label: "Library Search (Ctrl+Shift+F)",
          commandListener: (ev: Event) => {
            const w = (ev.target as Element)?.ownerDocument?.defaultView;
            if (w) ToolsDialog.openDialog(w);
          },
        },
      ],
    });
    Zotero.debug("[zotero-local-ai] Tools menu registered");
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] Menu register error: ${String(e)}`);
  }
}

function unregisterToolsMenus() {
  try {
    addon.data.ztoolkit.Menu.unregister(MENU_IDS.submenu);
  } catch {
    // ignore
  }
}

// ── Toolbar button (main top bar) ─────────────────────────────────
function registerToolbarButton(win: Window) {
  const doc = win.document;
  if (doc.getElementById(TOOLBAR_BTN_ID)) return;

  try {
    const toggle = () => PanelUI.togglePanel(win);

    // Create XUL toolbarbutton if possible
    let btn: any;
    if (typeof (doc as any).createXULElement === "function") {
      btn = (doc as any).createXULElement("toolbarbutton");
    } else {
      btn = doc.createElement("toolbarbutton");
    }

    btn.id = TOOLBAR_BTN_ID;
    btn.setAttribute("label", "AI Chat");
    btn.setAttribute("tooltiptext", "Zotero Infinity – Chat with your papers (Ctrl+T)");
    btn.setAttribute("class", "zotero-tb-button");
    const iconUrl = `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`;
    try {
      btn.setAttribute("image", iconUrl);
    } catch {
      // image optional
    }
    btn.setAttribute(
      "style",
      [
        "-moz-appearance: none",
        "padding: 4px 10px",
        "margin: 0 4px",
        "border-radius: 4px",
        "font-size: 12px",
        "font-weight: 600",
        "cursor: pointer",
        "color: #fff",
        "background: #4a90d9",
        "border: none",
        "min-width: 0",
      ].join(";"),
    );

    // Use only command for XUL — prevents double-fire
    btn.addEventListener("command", toggle);

    // Insert next to known Zotero toolbar buttons
    const knownBtnIds = [
      "zotero-tb-add",
      "zotero-tb-lookup",
      "zotero-tb-note-add",
      "zotero-tb-attachment-add",
    ];

    let inserted = false;
    for (const id of knownBtnIds) {
      const ref = doc.getElementById(id);
      if (ref?.parentNode) {
        ref.parentNode.insertBefore(btn, ref.nextSibling);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      const tb =
        doc.getElementById("zotero-items-toolbar") ||
        doc.getElementById("zotero-toolbar") ||
        doc.querySelector("toolbar");
      if (tb) {
        tb.appendChild(btn);
        inserted = true;
      }
    }

    // Fallback: fixed HTML button with click handler
    if (!inserted) {
      btn.remove?.();
      const htmlBtn = doc.createElement("div") as HTMLElement;
      htmlBtn.id = TOOLBAR_BTN_ID;
      htmlBtn.textContent = "AI Chat";
      htmlBtn.setAttribute(
        "style",
        "position:fixed; top:8px; right:60px; z-index:999998; padding:6px 14px; background:#4a90d9; color:#fff; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; font-family:system-ui;",
      );
      htmlBtn.addEventListener("click", toggle);
      const root = doc.documentElement;
      if (root) root.appendChild(htmlBtn);
    }
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] registerToolbarButton error: ${String(e)}`);
  }
}

function unregisterToolbarButton() {
  try {
    for (const win of Zotero.getMainWindows?.() || []) {
      const btn = win.document.getElementById(TOOLBAR_BTN_ID);
      if (btn) btn.remove();
    }
  } catch {
    // ignore
  }
}

// ── Tab watcher (auto-open panel when user opens a paper) ────────
let _tabSelectListener: any = null;

function registerTabWatcher(win: Window) {
  if ((win as any).__zoteroLocalAITabWatcher) return;

  const handler = () => {
    try {
      // Check if a reader tab is now active (user opened a PDF)
      const reader = (Zotero as any).Reader?._readers?.[0];
      if (reader) {
        Zotero.debug("[zotero-local-ai] PDF reader detected, auto-opening panel");
        void PanelUI.autoOpenForPaper(win);
      }
    } catch (e) {
      Zotero.debug(`[zotero-local-ai] tabWatcher error: ${String(e)}`);
    }
  };

  // Zotero 7 uses a tab bar; listen for tab select events
  const tabbox = win.document.getElementById("zotero-view-tabbox");
  if (tabbox) {
    tabbox.addEventListener("select", handler);
    (win as any).__zoteroLocalAITabWatcher = handler;
    Zotero.debug("[zotero-local-ai] Tab watcher registered on zotero-view-tabbox");
    return;
  }

  // Fallback: poll for reader changes every 2 seconds
  const interval = win.setInterval(handler, 2000);
  (win as any).__zoteroLocalAITabWatcher = interval;
  Zotero.debug("[zotero-local-ai] Tab watcher registered via polling");
}

function unregisterTabWatcher(win: Window) {
  const ref = (win as any).__zoteroLocalAITabWatcher;
  if (!ref) return;

  if (typeof ref === "function") {
    const tabbox = win.document.getElementById("zotero-view-tabbox");
    if (tabbox) tabbox.removeEventListener("select", ref);
  } else {
    clearInterval(ref);
  }
  delete (win as any).__zoteroLocalAITabWatcher;
}

// ── Ollama initialization (runs in background) ───────────────────
let _ollamaInitDone = false;

async function initializeOllama(win: Window): Promise<void> {
  if (_ollamaInitDone) return;
  try {
    // Quick check: is Ollama already running?
    const running = await OllamaAPI.isRunning();
    if (running) {
      Zotero.debug("[zotero-local-ai] Ollama already running");
      _ollamaInitDone = true;
      PanelUI.transitionToReady(win);
      return;
    }

    // Ollama not running -- show manual setup instructions
    // (auto-install is attempted but may fail in Zotero sandbox)
    Zotero.debug("[zotero-local-ai] Ollama not running, showing setup instructions");
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] initializeOllama error: ${String(e)}`);
  }
}

// ── Lifecycle hooks ──────────────────────────────────────────────
async function onStartup() {
  try {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);

    Zotero.debug("[zotero-local-ai] onStartup ran");

    registerToolsMenus();
    for (const win of Zotero.getMainWindows?.() || []) {
      try {
        PanelUI.ensurePanel(win);
        registerShortcuts(win);
        registerToolbarButton(win);
        registerTabWatcher(win);
        // Start Ollama setup in background (non-blocking)
        void initializeOllama(win);
      } catch (e) {
        Zotero.debug(`[zotero-local-ai] window init error: ${String(e)}`);
      }
    }
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] onStartup error: ${String(e)}`);
  }
}

async function onShutdown() {
  try {
    Zotero.debug("[zotero-local-ai] onShutdown ran");
    for (const win of Zotero.getMainWindows?.() || []) {
      try {
        unregisterShortcuts(win);
        unregisterTabWatcher(win);
      } catch {
        /* ignore */
      }
    }
    unregisterToolsMenus();
    unregisterToolbarButton();
    ChatEngine.clearChat();
    dialogHandlers.clear();
    shortcutHandlers.clear();
    notifyHandlers.length = 0;
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] onShutdown error: ${String(e)}`);
  }
}

async function onMainWindowLoad(win: Window) {
  try {
    PanelUI.ensurePanel(win);
    registerShortcuts(win);
    registerToolbarButton(win);
    registerTabWatcher(win);
    win.setTimeout(() => registerToolsMenus(), 500);
    // Try Ollama init if not yet done
    void initializeOllama(win);
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] onMainWindowLoad error: ${String(e)}`);
  }
}

async function onMainWindowUnload(_win: Window) {
  try {
    unregisterShortcuts(_win);
    unregisterTabWatcher(_win);
  } catch {
    /* ignore */
  }
}

// ── Required stubs (scaffold types) ──────────────────────────────
function onDialogEvents(key: string, handler?: DialogHandler) {
  if (!handler) return dialogHandlers.get(key);
  dialogHandlers.set(key, handler);
  return () => dialogHandlers.delete(key);
}

function onShortcuts(key: string, handler?: ShortcutHandler) {
  if (!handler) return shortcutHandlers.get(key);
  shortcutHandlers.set(key, handler);
  return () => shortcutHandlers.delete(key);
}

function onNotify(
  eventOrHandler?: string | NotifyHandler,
  type?: string,
  ids?: any,
  extraData?: any,
) {
  if (typeof eventOrHandler === "function") {
    notifyHandlers.push(eventOrHandler);
    return () => {
      const idx = notifyHandlers.indexOf(eventOrHandler);
      if (idx >= 0) notifyHandlers.splice(idx, 1);
    };
  }

  for (const h of notifyHandlers) {
    try {
      void h(eventOrHandler as string, type, ids, extraData);
    } catch (e) {
      Zotero.debug(`[zotero-local-ai] onNotify handler error: ${String(e)}`);
    }
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onDialogEvents,
  onShortcuts,
  onNotify,
};

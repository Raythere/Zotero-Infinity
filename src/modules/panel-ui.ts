import * as ChatEngine from "./chat-engine";
import * as OllamaAPI from "./ollama-api";
import * as LibTools from "./library-tools";
import * as ToolsDialog from "./tools-dialog";
import { getSelectedItems, extractPaperContexts } from "./pdf-extract";

declare const Zotero: any;

const PANEL_ID = "zotero-local-ai-panel";
const BODY_ID = "zotero-local-ai-body";
const TABS_ID = "zotero-local-ai-tabs";
const MESSAGES_ID = "zotero-local-ai-messages";
const INPUT_ID = "zotero-local-ai-input";
const SEND_BTN_ID = "zotero-local-ai-send";
const STATUS_ID = "zotero-local-ai-status";

function $(doc: Document, id: string): HTMLElement | null {
  return doc.getElementById(id) as HTMLElement | null;
}

type PanelState = "setup" | "ready" | "chat";

let _currentState: PanelState = "setup";
let _isGenerating = false;
let _isCompact = true;
let _autoRetryTimer: ReturnType<typeof setInterval> | null = null;

// Track which item IDs are currently being loaded to avoid duplicate loads
let _loadingSessionId = "";

// ── Drag support ──────────────────────────────────────────────────
function makeDraggable(
  win: Window,
  panel: HTMLElement,
  handle: HTMLElement,
): void {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  handle.style.cursor = "grab";

  handle.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.tagName === "BUTTON" || target.closest?.("button")) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = panel.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;

    handle.style.cursor = "grabbing";
    e.preventDefault();
  });

  win.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = origLeft + dx;
    let newTop = origTop + dy;

    const maxLeft = win.innerWidth - panel.offsetWidth;
    const maxTop = win.innerHeight - panel.offsetHeight;
    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));

    panel.style.left = newLeft + "px";
    panel.style.top = newTop + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });

  win.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      handle.style.cursor = "grab";
    }
  });
}

// ── Compact / expanded size helpers ───────────────────────────────
const COMPACT_STYLE = "width:320px; height:360px;";
const EXPANDED_STYLE = "width:440px; height:75vh;";

function applyPanelSize(panel: HTMLElement) {
  const base = [
    "position: fixed",
    "bottom: 16px",
    "right: 16px",
    "background: var(--material-background, #fff)",
    "border: 1px solid rgba(0,0,0,0.18)",
    "border-radius: 10px",
    "box-shadow: 0 8px 32px rgba(0,0,0,0.18)",
    "z-index: 999999",
    "overflow: hidden",
    "font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial",
    "font-size: 13px",
    "color: var(--fill-primary, #333)",
    "flex-direction: column",
    "transition: width 0.2s ease, height 0.2s ease",
  ].join(";");

  const size = _isCompact ? COMPACT_STYLE : EXPANDED_STYLE;
  const display =
    panel.style.display === "none" ? "display:none;" : "display:flex;";
  panel.setAttribute("style", base + ";" + size + display);
}

// ── Styles ───────────────────────────────────────────────────────
const STYLES = {
  header: [
    "display: flex",
    "align-items: center",
    "justify-content: space-between",
    "padding: 6px 10px",
    "border-bottom: 1px solid rgba(0,0,0,0.12)",
    "font-weight: 600",
    "font-size: 13px",
    "flex-shrink: 0",
    "user-select: none",
    "-moz-user-select: none",
  ].join(";"),

  actionBar: [
    "display: flex",
    "align-items: center",
    "gap: 4px",
    "padding: 4px 10px",
    "border-bottom: 1px solid rgba(0,0,0,0.08)",
    "background: var(--material-toolbar, #f8f8f8)",
    "flex-shrink: 0",
    "flex-wrap: wrap",
  ].join(";"),

  actionBtn: [
    "border: 1px solid rgba(0,0,0,0.15)",
    "background: transparent",
    "cursor: pointer",
    "font-size: 10px",
    "padding: 3px 8px",
    "border-radius: 4px",
    "color: var(--fill-primary, #333)",
    "font-weight: 500",
    "white-space: nowrap",
  ].join(";"),

  tabBar: [
    "display: flex",
    "overflow-x: auto",
    "flex-shrink: 0",
    "border-bottom: 1px solid rgba(0,0,0,0.08)",
    "background: var(--material-toolbar, #f8f8f8)",
    "gap: 0",
    "min-height: 28px",
  ].join(";"),

  tab: [
    "display: flex",
    "align-items: center",
    "gap: 4px",
    "padding: 4px 6px 4px 10px",
    "font-size: 11px",
    "cursor: pointer",
    "white-space: nowrap",
    "border: none",
    "border-bottom: 2px solid transparent",
    "background: transparent",
    "color: var(--fill-primary, #666)",
    "max-width: 160px",
    "flex-shrink: 0",
  ].join(";"),

  tabActive: [
    "display: flex",
    "align-items: center",
    "gap: 4px",
    "padding: 4px 6px 4px 10px",
    "font-size: 11px",
    "cursor: pointer",
    "white-space: nowrap",
    "border: none",
    "border-bottom: 2px solid #4a90d9",
    "background: transparent",
    "color: #4a90d9",
    "font-weight: 600",
    "max-width: 160px",
    "flex-shrink: 0",
  ].join(";"),

  tabClose: [
    "border: none",
    "background: transparent",
    "font-size: 12px",
    "font-weight: bold",
    "color: rgba(0,0,0,0.4)",
    "cursor: pointer",
    "padding: 1px 4px",
    "border-radius: 3px",
    "line-height: 1",
    "flex-shrink: 0",
  ].join(";"),

  body: [
    "flex:1",
    "display:flex",
    "flex-direction:column",
    "overflow:hidden",
  ].join(";"),
  messages: [
    "flex:1",
    "overflow-y:auto",
    "padding:10px 12px",
    "display:flex",
    "flex-direction:column",
    "gap:8px",
  ].join(";"),
  inputRow: [
    "display:flex",
    "padding:8px 12px",
    "gap:6px",
    "border-top:1px solid rgba(0,0,0,0.12)",
    "flex-shrink:0",
  ].join(";"),
  input: [
    "flex:1",
    "padding:6px 10px",
    "border:1px solid rgba(0,0,0,0.2)",
    "border-radius:6px",
    "font-size:12px",
    "font-family:inherit",
    "outline:none",
    "background:var(--material-background,#fff)",
    "color:var(--fill-primary,#333)",
  ].join(";"),
  sendBtn: [
    "padding:6px 12px",
    "border:none",
    "border-radius:6px",
    "background:#4a90d9",
    "color:#fff",
    "font-size:12px",
    "font-weight:600",
    "cursor:pointer",
    "white-space:nowrap",
  ].join(";"),
  closeBtn: [
    "border:none",
    "background:transparent",
    "cursor:pointer",
    "font-size:14px",
    "line-height:1",
    "padding:2px 6px",
    "color:var(--fill-primary,#333)",
  ].join(";"),
  userBubble: [
    "align-self:flex-end",
    "background:#4a90d9",
    "color:#fff",
    "padding:6px 10px",
    "border-radius:10px 10px 2px 10px",
    "max-width:85%",
    "white-space:pre-wrap",
    "word-break:break-word",
    "font-size:12px",
  ].join(";"),
  assistantBubble: [
    "align-self:flex-start",
    "background:var(--material-toolbar,#f0f0f0)",
    "color:var(--fill-primary,#333)",
    "padding:6px 10px",
    "border-radius:10px 10px 10px 2px",
    "max-width:85%",
    "white-space:pre-wrap",
    "word-break:break-word",
    "font-size:12px",
  ].join(";"),
  statusBar: [
    "padding:4px 12px",
    "font-size:10px",
    "color:rgba(0,0,0,0.45)",
    "border-top:1px solid rgba(0,0,0,0.08)",
    "flex-shrink:0",
    "text-align:center",
  ].join(";"),
  progressBar: [
    "width:100%",
    "height:4px",
    "background:rgba(0,0,0,0.1)",
    "border-radius:2px",
    "overflow:hidden",
    "margin:6px 0",
  ].join(";"),
  progressFill: [
    "height:100%",
    "background:#4a90d9",
    "border-radius:2px",
    "transition:width 0.3s",
    "width:0%",
  ].join(";"),
} as const;

// ── Session tab rendering ────────────────────────────────────────

function renderTabs(win: Window): void {
  const doc = win.document;
  const tabBar = $(doc, TABS_ID);
  if (!tabBar) return;

  const sessions = ChatEngine.getAllSessions();
  const activeId = ChatEngine.getActiveSessionId();

  tabBar.innerHTML = "";

  if (sessions.length === 0) {
    tabBar.style.display = "none";
    return;
  }

  tabBar.style.display = "flex";

  for (const session of sessions) {
    const isActive = session.id === activeId;
    const tab = doc.createElement("div") as HTMLElement;
    tab.setAttribute("style", isActive ? STYLES.tabActive : STYLES.tab);
    tab.setAttribute("title", session.label);

    const label = doc.createElement("span") as HTMLElement;
    label.textContent = session.label;
    label.setAttribute(
      "style",
      "overflow:hidden; text-overflow:ellipsis; max-width:110px;",
    );
    tab.appendChild(label);

    // Close button on each tab
    const closeBtn = doc.createElement("button") as HTMLElement;
    closeBtn.textContent = "x";
    closeBtn.setAttribute("style", STYLES.tabClose);
    closeBtn.setAttribute("title", "Close this tab");
    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.color = "#e44";
      closeBtn.style.background = "rgba(200,0,0,0.12)";
    });
    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.color = "rgba(0,0,0,0.4)";
      closeBtn.style.background = "transparent";
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      ChatEngine.closeSession(session.id);
      renderTabs(win);
      if (ChatEngine.isActive()) {
        setState(win, "chat");
      } else {
        void refreshState(win);
      }
    });
    tab.appendChild(closeBtn);

    tab.addEventListener("click", () => {
      if (ChatEngine.switchSession(session.id)) {
        renderTabs(win);
        setState(win, "chat");
      }
    });

    tabBar.appendChild(tab);
  }
}

// ── Build a session ID from Zotero item IDs ──────────────────────

function buildSessionId(items: any[]): string {
  const ids = items
    .map((it: any) => String(it.id || it.key || ""))
    .filter(Boolean)
    .sort();
  return ids.length > 0 ? `items-${ids.join("-")}` : "";
}

// ── Panel lifecycle ──────────────────────────────────────────────

export function ensurePanel(win: Window): HTMLElement {
  const doc = win.document;
  let panel = $(doc, PANEL_ID);
  if (panel) return panel;

  panel = doc.createElement("div") as HTMLElement;
  panel.id = PANEL_ID;
  panel.style.display = "none";
  applyPanelSize(panel);

  // Header row: title + expand/close
  const header = doc.createElement("div") as HTMLElement;
  header.setAttribute("style", STYLES.header);

  const titleSpan = doc.createElement("span") as HTMLElement;
  titleSpan.textContent = "AI Chat";

  const headerBtns = doc.createElement("div") as HTMLElement;
  headerBtns.setAttribute(
    "style",
    "display:flex; gap:3px; align-items:center;",
  );

  const expandBtn = doc.createElement("button") as HTMLElement;
  expandBtn.textContent = _isCompact ? "\u2922" : "\u2921";
  expandBtn.setAttribute("title", "Toggle size");
  expandBtn.setAttribute("style", STYLES.closeBtn);
  expandBtn.addEventListener("click", () => {
    _isCompact = !_isCompact;
    expandBtn.textContent = _isCompact ? "\u2922" : "\u2921";
    applyPanelSize(panel!);
  });

  const closeBtn = doc.createElement("button") as HTMLElement;
  closeBtn.textContent = "\u2715";
  closeBtn.setAttribute("style", STYLES.closeBtn);
  closeBtn.addEventListener("click", () => {
    panel!.style.display = "none";
  });

  headerBtns.appendChild(expandBtn);
  headerBtns.appendChild(closeBtn);

  header.appendChild(titleSpan);
  header.appendChild(headerBtns);

  // Action bar: feature buttons
  const actionBar = doc.createElement("div") as HTMLElement;
  actionBar.id = "zotero-local-ai-actionbar";
  actionBar.setAttribute("style", STYLES.actionBar);

  const actionDefs = [
    {
      label: "Save Note",
      title: "Save chat as Zotero note",
      handler: () => void handleSaveNote(win),
    },
    {
      label: "Search Library",
      title: "Search across your entire library (Ctrl+Shift+F)",
      handler: () => ToolsDialog.openDialog(win),
    },
  ];

  for (const def of actionDefs) {
    const btn = doc.createElement("button") as HTMLElement;
    btn.textContent = def.label;
    btn.setAttribute("title", def.title);
    btn.setAttribute("style", STYLES.actionBtn);
    btn.addEventListener("click", def.handler);
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(74,144,217,0.1)";
      btn.style.borderColor = "#4a90d9";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
      btn.style.borderColor = "rgba(0,0,0,0.15)";
    });
    actionBar.appendChild(btn);
  }

  // Tab bar
  const tabBar = doc.createElement("div") as HTMLElement;
  tabBar.id = TABS_ID;
  tabBar.setAttribute("style", STYLES.tabBar + ";display:none;");

  // Body container
  const body = doc.createElement("div");
  body.id = BODY_ID;
  body.setAttribute("style", STYLES.body);

  const messages = doc.createElement("div");
  messages.id = MESSAGES_ID;
  messages.setAttribute("style", STYLES.messages);

  const inputRow = doc.createElement("div");
  inputRow.setAttribute("style", STYLES.inputRow);

  const input = doc.createElement("input") as HTMLInputElement;
  input.id = INPUT_ID;
  input.setAttribute("style", STYLES.input);
  input.setAttribute("placeholder", "Ask about the paper...");
  input.addEventListener("keydown", (ev: any) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void handleSend(win);
    }
  });

  const sendBtn = doc.createElement("button");
  sendBtn.id = SEND_BTN_ID;
  sendBtn.textContent = "Send";
  sendBtn.setAttribute("style", STYLES.sendBtn);
  sendBtn.addEventListener("click", () => void handleSend(win));

  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);

  const status = doc.createElement("div");
  status.id = STATUS_ID;
  status.setAttribute("style", STYLES.statusBar);

  body.appendChild(messages);
  body.appendChild(inputRow);
  body.appendChild(status);

  panel.appendChild(header);
  panel.appendChild(actionBar);
  panel.appendChild(tabBar);
  panel.appendChild(body);

  const root = doc.documentElement;
  if (root) root.appendChild(panel);

  makeDraggable(win, panel, header);
  void refreshState(win);

  return panel;
}

export function togglePanel(win: Window, show?: boolean): void {
  const panel = ensurePanel(win) as any;
  const shouldShow =
    typeof show === "boolean" ? show : panel.style.display === "none";
  if (shouldShow) {
    panel.style.display = "flex";
    applyPanelSize(panel);
    renderTabs(win);
    void refreshState(win);
  } else {
    panel.style.display = "none";
  }
}

/**
 * Auto-open the panel when a paper is viewed.
 * Creates or switches to the session for this paper.
 */
export async function autoOpenForPaper(win: Window): Promise<void> {
  try {
    // Never interrupt an active generation
    if (_isGenerating) return;

    const running = await OllamaAPI.isRunning();
    if (!running) return;

    const items = getSelectedItems(win);
    if (!items.length) return;

    const sessionId = buildSessionId(items);
    if (!sessionId) return;

    // If this session is already active and panel is visible, do nothing
    if (ChatEngine.getActiveSessionId() === sessionId) {
      const panel = $(win.document, PANEL_ID);
      if (panel && panel.style.display !== "none") return;
    }

    // If this session already exists, just switch to it
    if (ChatEngine.switchSession(sessionId)) {
      const panel = ensurePanel(win);
      if (panel.style.display === "none") {
        _isCompact = true;
        panel.style.display = "flex";
        applyPanelSize(panel);
      }
      renderTabs(win);
      setState(win, "chat");
      return;
    }

    // Prevent duplicate loading for the same session
    if (_loadingSessionId === sessionId) return;
    _loadingSessionId = sessionId;

    const panel = ensurePanel(win);
    if (panel.style.display === "none") {
      _isCompact = true;
      panel.style.display = "flex";
      applyPanelSize(panel);
    }

    const messagesEl = $(win.document, MESSAGES_ID);
    const statusEl = $(win.document, STATUS_ID);
    if (messagesEl) {
      messagesEl.innerHTML = "";
      appendInfoBubble(win.document, messagesEl, "Loading paper...");
    }
    if (statusEl) statusEl.textContent = "Loading...";

    const papers = await extractPaperContexts(items);
    _loadingSessionId = "";

    if (!papers.length) {
      if (messagesEl) {
        messagesEl.innerHTML = "";
        appendInfoBubble(
          win.document,
          messagesEl,
          "Open a paper to start chatting.",
        );
      }
      return;
    }

    ChatEngine.startChat(papers, sessionId);
    renderTabs(win);
    setState(win, "chat");
  } catch (e) {
    _loadingSessionId = "";
    Zotero.debug(`[zotero-local-ai] autoOpenForPaper error: ${String(e)}`);
  }
}

// ── State management ─────────────────────────────────────────────

async function refreshState(win: Window): Promise<void> {
  Zotero.debug("[zotero-local-ai] refreshState: checking Ollama...");
  try {
    const running = await OllamaAPI.isRunning();
    if (!running) {
      setState(win, "setup");
      return;
    }
    if (ChatEngine.isActive()) {
      setState(win, "chat");
      return;
    }
    setState(win, "ready");
  } catch (e: any) {
    Zotero.debug(`[zotero-local-ai] refreshState error: ${String(e)}`);
    setState(win, "setup");
    const messagesEl = $(win.document, MESSAGES_ID);
    if (messagesEl) {
      appendInfoBubble(
        win.document,
        messagesEl,
        `Connection check error: ${String(e)}`,
      );
    }
  }
}

function setState(win: Window, state: PanelState): void {
  _currentState = state;
  const doc = win.document;
  const messagesEl = $(doc, MESSAGES_ID);
  const statusEl = $(doc, STATUS_ID);
  const inputEl = $(doc, INPUT_ID) as HTMLInputElement | null;
  const sendBtn = $(doc, SEND_BTN_ID) as HTMLButtonElement | null;

  if (!messagesEl || !statusEl) return;

  if (state === "setup") {
    messagesEl.innerHTML = "";
    appendInfoBubble(
      doc,
      messagesEl,
      "Waiting for Ollama...\n\nThe AI engine is starting up or is not installed yet. The plugin will auto-connect once Ollama is ready.",
    );

    // Spinner + status line
    const statusLine = doc.createElement("div") as HTMLElement;
    statusLine.id = "zotero-local-ai-setup-status";
    statusLine.setAttribute(
      "style",
      "text-align:center; padding:8px 0; font-size:11px; color:rgba(0,0,0,0.45);",
    );
    statusLine.textContent = "Checking connection...";
    messagesEl.appendChild(statusLine);

    const checkBtn = doc.createElement("button") as HTMLElement;
    checkBtn.textContent = "Retry Now";
    checkBtn.setAttribute(
      "style",
      "display:block; margin:8px auto; padding:6px 16px; border:none; border-radius:6px; background:#4a90d9; color:#fff; font-size:12px; font-weight:600; cursor:pointer;",
    );
    checkBtn.addEventListener("click", async () => {
      checkBtn.textContent = "Checking...";
      checkBtn.setAttribute("disabled", "true");
      statusLine.textContent = "Checking connection...";
      try {
        await refreshState(win);
      } catch {
        checkBtn.textContent = "Retry Now";
        checkBtn.removeAttribute("disabled");
      }
    });
    messagesEl.appendChild(checkBtn);

    const linkBtn = doc.createElement("button") as HTMLElement;
    linkBtn.textContent = "Download Ollama Manually";
    linkBtn.setAttribute(
      "style",
      "display:block; margin:6px auto; padding:4px 12px; border:1px solid rgba(0,0,0,0.2); border-radius:6px; background:transparent; color:var(--fill-primary,#333); font-size:11px; cursor:pointer;",
    );
    linkBtn.addEventListener("click", () => {
      try {
        Zotero.launchURL("https://ollama.com/download");
      } catch {
        /* */
      }
    });
    messagesEl.appendChild(linkBtn);

    statusEl.textContent = "Ollama: connecting...";
    if (inputEl) inputEl.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    // Auto-retry every 5 seconds
    if (_autoRetryTimer) clearInterval(_autoRetryTimer);
    _autoRetryTimer = setInterval(async () => {
      try {
        const running = await OllamaAPI.isRunning();
        if (running) {
          if (_autoRetryTimer) {
            clearInterval(_autoRetryTimer);
            _autoRetryTimer = null;
          }
          await refreshState(win);
        } else {
          const sl = $(doc, "zotero-local-ai-setup-status");
          if (sl)
            sl.textContent = `Last checked: ${new Date().toLocaleTimeString()} — retrying...`;
        }
      } catch {
        /* keep retrying */
      }
    }, 5000);
  } else if (state === "ready") {
    if (_autoRetryTimer) {
      clearInterval(_autoRetryTimer);
      _autoRetryTimer = null;
    }
    messagesEl.innerHTML = "";
    appendInfoBubble(
      doc,
      messagesEl,
      'Ollama connected!\n\nSelect a paper and press Ctrl+T, or open a PDF \u2014 the chat will load automatically.\n\nUse "Search Library" above to search your library or tag papers.',
    );
    statusEl.textContent = `Connected | ${ChatEngine.getModel()}`;
    if (inputEl) inputEl.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
  } else if (state === "chat") {
    if (_autoRetryTimer) {
      clearInterval(_autoRetryTimer);
      _autoRetryTimer = null;
    }
    renderChatHistory(win);
    renderTabs(win);
    statusEl.textContent = `${ChatEngine.getPapers().length} paper(s) | ${ChatEngine.getModel()}`;
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.focus();
    }
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ── Message rendering ────────────────────────────────────────────

function appendInfoBubble(
  doc: Document,
  container: HTMLElement,
  text: string,
): void {
  const bubble = doc.createElement("div");
  bubble.setAttribute("style", STYLES.assistantBubble);
  bubble.textContent = text;
  container.appendChild(bubble);
}

function appendUserBubble(
  doc: Document,
  container: HTMLElement,
  text: string,
): void {
  const bubble = doc.createElement("div");
  bubble.setAttribute("style", STYLES.userBubble);
  bubble.textContent = text;
  container.appendChild(bubble);
}

function appendAssistantBubble(
  doc: Document,
  container: HTMLElement,
): HTMLElement {
  const bubble = doc.createElement("div");
  bubble.setAttribute("style", STYLES.assistantBubble);
  container.appendChild(bubble);
  return bubble;
}

function renderChatHistory(win: Window): void {
  const doc = win.document;
  const messagesEl = $(doc, MESSAGES_ID);
  if (!messagesEl) return;

  messagesEl.innerHTML = "";

  // Always show the paper title(s) at the top
  const papers = ChatEngine.getPapers();
  if (papers.length > 0) {
    const titles = papers.map((p) => p.title || "Untitled");
    const titleText =
      papers.length === 1
        ? `"${titles[0]}"`
        : titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
    const headerBubble = doc.createElement("div");
    headerBubble.setAttribute(
      "style",
      [
        "padding: 6px 10px",
        "border-left: 3px solid #4a90d9",
        "background: rgba(74,144,217,0.06)",
        "border-radius: 4px",
        "font-size: 11px",
        "color: var(--fill-primary, #555)",
        "white-space: pre-wrap",
        "margin-bottom: 4px",
      ].join(";"),
    );
    headerBubble.textContent = titleText;
    messagesEl.appendChild(headerBubble);
  }

  const msgs = ChatEngine.getMessages();
  for (const m of msgs) {
    if (m.role === "user") {
      appendUserBubble(doc, messagesEl, m.content);
    } else if (m.role === "assistant") {
      const bubble = appendAssistantBubble(doc, messagesEl);
      bubble.textContent = m.content;
    }
  }
  // Scroll to bottom only on fresh render, not during generation
  if (!_isGenerating) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// ── Scroll helpers ───────────────────────────────────────────────

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function scrollToBottomIfNeeded(el: HTMLElement): void {
  if (isNearBottom(el)) {
    el.scrollTop = el.scrollHeight;
  }
}

// ── Actions ──────────────────────────────────────────────────────

async function handleSend(win: Window): Promise<void> {
  if (_isGenerating) return;

  const doc = win.document;
  const inputEl = $(doc, INPUT_ID) as HTMLInputElement | null;
  const messagesEl = $(doc, MESSAGES_ID);
  const statusEl = $(doc, STATUS_ID);
  if (!inputEl || !messagesEl) return;

  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";
  _isGenerating = true;
  updateSendButton(doc, true);

  appendUserBubble(doc, messagesEl, text);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const assistantBubble = appendAssistantBubble(doc, messagesEl);
  assistantBubble.textContent = "Thinking...";
  if (statusEl) statusEl.textContent = "Generating...";

  if (_isCompact) {
    _isCompact = false;
    const panel = $(doc, PANEL_ID);
    if (panel) applyPanelSize(panel);
  }

  try {
    let firstToken = true;
    await ChatEngine.sendMessage(text, (token) => {
      if (firstToken) {
        assistantBubble.textContent = "";
        firstToken = false;
      }
      assistantBubble.textContent += token;
      scrollToBottomIfNeeded(messagesEl);
    });
  } catch (e: any) {
    if (e.name === "AbortError") {
      assistantBubble.textContent += "\n\n[Generation stopped]";
    } else {
      assistantBubble.textContent = `Error: ${String(e)}`;
      Zotero.debug(`[zotero-local-ai] Chat error: ${String(e)}`);
    }
  } finally {
    _isGenerating = false;
    updateSendButton(doc, false);
    if (statusEl) {
      statusEl.textContent = `${ChatEngine.getPapers().length} paper(s) | ${ChatEngine.getModel()}`;
    }
    scrollToBottomIfNeeded(messagesEl);
  }
}

function updateSendButton(doc: Document, generating: boolean): void {
  const sendBtn = $(doc, SEND_BTN_ID) as HTMLButtonElement | null;
  const inputEl = $(doc, INPUT_ID) as HTMLInputElement | null;
  if (sendBtn) {
    sendBtn.textContent = generating ? "Stop" : "Send";
    sendBtn.onclick = generating ? () => ChatEngine.abortGeneration() : null;
  }
  if (inputEl) inputEl.disabled = generating;
}

export async function startChatWithSelected(win: Window): Promise<void> {
  const items = getSelectedItems(win);
  if (!items.length) {
    togglePanel(win, true);
    setState(win, _currentState);
    const messagesEl = $(win.document, MESSAGES_ID);
    if (messagesEl) {
      messagesEl.innerHTML = "";
      appendInfoBubble(
        win.document,
        messagesEl,
        "No items selected.\n\nSelect one or more items in your library, then press Ctrl+T.",
      );
    }
    return;
  }

  const sessionId = buildSessionId(items);

  // If session exists, switch to it
  if (sessionId && ChatEngine.switchSession(sessionId)) {
    togglePanel(win, true);
    renderTabs(win);
    setState(win, "chat");
    return;
  }

  _isCompact = true;
  togglePanel(win, true);

  const messagesEl = $(win.document, MESSAGES_ID);
  const statusEl = $(win.document, STATUS_ID);
  if (messagesEl) {
    messagesEl.innerHTML = "";
    appendInfoBubble(
      win.document,
      messagesEl,
      `Loading ${items.length} item(s)...`,
    );
  }
  if (statusEl) statusEl.textContent = "Loading papers...";

  try {
    const running = await OllamaAPI.isRunning();
    if (!running) {
      setState(win, "setup");
      return;
    }

    const papers = await extractPaperContexts(items);
    if (!papers.length) {
      if (messagesEl) {
        messagesEl.innerHTML = "";
        appendInfoBubble(
          win.document,
          messagesEl,
          "Could not extract content from the selected items.",
        );
      }
      return;
    }

    ChatEngine.startChat(papers, sessionId || undefined);
    renderTabs(win);
    setState(win, "chat");
  } catch (e: any) {
    Zotero.debug(`[zotero-local-ai] startChatWithSelected error: ${String(e)}`);
    if (messagesEl) {
      messagesEl.innerHTML = "";
      appendInfoBubble(win.document, messagesEl, `Error: ${String(e)}`);
    }
  }
}

// ── Save Chat as Note ────────────────────────────────────────────

async function handleSaveNote(win: Window): Promise<void> {
  const session = ChatEngine.getActiveSession();
  if (!session || session.messages.length <= 1) {
    const messagesEl = $(win.document, MESSAGES_ID);
    if (messagesEl)
      appendInfoBubble(
        win.document,
        messagesEl,
        "No conversation to save yet.",
      );
    return;
  }

  const messagesEl = $(win.document, MESSAGES_ID);
  if (messagesEl)
    appendInfoBubble(win.document, messagesEl, "Saving chat as note...");

  try {
    // Try to attach to the first paper's parent item
    const items = getSelectedItems(win);
    const parentId = items.length > 0 ? items[0].id : null;
    await LibTools.saveChatAsNote(parentId, session.papers, session.messages);
    if (messagesEl) {
      appendInfoBubble(
        win.document,
        messagesEl,
        "Chat saved as a Zotero note!",
      );
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } catch (e: any) {
    Zotero.debug(`[zotero-local-ai] saveNote error: ${String(e)}`);
    if (messagesEl)
      appendInfoBubble(
        win.document,
        messagesEl,
        `Error saving note: ${String(e)}`,
      );
  }
}

export function updateSetupProgress(
  win: Window,
  message: string,
  percent?: number,
): void {
  const messagesEl = $(win.document, MESSAGES_ID);
  const statusEl = $(win.document, STATUS_ID);
  if (messagesEl) {
    messagesEl.innerHTML = "";
    appendInfoBubble(win.document, messagesEl, message);
    if (typeof percent === "number" && percent >= 0) {
      const barContainer = win.document.createElement("div") as HTMLElement;
      barContainer.setAttribute("style", STYLES.progressBar);
      const fill = win.document.createElement("div") as HTMLElement;
      fill.setAttribute(
        "style",
        STYLES.progressFill + `;width:${Math.min(100, percent)}%`,
      );
      barContainer.appendChild(fill);
      messagesEl.appendChild(barContainer);
    }
  }
  if (statusEl) statusEl.textContent = message;
}

export function transitionToReady(win: Window): void {
  setState(win, "ready");
}

import * as OllamaAPI from "./ollama-api";
import * as LibTools from "./library-tools";
import {
  getSelectedItems as getZoteroSelectedItems,
  extractPaperContexts,
} from "./pdf-extract";

declare const Zotero: any;

const OVERLAY_ID = "zotero-local-ai-tools-overlay";
const DIALOG_ID = "zotero-local-ai-tools-dialog";

type DialogMode = "search" | "tag" | "compare";
type TagSubMode = "categorize" | "search-tag";

function $(doc: Document, id: string): HTMLElement | null {
  return doc.getElementById(id) as HTMLElement | null;
}

let _busy = false;
let _mode: DialogMode = "search";
let _tagSub: TagSubMode = "categorize";
let _selectedTags: Set<string> = new Set();
let _tagTargetItems: any[] = [];
let _compareItems: any[] = [];

// ── Public API ──────────────────────────────────────────────────

export function openDialog(win: Window): void {
  const existing = $(win.document, OVERLAY_ID);
  if (existing) {
    existing.style.display = "flex";
    return;
  }
  _mode = "search";
  _tagSub = "categorize";
  createDialog(win);
}

export function closeDialog(win: Window): void {
  const overlay = $(win.document, OVERLAY_ID);
  if (overlay) overlay.remove();
}

export function toggleDialog(win: Window): void {
  const overlay = $(win.document, OVERLAY_ID);
  if (overlay && overlay.style.display !== "none") {
    overlay.remove();
  } else {
    openDialog(win);
  }
}

// ── Dialog construction ─────────────────────────────────────────

function createDialog(win: Window): void {
  const doc = win.document;
  injectStyles(doc);

  const overlay = doc.createElement("div") as HTMLElement;
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("style", css.overlay);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const dialog = doc.createElement("div") as HTMLElement;
  dialog.id = DIALOG_ID;
  dialog.setAttribute("style", css.dialog);

  // Title bar
  const titleBar = doc.createElement("div") as HTMLElement;
  titleBar.setAttribute("style", css.titleBar);

  const titleIcon = doc.createElement("span") as HTMLElement;
  titleIcon.textContent = "\uD83D\uDD0D";
  titleIcon.setAttribute("style", "margin-right:8px; font-size:14px;");

  const titleText = doc.createElement("span") as HTMLElement;
  titleText.id = "zotero-ai-tools-title";
  titleText.textContent = "Zotero Infinity \u2014 Library Search";
  titleText.setAttribute("style", "font-weight:600; font-size:12px; flex:1;");

  const winBtns = doc.createElement("div") as HTMLElement;
  winBtns.setAttribute("style", "display:flex; gap:2px;");

  const closeWinBtn = doc.createElement("button") as HTMLElement;
  closeWinBtn.textContent = "\u2715";
  closeWinBtn.setAttribute("style", css.winBtn);
  closeWinBtn.addEventListener("mouseenter", () => {
    closeWinBtn.style.background = "#e81123";
    closeWinBtn.style.color = "#fff";
  });
  closeWinBtn.addEventListener("mouseleave", () => {
    closeWinBtn.style.background = "transparent";
    closeWinBtn.style.color = "var(--fill-primary,#333)";
  });
  closeWinBtn.addEventListener("click", () => overlay.remove());
  winBtns.appendChild(closeWinBtn);

  titleBar.appendChild(titleIcon);
  titleBar.appendChild(titleText);
  titleBar.appendChild(winBtns);

  // Tab bar
  const tabBar = doc.createElement("div") as HTMLElement;
  tabBar.id = "zotero-ai-tools-tabbar";
  tabBar.setAttribute("style", css.tabBar);
  buildTabBar(doc, tabBar, win);

  // Body container
  const body = doc.createElement("div") as HTMLElement;
  body.id = "zotero-ai-tools-body";
  body.setAttribute(
    "style",
    "display:flex; flex-direction:column; flex:1; overflow:hidden;",
  );

  // Footer
  const footer = doc.createElement("div") as HTMLElement;
  footer.setAttribute("style", css.footer);

  const statusText = doc.createElement("span") as HTMLElement;
  statusText.id = "zotero-ai-tools-status";
  statusText.setAttribute("style", "font-size:11px; color:rgba(0,0,0,0.45);");

  const closeFooterBtn = doc.createElement("button") as HTMLElement;
  closeFooterBtn.textContent = "Close";
  closeFooterBtn.setAttribute("style", css.footerBtn);
  closeFooterBtn.addEventListener("click", () => overlay.remove());

  footer.appendChild(statusText);
  footer.appendChild(closeFooterBtn);

  dialog.appendChild(titleBar);
  dialog.appendChild(tabBar);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  const root = doc.documentElement;
  if (root) root.appendChild(overlay);

  makeDraggable(win, dialog, titleBar);
  renderBody(win);
}

// ── Tab bar ──────────────────────────────────────────────────────

function buildTabBar(doc: Document, tabBar: HTMLElement, win: Window): void {
  tabBar.innerHTML = "";
  const tabs: { label: string; mode: DialogMode }[] = [
    { label: "\uD83D\uDD0D  Search Library", mode: "search" },
    { label: "\uD83C\uDFF7\uFE0F  Tag Papers", mode: "tag" },
    { label: "\u2194\uFE0F  Compare Papers", mode: "compare" },
  ];

  for (const t of tabs) {
    const btn = doc.createElement("button") as HTMLElement;
    btn.textContent = t.label;
    const isActive = _mode === t.mode;
    btn.setAttribute("style", css.tabBtn(isActive));
    btn.addEventListener("click", () => {
      if (_mode === t.mode) return;
      _mode = t.mode;
      buildTabBar(doc, tabBar, win);
      renderBody(win);
    });
    tabBar.appendChild(btn);
  }
}

// ── Body rendering ───────────────────────────────────────────────

function renderBody(win: Window): void {
  const doc = win.document;
  const body = $(doc, "zotero-ai-tools-body");
  const titleEl = $(doc, "zotero-ai-tools-title");
  if (!body) return;
  body.innerHTML = "";

  if (_mode === "search") {
    if (titleEl) titleEl.textContent = "Zotero Infinity \u2014 Library Search";
    renderSearchBody(win, body);
  } else if (_mode === "tag") {
    if (titleEl) titleEl.textContent = "Zotero Infinity \u2014 Tag Papers";
    renderTagBody(win, body);
  } else {
    if (titleEl) titleEl.textContent = "Zotero Infinity \u2014 Compare Papers";
    renderCompareBody(win, body);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SEARCH MODE
// ═══════════════════════════════════════════════════════════════════

function renderSearchBody(win: Window, body: HTMLElement): void {
  const doc = win.document;

  const searchRow = doc.createElement("div") as HTMLElement;
  searchRow.setAttribute("style", css.searchRow);

  const searchLabel = doc.createElement("label") as HTMLElement;
  searchLabel.textContent = "Search:";
  searchLabel.setAttribute("style", css.fieldLabel);

  const searchInput = doc.createElement("input") as HTMLInputElement;
  searchInput.id = "zotero-ai-tools-input";
  searchInput.setAttribute("style", css.searchInput);
  searchInput.setAttribute(
    "placeholder",
    "Search by title, author, keywords, or content...",
  );
  searchInput.addEventListener("keydown", (ev: any) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void doSearch(win);
    }
  });

  const searchBtn = doc.createElement("button") as HTMLElement;
  searchBtn.id = "zotero-ai-tools-searchbtn";
  searchBtn.textContent = "Search";
  searchBtn.setAttribute("style", css.searchBtn);
  searchBtn.addEventListener("click", () => void doSearch(win));

  searchRow.appendChild(searchLabel);
  searchRow.appendChild(searchInput);
  searchRow.appendChild(searchBtn);

  const infoRow = doc.createElement("div") as HTMLElement;
  infoRow.setAttribute("style", css.infoRow);
  infoRow.innerHTML =
    `<span style="font-size:11px; color:rgba(0,0,0,0.45);">` +
    `Searches: <strong>titles</strong>, <strong>authors</strong>, <strong>abstracts</strong>, <strong>tags</strong>, and <strong>full paper text</strong>. ` +
    `AI will synthesize an answer from matching papers.</span>`;

  const tableWrap = doc.createElement("div") as HTMLElement;
  tableWrap.setAttribute("style", css.tableWrap);

  const table = doc.createElement("table") as HTMLElement;
  table.setAttribute("style", css.table);

  const thead = doc.createElement("thead") as HTMLElement;
  const headRow = doc.createElement("tr") as HTMLElement;
  for (const col of ["#", "Title", "Authors", "Year", "Relevance"]) {
    const th = doc.createElement("th") as HTMLElement;
    th.textContent = col;
    th.setAttribute("style", css.th);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement("tbody") as HTMLElement;
  tbody.id = "zotero-ai-tools-tbody";

  const emptyRow = doc.createElement("tr") as HTMLElement;
  const emptyCell = doc.createElement("td") as HTMLElement;
  emptyCell.setAttribute("colspan", "5");
  emptyCell.setAttribute(
    "style",
    "text-align:center; padding:50px 0; color:rgba(0,0,0,0.3); font-size:12px;",
  );
  emptyCell.textContent =
    "Enter a search query \u2014 search by title, author name, keywords, or any text from your papers.";
  emptyRow.appendChild(emptyCell);
  tbody.appendChild(emptyRow);

  table.appendChild(tbody);
  tableWrap.appendChild(table);

  const answerArea = doc.createElement("div") as HTMLElement;
  answerArea.id = "zotero-ai-tools-answer";
  answerArea.setAttribute("style", css.answerArea + ";display:none;");

  body.appendChild(searchRow);
  body.appendChild(infoRow);
  body.appendChild(tableWrap);
  body.appendChild(answerArea);

  searchInput.focus();
}

// ═══════════════════════════════════════════════════════════════════
//  TAG MODE — with sub-tabs
// ═══════════════════════════════════════════════════════════════════

function renderTagBody(win: Window, body: HTMLElement): void {
  const doc = win.document;

  // Sub-tab bar
  const subTabBar = doc.createElement("div") as HTMLElement;
  subTabBar.id = "zotero-ai-tag-subtabs";
  subTabBar.setAttribute("style", css.subTabBar);
  buildSubTabBar(doc, subTabBar, win);

  // Sub-body content
  const subBody = doc.createElement("div") as HTMLElement;
  subBody.id = "zotero-ai-tag-subbody";
  subBody.setAttribute(
    "style",
    "display:flex; flex-direction:column; flex:1; overflow:hidden;",
  );

  body.appendChild(subTabBar);
  body.appendChild(subBody);

  renderTagSubBody(win);
}

function buildSubTabBar(doc: Document, bar: HTMLElement, win: Window): void {
  bar.innerHTML = "";
  const subs: { label: string; mode: TagSubMode }[] = [
    { label: "\uD83D\uDCDA  Categorize Library", mode: "categorize" },
    { label: "\uD83D\uDD0E  Search & Tag", mode: "search-tag" },
  ];

  for (const s of subs) {
    const btn = doc.createElement("button") as HTMLElement;
    btn.textContent = s.label;
    const isActive = _tagSub === s.mode;
    btn.setAttribute("style", css.subTabBtn(isActive));
    btn.addEventListener("click", () => {
      if (_tagSub === s.mode) return;
      _tagSub = s.mode;
      buildSubTabBar(doc, bar, win);
      renderTagSubBody(win);
    });
    bar.appendChild(btn);
  }
}

function renderTagSubBody(win: Window): void {
  const doc = win.document;
  const subBody = $(doc, "zotero-ai-tag-subbody");
  if (!subBody) return;
  subBody.innerHTML = "";

  _selectedTags = new Set();
  _tagTargetItems = [];

  if (_tagSub === "categorize") {
    renderCategorizeSection(win, subBody);
  } else {
    renderSearchTagSection(win, subBody);
  }
}

// ── Sub-section 1: Categorize Library ────────────────────────────

function renderCategorizeSection(win: Window, container: HTMLElement): void {
  const doc = win.document;

  const instrArea = doc.createElement("div") as HTMLElement;
  instrArea.setAttribute("style", css.instrArea);
  instrArea.innerHTML =
    `<span style="font-size:11px; color:rgba(0,0,0,0.45);">` +
    `AI will analyze <strong>all papers</strong> in your library, group similar ones together, and suggest category tags. ` +
    `Select the tags you want, then apply them to all papers in that group.</span>`;

  const actionRow = doc.createElement("div") as HTMLElement;
  actionRow.setAttribute(
    "style",
    "padding:10px 14px; display:flex; gap:8px; flex-shrink:0;",
  );

  const categorizeBtn = doc.createElement("button") as HTMLElement;
  categorizeBtn.id = "zotero-ai-categorize-btn";
  categorizeBtn.textContent = "Categorize My Library";
  categorizeBtn.setAttribute("style", css.primaryBtn);
  categorizeBtn.addEventListener("click", () => void doCategorize(win));

  actionRow.appendChild(categorizeBtn);

  const resultsArea = doc.createElement("div") as HTMLElement;
  resultsArea.id = "zotero-ai-categorize-results";
  resultsArea.setAttribute("style", "flex:1; overflow-y:auto; padding:0;");

  const placeholder = doc.createElement("div") as HTMLElement;
  placeholder.setAttribute(
    "style",
    "text-align:center; padding:50px 0; color:rgba(0,0,0,0.25); font-size:12px;",
  );
  placeholder.textContent =
    'Click "Categorize My Library" to group your papers by similarity.';
  resultsArea.appendChild(placeholder);

  container.appendChild(instrArea);
  container.appendChild(actionRow);
  container.appendChild(resultsArea);
}

async function doCategorize(win: Window): Promise<void> {
  if (_busy) return;

  const doc = win.document;
  const status = $(doc, "zotero-ai-tools-status");
  const results = $(doc, "zotero-ai-categorize-results");
  const btn = $(doc, "zotero-ai-categorize-btn");
  if (!results) return;

  const running = await OllamaAPI.isRunning().catch(() => false);
  if (!running) {
    if (status) {
      status.textContent = "Ollama is not running. Start Ollama first.";
      status.style.color = "#c33";
    }
    return;
  }

  _busy = true;
  if (btn) {
    btn.textContent = "Analyzing...";
    (btn as any).disabled = true;
    btn.style.opacity = "0.5";
  }
  if (status) {
    status.textContent = "Loading library papers...";
    status.style.color = "rgba(0,0,0,0.45)";
  }

  results.innerHTML = "";
  const loadEl = doc.createElement("div") as HTMLElement;
  loadEl.setAttribute(
    "style",
    "text-align:center; padding:40px 0; color:rgba(0,0,0,0.4); font-size:12px;",
  );
  loadEl.innerHTML = `<span style="${css.spinner}"></span> Loading and categorizing your library...`;
  results.appendChild(loadEl);

  try {
    const allPapers = await LibTools.getAllLibraryItems();
    if (allPapers.length === 0) {
      results.innerHTML = "";
      const noItems = doc.createElement("div") as HTMLElement;
      noItems.setAttribute(
        "style",
        "text-align:center; padding:40px 0; color:rgba(0,0,0,0.35); font-size:12px;",
      );
      noItems.textContent = "No papers found in your library.";
      results.appendChild(noItems);
      if (status) status.textContent = "No papers found.";
      return;
    }

    if (status)
      status.textContent = `Found ${allPapers.length} paper(s). AI is categorizing...`;

    const categories = await LibTools.categorizePapers(allPapers);

    results.innerHTML = "";

    if (categories.length === 0) {
      const noCategories = doc.createElement("div") as HTMLElement;
      noCategories.setAttribute(
        "style",
        "text-align:center; padding:40px 0; color:rgba(0,0,0,0.35); font-size:12px;",
      );
      noCategories.textContent = "Could not categorize papers. Try again.";
      results.appendChild(noCategories);
      if (status) status.textContent = "Categorization produced no groups.";
      return;
    }

    for (const cat of categories) {
      const group = doc.createElement("div") as HTMLElement;
      group.setAttribute("style", css.categoryGroup);

      // Category header with tag chip + apply button
      const headerRow = doc.createElement("div") as HTMLElement;
      headerRow.setAttribute(
        "style",
        "display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;",
      );

      const catLabel = doc.createElement("div") as HTMLElement;
      catLabel.setAttribute(
        "style",
        "display:flex; align-items:center; gap:8px;",
      );

      const catChip = doc.createElement("span") as HTMLElement;
      catChip.textContent = cat.category;
      catChip.setAttribute("style", css.categoryChip);

      const countLabel = doc.createElement("span") as HTMLElement;
      countLabel.textContent = `${cat.papers.length} paper(s)`;
      countLabel.setAttribute(
        "style",
        "font-size:11px; color:rgba(0,0,0,0.4);",
      );

      catLabel.appendChild(catChip);
      catLabel.appendChild(countLabel);

      const applyBtn = doc.createElement("button") as HTMLElement;
      applyBtn.textContent = `Apply "${cat.category}" tag`;
      applyBtn.setAttribute("style", css.smallPrimaryBtn);
      applyBtn.addEventListener("click", async () => {
        applyBtn.textContent = "Applying...";
        (applyBtn as any).disabled = true;
        applyBtn.style.opacity = "0.5";
        try {
          for (const p of cat.papers) {
            await LibTools.applyTags(p.item, [cat.category]);
          }
          applyBtn.textContent = "\u2713 Applied!";
          applyBtn.style.background = "#43a047";
          applyBtn.style.borderColor = "#43a047";
        } catch (e: any) {
          applyBtn.textContent = `Error: ${String(e).slice(0, 30)}`;
          applyBtn.style.background = "#e53935";
        }
      });

      headerRow.appendChild(catLabel);
      headerRow.appendChild(applyBtn);
      group.appendChild(headerRow);

      // Paper list
      for (const p of cat.papers) {
        const row = doc.createElement("div") as HTMLElement;
        row.setAttribute("style", css.catPaperRow);
        const bullet = doc.createElement("span") as HTMLElement;
        bullet.textContent = "\u2022";
        bullet.setAttribute("style", "color:#4a90d9; flex-shrink:0;");
        const info = doc.createElement("span") as HTMLElement;
        info.textContent = `${p.title}${p.authors ? ` \u2014 ${p.authors}` : ""}${p.year ? ` (${p.year})` : ""}`;
        info.setAttribute(
          "style",
          "overflow:hidden; text-overflow:ellipsis; white-space:nowrap;",
        );
        row.appendChild(bullet);
        row.appendChild(info);
        group.appendChild(row);
      }

      results.appendChild(group);
    }

    if (status) {
      status.textContent = `${categories.length} categories found across ${allPapers.length} paper(s).`;
      status.style.color = "rgba(0,0,0,0.45)";
    }
  } catch (e: any) {
    results.innerHTML = "";
    const errEl = doc.createElement("div") as HTMLElement;
    errEl.setAttribute(
      "style",
      "text-align:center; padding:20px 0; color:#c33; font-size:12px;",
    );
    errEl.textContent = `Error: ${String(e)}`;
    results.appendChild(errEl);
    if (status) {
      status.textContent = "Categorization failed.";
      status.style.color = "#c33";
    }
  } finally {
    _busy = false;
    if (btn) {
      btn.textContent = "Categorize My Library";
      (btn as any).disabled = false;
      btn.style.opacity = "1";
    }
  }
}

// ── Sub-section 2: Search & Tag ──────────────────────────────────

function renderSearchTagSection(win: Window, container: HTMLElement): void {
  const doc = win.document;

  const instrArea = doc.createElement("div") as HTMLElement;
  instrArea.setAttribute("style", css.instrArea);
  instrArea.innerHTML =
    `<span style="font-size:11px; color:rgba(0,0,0,0.45);">` +
    `Search for papers, then <strong>Suggest Tags</strong> for the results. ` +
    `Select the tags you want and apply them to all found papers.</span>`;

  // Search row
  const searchRow = doc.createElement("div") as HTMLElement;
  searchRow.setAttribute("style", css.searchRow);

  const searchLabel = doc.createElement("label") as HTMLElement;
  searchLabel.textContent = "Find:";
  searchLabel.setAttribute("style", css.fieldLabel);

  const searchInput = doc.createElement("input") as HTMLInputElement;
  searchInput.id = "zotero-ai-tag-search-input";
  searchInput.setAttribute("style", css.searchInput);
  searchInput.setAttribute("placeholder", "Search papers to tag...");
  searchInput.addEventListener("keydown", (ev: any) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void doTagSearch(win);
    }
  });

  const searchBtn = doc.createElement("button") as HTMLElement;
  searchBtn.textContent = "Find";
  searchBtn.setAttribute("style", css.searchBtn);
  searchBtn.addEventListener("click", () => void doTagSearch(win));

  searchRow.appendChild(searchLabel);
  searchRow.appendChild(searchInput);
  searchRow.appendChild(searchBtn);

  // Results area (paper list + tag chips)
  const resultsWrap = doc.createElement("div") as HTMLElement;
  resultsWrap.id = "zotero-ai-tag-search-results";
  resultsWrap.setAttribute("style", "flex:1; overflow-y:auto; padding:0;");

  const placeholder = doc.createElement("div") as HTMLElement;
  placeholder.setAttribute(
    "style",
    "text-align:center; padding:50px 0; color:rgba(0,0,0,0.25); font-size:12px;",
  );
  placeholder.textContent =
    "Search for papers to see them here, then suggest tags.";
  resultsWrap.appendChild(placeholder);

  // Tag chips area (hidden until suggested)
  const tagsSection = doc.createElement("div") as HTMLElement;
  tagsSection.id = "zotero-ai-tag-search-tags";
  tagsSection.setAttribute("style", "padding:0; flex-shrink:0; display:none;");

  // Apply row (hidden until tags exist)
  const applyRow = doc.createElement("div") as HTMLElement;
  applyRow.id = "zotero-ai-tag-apply-row";
  applyRow.setAttribute("style", css.applyRow + ";display:none;");

  const selectInfo = doc.createElement("span") as HTMLElement;
  selectInfo.id = "zotero-ai-tag-select-info";
  selectInfo.setAttribute("style", "font-size:11px; color:rgba(0,0,0,0.45);");
  selectInfo.textContent = "Click tags to select/deselect";

  const applyBtn = doc.createElement("button") as HTMLElement;
  applyBtn.id = "zotero-ai-tag-apply-btn";
  applyBtn.textContent = "Apply Selected Tags";
  applyBtn.setAttribute("style", css.primaryBtn);
  applyBtn.addEventListener("click", () => void doApplyTags(win));

  applyRow.appendChild(selectInfo);
  applyRow.appendChild(applyBtn);

  container.appendChild(instrArea);
  container.appendChild(searchRow);
  container.appendChild(resultsWrap);
  container.appendChild(tagsSection);
  container.appendChild(applyRow);

  searchInput.focus();
}

async function doTagSearch(win: Window): Promise<void> {
  if (_busy) return;

  const doc = win.document;
  const input = $(doc, "zotero-ai-tag-search-input") as HTMLInputElement | null;
  const resultsWrap = $(doc, "zotero-ai-tag-search-results");
  const tagsSection = $(doc, "zotero-ai-tag-search-tags");
  const applyRow = $(doc, "zotero-ai-tag-apply-row");
  const status = $(doc, "zotero-ai-tools-status");
  if (!input || !resultsWrap) return;

  const query = input.value.trim();
  if (!query) return;

  _busy = true;
  _tagTargetItems = [];
  _selectedTags = new Set();
  if (tagsSection) tagsSection.style.display = "none";
  if (applyRow) applyRow.style.display = "none";
  if (status) {
    status.textContent = "Searching...";
    status.style.color = "rgba(0,0,0,0.45)";
  }

  resultsWrap.innerHTML = "";
  const loadEl = doc.createElement("div") as HTMLElement;
  loadEl.setAttribute(
    "style",
    "text-align:center; padding:30px 0; color:rgba(0,0,0,0.4); font-size:12px;",
  );
  loadEl.innerHTML = `<span style="${css.spinner}"></span> Searching your library...`;
  resultsWrap.appendChild(loadEl);

  try {
    const results = await LibTools.searchLibrary(query, 15);

    resultsWrap.innerHTML = "";
    if (results.length === 0) {
      const emptyEl = doc.createElement("div") as HTMLElement;
      emptyEl.setAttribute(
        "style",
        "text-align:center; padding:40px 0; color:rgba(0,0,0,0.3); font-size:12px;",
      );
      emptyEl.textContent = "No papers found matching your query.";
      resultsWrap.appendChild(emptyEl);
      if (status) status.textContent = "No results.";
      _busy = false;
      return;
    }

    _tagTargetItems = results.map((r) => r.item);

    // Header
    const header = doc.createElement("div") as HTMLElement;
    header.setAttribute(
      "style",
      "padding:10px 14px 6px; font-size:11px; font-weight:600; color:var(--fill-primary,#555);",
    );
    header.textContent = `${results.length} paper(s) found \u2014 these will be tagged:`;
    resultsWrap.appendChild(header);

    // Paper list as a compact table
    const table = doc.createElement("table") as HTMLElement;
    table.setAttribute(
      "style",
      css.table + "; margin:0 10px; width:calc(100% - 20px);",
    );

    const thead = doc.createElement("thead") as HTMLElement;
    const headRow = doc.createElement("tr") as HTMLElement;
    for (const col of ["#", "Title", "Authors", "Year"]) {
      const th = doc.createElement("th") as HTMLElement;
      th.textContent = col;
      th.setAttribute("style", css.th);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = doc.createElement("tbody") as HTMLElement;
    for (const [i, r] of results.entries()) {
      const tr = doc.createElement("tr") as HTMLElement;
      tr.setAttribute("style", css.tr);
      tr.addEventListener("mouseenter", () => {
        tr.style.background = "rgba(74,144,217,0.06)";
      });
      tr.addEventListener("mouseleave", () => {
        tr.style.background = "transparent";
      });

      const cells = [
        [String(i + 1), ""],
        [
          r.title || "Untitled",
          "font-weight:500; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;",
        ],
        [
          r.authors || "\u2014",
          "max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;",
        ],
        [r.year || "\u2014", ""],
      ];
      for (const [text, extra] of cells) {
        const td = doc.createElement("td") as HTMLElement;
        td.setAttribute("style", css.td + (extra ? "; " + extra : ""));
        td.textContent = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    resultsWrap.appendChild(table);

    // Suggest tags button below the results
    const suggestRow = doc.createElement("div") as HTMLElement;
    suggestRow.setAttribute(
      "style",
      "padding:10px 14px; display:flex; gap:8px; flex-shrink:0;",
    );

    const suggestBtn = doc.createElement("button") as HTMLElement;
    suggestBtn.id = "zotero-ai-tag-suggest-btn";
    suggestBtn.textContent = "Suggest Tags for These Papers";
    suggestBtn.setAttribute("style", css.primaryBtn);
    suggestBtn.addEventListener("click", () => void doSuggestTags(win));

    suggestRow.appendChild(suggestBtn);
    resultsWrap.appendChild(suggestRow);

    if (status) {
      status.textContent = `${results.length} paper(s) found. Click "Suggest Tags" to generate tags.`;
      status.style.color = "rgba(0,0,0,0.45)";
    }
  } catch (e: any) {
    resultsWrap.innerHTML = "";
    const errEl = doc.createElement("div") as HTMLElement;
    errEl.setAttribute(
      "style",
      "text-align:center; padding:20px 0; color:#c33; font-size:12px;",
    );
    errEl.textContent = `Error: ${String(e)}`;
    resultsWrap.appendChild(errEl);
    if (status) {
      status.textContent = "Search failed.";
      status.style.color = "#c33";
    }
  } finally {
    _busy = false;
  }
}

// ── Suggest tags (shared for search-tag mode) ────────────────────

async function doSuggestTags(win: Window): Promise<void> {
  if (_busy) return;
  if (_tagTargetItems.length === 0) return;

  const doc = win.document;
  const status = $(doc, "zotero-ai-tools-status");
  const tagsSection = $(doc, "zotero-ai-tag-search-tags");
  const applyRow = $(doc, "zotero-ai-tag-apply-row");
  const suggestBtn = $(doc, "zotero-ai-tag-suggest-btn");
  if (!tagsSection) return;

  const running = await OllamaAPI.isRunning().catch(() => false);
  if (!running) {
    if (status) {
      status.textContent = "Ollama is not running. Start Ollama first.";
      status.style.color = "#c33";
    }
    return;
  }

  _busy = true;
  _selectedTags = new Set();
  if (suggestBtn) {
    suggestBtn.textContent = "Generating...";
    (suggestBtn as any).disabled = true;
    suggestBtn.style.opacity = "0.5";
  }
  if (status) {
    status.textContent = "Analyzing paper(s) and generating tags...";
    status.style.color = "rgba(0,0,0,0.45)";
  }

  tagsSection.style.display = "block";
  tagsSection.innerHTML = "";
  const loadingEl = doc.createElement("div") as HTMLElement;
  loadingEl.setAttribute(
    "style",
    "text-align:center; padding:20px 0; color:rgba(0,0,0,0.4); font-size:12px;",
  );
  loadingEl.innerHTML = `<span style="${css.spinner}"></span> AI is analyzing your paper(s)...`;
  tagsSection.appendChild(loadingEl);

  if (applyRow) applyRow.style.display = "none";

  try {
    const allTags: string[] = [];

    for (const item of _tagTargetItems) {
      const title = item.getField?.("title") || "Untitled";
      if (status) status.textContent = `Analyzing "${title}"...`;
      const tags = await LibTools.suggestTags(item);
      allTags.push(...tags);
    }

    const uniqueTags = [...new Set(allTags)];

    tagsSection.innerHTML = "";
    if (uniqueTags.length === 0) {
      const noTags = doc.createElement("div") as HTMLElement;
      noTags.setAttribute(
        "style",
        "text-align:center; padding:20px 0; color:rgba(0,0,0,0.35); font-size:12px;",
      );
      noTags.textContent = "No tags suggested. Try with different papers.";
      tagsSection.appendChild(noTags);
      if (status) status.textContent = "No tags suggested.";
    } else {
      const wrapper = doc.createElement("div") as HTMLElement;
      wrapper.setAttribute("style", "padding:10px 14px;");

      const header = doc.createElement("div") as HTMLElement;
      header.setAttribute(
        "style",
        "font-size:11px; font-weight:600; color:var(--fill-primary,#555); margin-bottom:8px;",
      );
      header.textContent = `${uniqueTags.length} tag(s) suggested \u2014 click to select:`;
      wrapper.appendChild(header);

      const chipContainer = doc.createElement("div") as HTMLElement;
      chipContainer.setAttribute(
        "style",
        "display:flex; flex-wrap:wrap; gap:6px;",
      );

      for (const tag of uniqueTags) {
        const chip = doc.createElement("button") as HTMLElement;
        chip.textContent = tag;
        chip.setAttribute("style", css.tagChip(false));
        chip.addEventListener("click", () => {
          if (_selectedTags.has(tag)) {
            _selectedTags.delete(tag);
            chip.setAttribute("style", css.tagChip(false));
          } else {
            _selectedTags.add(tag);
            chip.setAttribute("style", css.tagChip(true));
          }
          updateSelectInfo(doc);
        });
        chipContainer.appendChild(chip);
      }
      wrapper.appendChild(chipContainer);

      const bulkRow = doc.createElement("div") as HTMLElement;
      bulkRow.setAttribute("style", "margin-top:8px; display:flex; gap:10px;");

      const selectAllBtn = doc.createElement("button") as HTMLElement;
      selectAllBtn.textContent = "Select All";
      selectAllBtn.setAttribute("style", css.linkBtn);
      selectAllBtn.addEventListener("click", () => {
        _selectedTags = new Set(uniqueTags);
        for (const c of chipContainer.children) {
          (c as HTMLElement).setAttribute("style", css.tagChip(true));
        }
        updateSelectInfo(doc);
      });

      const deselectAllBtn = doc.createElement("button") as HTMLElement;
      deselectAllBtn.textContent = "Deselect All";
      deselectAllBtn.setAttribute("style", css.linkBtn);
      deselectAllBtn.addEventListener("click", () => {
        _selectedTags.clear();
        for (const c of chipContainer.children) {
          (c as HTMLElement).setAttribute("style", css.tagChip(false));
        }
        updateSelectInfo(doc);
      });

      bulkRow.appendChild(selectAllBtn);
      bulkRow.appendChild(deselectAllBtn);
      wrapper.appendChild(bulkRow);

      tagsSection.appendChild(wrapper);

      if (applyRow) applyRow.style.display = "flex";
      updateSelectInfo(doc);

      if (status) {
        status.textContent = `${uniqueTags.length} tag(s) suggested. Select and apply.`;
        status.style.color = "rgba(0,0,0,0.45)";
      }
    }
  } catch (e: any) {
    tagsSection.innerHTML = "";
    const errEl = doc.createElement("div") as HTMLElement;
    errEl.setAttribute(
      "style",
      "text-align:center; padding:14px 0; color:#c33; font-size:12px;",
    );
    errEl.textContent = `Error: ${String(e)}`;
    tagsSection.appendChild(errEl);
    if (status) {
      status.textContent = "Tag generation failed.";
      status.style.color = "#c33";
    }
  } finally {
    _busy = false;
    if (suggestBtn) {
      suggestBtn.textContent = "Suggest Tags for These Papers";
      (suggestBtn as any).disabled = false;
      suggestBtn.style.opacity = "1";
    }
  }
}

function updateSelectInfo(doc: Document): void {
  const info = $(doc, "zotero-ai-tag-select-info");
  const applyBtn = $(doc, "zotero-ai-tag-apply-btn");
  if (info) info.textContent = `${_selectedTags.size} tag(s) selected`;
  if (applyBtn) {
    if (_selectedTags.size === 0) {
      (applyBtn as any).disabled = true;
      applyBtn.style.opacity = "0.5";
      applyBtn.style.cursor = "not-allowed";
    } else {
      (applyBtn as any).disabled = false;
      applyBtn.style.opacity = "1";
      applyBtn.style.cursor = "pointer";
    }
  }
}

// ── Apply tags ───────────────────────────────────────────────────

async function doApplyTags(win: Window): Promise<void> {
  if (_selectedTags.size === 0 || _tagTargetItems.length === 0) return;

  const doc = win.document;
  const applyBtn = $(doc, "zotero-ai-tag-apply-btn");
  const status = $(doc, "zotero-ai-tools-status");
  const tags = [..._selectedTags];

  if (applyBtn) {
    applyBtn.textContent = "Applying...";
    (applyBtn as any).disabled = true;
    applyBtn.style.opacity = "0.5";
  }

  try {
    for (const item of _tagTargetItems) {
      await LibTools.applyTags(item, tags);
    }

    if (applyBtn) {
      applyBtn.textContent = "\u2713 Applied!";
      applyBtn.style.background = "#43a047";
      applyBtn.style.borderColor = "#43a047";
    }
    if (status) {
      status.textContent = `Applied ${tags.length} tag(s) to ${_tagTargetItems.length} paper(s).`;
      status.style.color = "#43a047";
    }

    setTimeout(() => {
      if (applyBtn) {
        applyBtn.textContent = "Apply Selected Tags";
        applyBtn.style.background = "#4a90d9";
        applyBtn.style.borderColor = "#4a90d9";
        (applyBtn as any).disabled = false;
        applyBtn.style.opacity = "1";
      }
    }, 2000);
  } catch (e: any) {
    if (applyBtn) {
      applyBtn.textContent = "Apply Selected Tags";
      (applyBtn as any).disabled = false;
      applyBtn.style.opacity = "1";
    }
    if (status) {
      status.textContent = `Error applying tags: ${String(e)}`;
      status.style.color = "#c33";
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  COMPARE MODE
// ═══════════════════════════════════════════════════════════════════

let _allCompareItems: {
  item: any;
  title: string;
  authors: string;
  year: string;
}[] = [];
let _compareChecked: Set<number> = new Set();
let _compareRowEls: { row: HTMLElement; toggleEl: HTMLElement; idx: number }[] =
  [];

function renderCompareBody(win: Window, body: HTMLElement): void {
  const doc = win.document;
  _compareItems = [];
  _compareChecked = new Set();
  _compareRowEls = [];

  const instrArea = doc.createElement("div") as HTMLElement;
  instrArea.setAttribute("style", css.instrArea);
  instrArea.innerHTML =
    `<span style="font-size:11px; color:rgba(0,0,0,0.45);">` +
    `Click rows to select <strong>2 or more papers</strong>, then click <strong>Compare Selected</strong>. ` +
    `Use the filter box to find papers by title.</span>`;

  // Filter row
  const filterRow = doc.createElement("div") as HTMLElement;
  filterRow.setAttribute("style", css.searchRow);

  const filterLabel = doc.createElement("label") as HTMLElement;
  filterLabel.textContent = "Filter:";
  filterLabel.setAttribute("style", css.fieldLabel);

  const filterInput = doc.createElement("input") as HTMLInputElement;
  filterInput.id = "zotero-ai-compare-filter";
  filterInput.setAttribute("style", css.searchInput);
  filterInput.setAttribute("placeholder", "Type to filter papers by title...");
  filterInput.addEventListener("input", () => {
    filterCompareList(filterInput.value);
  });

  filterRow.appendChild(filterLabel);
  filterRow.appendChild(filterInput);

  // Action row
  const actionRow = doc.createElement("div") as HTMLElement;
  actionRow.setAttribute(
    "style",
    "padding:6px 14px; display:flex; gap:8px; align-items:center; flex-shrink:0; border-bottom:1px solid rgba(0,0,0,0.08);",
  );

  const selCount = doc.createElement("span") as HTMLElement;
  selCount.id = "zotero-ai-compare-count";
  selCount.setAttribute(
    "style",
    "font-size:11px; color:rgba(0,0,0,0.45); flex:1;",
  );
  selCount.textContent = "0 selected \u2014 click rows to select";

  const deselectBtn = doc.createElement("button") as HTMLElement;
  deselectBtn.textContent = "Deselect All";
  deselectBtn.setAttribute("style", css.linkBtn);
  deselectBtn.addEventListener("click", () => {
    _compareChecked.clear();
    refreshAllCompareRows();
    updateCompareCount(doc);
  });

  const compareBtn = doc.createElement("button") as HTMLElement;
  compareBtn.id = "zotero-ai-compare-btn";
  compareBtn.textContent = "Compare Selected";
  compareBtn.setAttribute("style", css.primaryBtn);
  compareBtn.style.opacity = "0.5";
  compareBtn.setAttribute("disabled", "true");
  compareBtn.addEventListener("click", () => {
    if (_compareChecked.size < 2 || _busy) return;
    void doCompare(win);
  });

  actionRow.appendChild(selCount);
  actionRow.appendChild(deselectBtn);
  actionRow.appendChild(compareBtn);

  // Paper list (scrollable)
  const listWrap = doc.createElement("div") as HTMLElement;
  listWrap.id = "zotero-ai-compare-list";
  listWrap.setAttribute(
    "style",
    "flex:1; overflow-y:auto; border-bottom:1px solid rgba(0,0,0,0.08);",
  );

  const loadingEl = doc.createElement("div") as HTMLElement;
  loadingEl.setAttribute(
    "style",
    "text-align:center; padding:40px 0; color:rgba(0,0,0,0.4); font-size:12px;",
  );
  loadingEl.innerHTML = `<span style="${css.spinner}"></span> Loading library papers...`;
  listWrap.appendChild(loadingEl);

  // Results area
  const resultsArea = doc.createElement("div") as HTMLElement;
  resultsArea.id = "zotero-ai-compare-results";
  resultsArea.setAttribute(
    "style",
    "flex:1; overflow-y:auto; padding:0; display:none;",
  );

  body.appendChild(instrArea);
  body.appendChild(filterRow);
  body.appendChild(actionRow);
  body.appendChild(listWrap);
  body.appendChild(resultsArea);

  filterInput.focus();
  void loadCompareList(win);
}

async function loadCompareList(win: Window): Promise<void> {
  const doc = win.document;
  const listWrap = $(doc, "zotero-ai-compare-list");
  const status = $(doc, "zotero-ai-tools-status");
  if (!listWrap) return;

  try {
    const allPapers = await LibTools.getAllLibraryItems();
    _allCompareItems = allPapers.map((p) => ({
      item: p.item,
      title: p.title,
      authors: p.authors,
      year: p.year,
    }));

    if (_allCompareItems.length === 0) {
      listWrap.innerHTML = "";
      const empty = doc.createElement("div") as HTMLElement;
      empty.setAttribute(
        "style",
        "text-align:center; padding:40px 0; color:rgba(0,0,0,0.3); font-size:12px;",
      );
      empty.textContent = "No papers found in your library.";
      listWrap.appendChild(empty);
      return;
    }

    buildCompareRows(doc, listWrap);
    if (status)
      status.textContent = `${_allCompareItems.length} paper(s) in library`;
  } catch (e: any) {
    listWrap.innerHTML = "";
    const err = doc.createElement("div") as HTMLElement;
    err.setAttribute(
      "style",
      "text-align:center; padding:20px 0; color:#c33; font-size:12px;",
    );
    err.textContent = `Error loading library: ${String(e)}`;
    listWrap.appendChild(err);
  }
}

function buildCompareRows(doc: Document, listWrap: HTMLElement): void {
  listWrap.innerHTML = "";
  _compareRowEls = [];

  for (const [i, p] of _allCompareItems.entries()) {
    const row = doc.createElement("div") as HTMLElement;
    row.setAttribute("data-title-lower", p.title.toLowerCase());
    applyCompareRowStyle(row, false);

    // Toggle indicator (styled box, not a native checkbox)
    const toggleEl = doc.createElement("span") as HTMLElement;
    applyToggleStyle(toggleEl, false);

    const numEl = doc.createElement("span") as HTMLElement;
    numEl.textContent = String(i + 1);
    numEl.setAttribute(
      "style",
      "min-width:22px; color:rgba(0,0,0,0.35); font-size:11px; flex-shrink:0; text-align:right;",
    );

    const titleEl = doc.createElement("span") as HTMLElement;
    titleEl.textContent = p.title || "Untitled";
    titleEl.setAttribute(
      "style",
      "flex:1; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px;",
    );

    const authorsEl = doc.createElement("span") as HTMLElement;
    authorsEl.textContent = p.authors || "\u2014";
    authorsEl.setAttribute(
      "style",
      "max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; color:rgba(0,0,0,0.5); flex-shrink:0;",
    );

    const yearEl = doc.createElement("span") as HTMLElement;
    yearEl.textContent = p.year || "";
    yearEl.setAttribute(
      "style",
      "min-width:35px; font-size:11px; color:rgba(0,0,0,0.4); flex-shrink:0; text-align:right;",
    );

    row.appendChild(toggleEl);
    row.appendChild(numEl);
    row.appendChild(titleEl);
    row.appendChild(authorsEl);
    row.appendChild(yearEl);

    row.addEventListener("click", () => {
      toggleCompareItem(i, doc);
    });

    listWrap.appendChild(row);
    _compareRowEls.push({ row, toggleEl, idx: i });
  }
}

function toggleCompareItem(idx: number, doc: Document): void {
  if (_compareChecked.has(idx)) {
    _compareChecked.delete(idx);
  } else {
    _compareChecked.add(idx);
  }
  const entry = _compareRowEls.find((r) => r.idx === idx);
  if (entry) {
    const isOn = _compareChecked.has(idx);
    applyCompareRowStyle(entry.row, isOn);
    applyToggleStyle(entry.toggleEl, isOn);
  }
  updateCompareCount(doc);
}

function refreshAllCompareRows(): void {
  for (const entry of _compareRowEls) {
    const isOn = _compareChecked.has(entry.idx);
    applyCompareRowStyle(entry.row, isOn);
    applyToggleStyle(entry.toggleEl, isOn);
  }
}

function applyCompareRowStyle(el: HTMLElement, selected: boolean): void {
  el.setAttribute(
    "style",
    [
      "display:flex",
      "align-items:center",
      "gap:8px",
      "padding:7px 14px",
      "cursor:pointer",
      "border-bottom:1px solid rgba(0,0,0,0.05)",
      "transition:background 0.1s",
      selected ? "background:rgba(74,144,217,0.1)" : "background:transparent",
      "user-select:none",
      "-moz-user-select:none",
    ].join(";"),
  );
}

function applyToggleStyle(el: HTMLElement, selected: boolean): void {
  el.setAttribute(
    "style",
    [
      "width:16px",
      "height:16px",
      "border-radius:3px",
      "flex-shrink:0",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-size:11px",
      "font-weight:bold",
      "line-height:1",
      selected
        ? "background:#4a90d9; border:1px solid #4a90d9; color:#fff;"
        : "background:var(--material-background,#fff); border:1px solid rgba(0,0,0,0.25); color:transparent;",
    ].join(";"),
  );
  el.textContent = selected ? "\u2713" : "";
}

function filterCompareList(query: string): void {
  const lower = query.toLowerCase().trim();
  for (const entry of _compareRowEls) {
    if (!lower) {
      entry.row.style.display = "flex";
      continue;
    }
    const titleLower = entry.row.getAttribute("data-title-lower") || "";
    entry.row.style.display = titleLower.includes(lower) ? "flex" : "none";
  }
}

function updateCompareCount(doc: Document): void {
  const countEl = $(doc, "zotero-ai-compare-count");
  const compareBtn = $(doc, "zotero-ai-compare-btn");
  const n = _compareChecked.size;
  if (countEl) {
    countEl.textContent =
      n === 0
        ? "0 selected \u2014 click rows to select"
        : `${n} paper(s) selected`;
  }
  if (compareBtn) {
    if (n < 2) {
      compareBtn.setAttribute("disabled", "true");
      compareBtn.style.opacity = "0.5";
      compareBtn.style.cursor = "not-allowed";
    } else {
      compareBtn.removeAttribute("disabled");
      compareBtn.style.opacity = "1";
      compareBtn.style.cursor = "pointer";
    }
  }
}

async function doCompare(win: Window): Promise<void> {
  if (_busy) return;
  if (_compareChecked.size < 2) return;

  _compareItems = [..._compareChecked].map((idx) => _allCompareItems[idx].item);

  const doc = win.document;
  const status = $(doc, "zotero-ai-tools-status");
  const listWrap = $(doc, "zotero-ai-compare-list");
  const results = $(doc, "zotero-ai-compare-results");
  const btn = $(doc, "zotero-ai-compare-btn");
  if (!results) return;

  const running = await OllamaAPI.isRunning().catch(() => false);
  if (!running) {
    if (status) {
      status.textContent = "Ollama is not running. Start Ollama first.";
      status.style.color = "#c33";
    }
    return;
  }

  _busy = true;
  if (btn) {
    btn.textContent = "Comparing...";
    btn.setAttribute("disabled", "true");
    btn.style.opacity = "0.5";
  }
  if (status) {
    status.textContent = "Extracting paper content...";
    status.style.color = "rgba(0,0,0,0.45)";
  }

  if (listWrap) listWrap.style.display = "none";
  results.style.display = "block";
  results.innerHTML = "";
  const loadEl = doc.createElement("div") as HTMLElement;
  loadEl.setAttribute(
    "style",
    "text-align:center; padding:40px 0; color:rgba(0,0,0,0.4); font-size:12px;",
  );
  loadEl.innerHTML = `<span style="${css.spinner}"></span> Loading paper content and comparing ${_compareItems.length} papers...`;
  results.appendChild(loadEl);

  try {
    const paperContexts = await extractPaperContexts(_compareItems);
    if (paperContexts.length < 2) {
      results.innerHTML = "";
      const errEl = doc.createElement("div") as HTMLElement;
      errEl.setAttribute(
        "style",
        "text-align:center; padding:30px 0; color:#c33; font-size:12px;",
      );
      errEl.textContent = "Could not extract content from at least 2 papers.";
      results.appendChild(errEl);
      appendBackBtn(doc, results, listWrap);
      return;
    }

    if (status)
      status.textContent = `AI is comparing ${paperContexts.length} papers...`;

    results.innerHTML = "";

    const headerEl = doc.createElement("div") as HTMLElement;
    headerEl.setAttribute(
      "style",
      "padding:10px 14px 8px; font-size:11px; font-weight:600; color:var(--fill-primary,#555);",
    );
    headerEl.textContent = `Comparing ${paperContexts.length} papers:`;
    results.appendChild(headerEl);

    for (const [i, p] of paperContexts.entries()) {
      const row = doc.createElement("div") as HTMLElement;
      row.setAttribute(
        "style",
        "padding:2px 14px; font-size:11px; color:var(--fill-primary,#444);",
      );
      row.textContent = `[${i + 1}] ${p.title}${p.authors ? ` \u2014 ${p.authors}` : ""}${p.year ? ` (${p.year})` : ""}`;
      results.appendChild(row);
    }

    const divider = doc.createElement("hr") as HTMLElement;
    divider.setAttribute(
      "style",
      "border:none; border-top:1px solid rgba(0,0,0,0.08); margin:10px 14px;",
    );
    results.appendChild(divider);

    const outputEl = doc.createElement("div") as HTMLElement;
    outputEl.setAttribute("style", css.compareOutput + "; margin:0 14px 14px;");
    outputEl.textContent = "Thinking...";
    results.appendChild(outputEl);

    let firstToken = true;
    await LibTools.comparePapers(
      paperContexts.map((p) => ({
        title: p.title,
        authors: p.authors,
        year: p.year,
        abstract: p.abstract,
        text: p.text,
      })),
      (token) => {
        if (firstToken) {
          outputEl.textContent = "";
          firstToken = false;
        }
        outputEl.textContent += token;
      },
    );

    appendBackBtn(doc, results, listWrap);
    if (status) {
      status.textContent = `Compared ${paperContexts.length} papers.`;
      status.style.color = "rgba(0,0,0,0.45)";
    }
  } catch (e: any) {
    results.innerHTML = "";
    const errEl = doc.createElement("div") as HTMLElement;
    errEl.setAttribute(
      "style",
      "text-align:center; padding:20px 0; color:#c33; font-size:12px;",
    );
    errEl.textContent = `Error: ${String(e)}`;
    results.appendChild(errEl);
    appendBackBtn(doc, results, listWrap);
    if (status) {
      status.textContent = "Comparison failed.";
      status.style.color = "#c33";
    }
  } finally {
    _busy = false;
    if (btn) {
      btn.textContent = "Compare Selected";
      btn.removeAttribute("disabled");
      btn.style.opacity = "1";
    }
  }
}

function appendBackBtn(
  doc: Document,
  container: HTMLElement,
  listWrap: HTMLElement | null,
): void {
  const backBtn = doc.createElement("button") as HTMLElement;
  backBtn.textContent = "\u2190 Back to Paper List";
  backBtn.setAttribute("style", css.footerBtn + "; margin:10px 14px;");
  backBtn.addEventListener("click", () => {
    container.style.display = "none";
    container.innerHTML = "";
    if (listWrap) listWrap.style.display = "block";
  });
  container.appendChild(backBtn);
}

// ═══════════════════════════════════════════════════════════════════
//  SEARCH (main tab)
// ═══════════════════════════════════════════════════════════════════

async function doSearch(win: Window): Promise<void> {
  if (_busy) return;

  const doc = win.document;
  const input = $(doc, "zotero-ai-tools-input") as HTMLInputElement | null;
  const tbody = $(doc, "zotero-ai-tools-tbody");
  const answerArea = $(doc, "zotero-ai-tools-answer");
  const status = $(doc, "zotero-ai-tools-status");
  if (!input || !tbody) return;

  const query = input.value.trim();
  if (!query) return;

  const running = await OllamaAPI.isRunning().catch(() => false);
  if (!running) {
    if (status) {
      status.textContent = "Ollama is not running. Start Ollama first.";
      status.style.color = "#c33";
    }
    return;
  }

  _busy = true;
  if (status) {
    status.textContent = "Searching...";
    status.style.color = "rgba(0,0,0,0.45)";
  }
  tbody.innerHTML = "";

  const loadRow = doc.createElement("tr") as HTMLElement;
  const loadCell = doc.createElement("td") as HTMLElement;
  loadCell.setAttribute("colspan", "5");
  loadCell.setAttribute(
    "style",
    "text-align:center; padding:40px 0; color:rgba(0,0,0,0.4); font-size:12px;",
  );
  loadCell.innerHTML = `<span style="${css.spinner}"></span> Searching titles, authors, abstracts, and full text...`;
  loadRow.appendChild(loadCell);
  tbody.appendChild(loadRow);

  if (answerArea) {
    answerArea.style.display = "none";
    answerArea.textContent = "";
    answerArea.style.borderLeftColor = "#4a90d9";
  }

  try {
    let firstToken = true;
    const { results } = await LibTools.librarySearchWithAI(query, (token) => {
      if (!answerArea) return;
      if (firstToken) {
        answerArea.style.display = "block";
        answerArea.textContent = "";
        firstToken = false;
      }
      answerArea.textContent += token;
    });

    if (firstToken && answerArea) {
      answerArea.style.display = "block";
      answerArea.textContent = "No relevant papers found in your library.";
    }

    tbody.innerHTML = "";
    if (results.length === 0) {
      const emptyRow = doc.createElement("tr") as HTMLElement;
      const emptyCell = doc.createElement("td") as HTMLElement;
      emptyCell.setAttribute("colspan", "5");
      emptyCell.setAttribute(
        "style",
        "text-align:center; padding:40px 0; color:rgba(0,0,0,0.3); font-size:12px;",
      );
      emptyCell.textContent = "No matching papers found.";
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    } else {
      const topScore = results[0].score;

      for (const [i, r] of results.entries()) {
        const tr = doc.createElement("tr") as HTMLElement;
        tr.setAttribute("style", css.tr);
        tr.addEventListener("mouseenter", () => {
          tr.style.background = "rgba(74,144,217,0.06)";
        });
        tr.addEventListener("mouseleave", () => {
          tr.style.background = "transparent";
        });

        const pct = topScore > 0 ? Math.round((r.score / topScore) * 100) : 0;

        const cells: [string, string][] = [
          [String(i + 1), ""],
          [
            r.title || "Untitled",
            "font-weight:500; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;",
          ],
          [
            r.authors || "\u2014",
            "max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;",
          ],
          [r.year || "\u2014", ""],
          ["", ""],
        ];

        for (const [ci, [text, extra]] of cells.entries()) {
          const td = doc.createElement("td") as HTMLElement;
          td.setAttribute("style", css.td + (extra ? "; " + extra : ""));

          if (ci === 4) {
            const bar = doc.createElement("div") as HTMLElement;
            bar.setAttribute(
              "style",
              "display:flex; align-items:center; gap:6px;",
            );

            const track = doc.createElement("div") as HTMLElement;
            track.setAttribute(
              "style",
              "width:60px; height:8px; background:rgba(0,0,0,0.08); border-radius:4px; overflow:hidden;",
            );
            const fill = doc.createElement("div") as HTMLElement;
            const color =
              pct > 70 ? "#43a047" : pct > 40 ? "#fb8c00" : "#e53935";
            fill.setAttribute(
              "style",
              `height:100%; width:${pct}%; background:${color}; border-radius:4px;`,
            );
            track.appendChild(fill);

            const label = doc.createElement("span") as HTMLElement;
            label.textContent = `${pct}%`;
            label.setAttribute(
              "style",
              "font-size:10px; color:rgba(0,0,0,0.4); min-width:28px;",
            );

            bar.appendChild(track);
            bar.appendChild(label);
            td.appendChild(bar);
          } else {
            td.textContent = text;
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }

    if (status) {
      status.textContent = `${results.length} result(s) found`;
      status.style.color = "rgba(0,0,0,0.45)";
    }
  } catch (e: any) {
    tbody.innerHTML = "";
    const errRow = doc.createElement("tr") as HTMLElement;
    const errCell = doc.createElement("td") as HTMLElement;
    errCell.setAttribute("colspan", "5");
    errCell.setAttribute(
      "style",
      "text-align:center; padding:30px 0; color:#c33; font-size:12px;",
    );
    errCell.textContent = `Error: ${String(e)}`;
    errRow.appendChild(errCell);
    tbody.appendChild(errRow);

    if (answerArea) {
      answerArea.style.display = "block";
      answerArea.textContent = `Error: ${String(e)}`;
      answerArea.style.borderLeftColor = "#c33";
    }
    if (status) {
      status.textContent = "Search failed";
      status.style.color = "#c33";
    }
  } finally {
    _busy = false;
    input.value = "";
    input.focus();
  }
}

// ── Get selected items helper ────────────────────────────────────

function getSelectedItems(win: Window): any[] {
  try {
    const zp = (win as any).ZoteroPane || Zotero.getActiveZoteroPane?.();
    if (!zp) return [];
    const items: any[] = zp.getSelectedItems?.() ?? [];
    return items.filter((it: any) => it.isRegularItem?.());
  } catch {
    return [];
  }
}

// ── Draggable ───────────────────────────────────────────────────

function makeDraggable(
  win: Window,
  panel: HTMLElement,
  handle: HTMLElement,
): void {
  let dragging = false;
  let sx = 0,
    sy = 0,
    ox = 0,
    oy = 0;
  handle.style.cursor = "move";

  handle.addEventListener("mousedown", (e: MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    const r = panel.getBoundingClientRect();
    ox = r.left;
    oy = r.top;
    e.preventDefault();
  });
  win.addEventListener("mousemove", (e: MouseEvent) => {
    if (!dragging) return;
    let nl = ox + (e.clientX - sx);
    let nt = oy + (e.clientY - sy);
    nl = Math.max(0, Math.min(nl, win.innerWidth - panel.offsetWidth));
    nt = Math.max(0, Math.min(nt, win.innerHeight - panel.offsetHeight));
    panel.style.left = nl + "px";
    panel.style.top = nt + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
  });
  win.addEventListener("mouseup", () => {
    dragging = false;
  });
}

// ── Inject keyframes ────────────────────────────────────────────

function injectStyles(doc: Document): void {
  if ($(doc, "zotero-ai-tools-style")) return;
  const el = doc.createElement("style") as HTMLElement;
  el.id = "zotero-ai-tools-style";
  el.textContent =
    "@keyframes zotero-ai-spin { to { transform: rotate(360deg); } }";
  doc.head?.appendChild(el);
}

// ── CSS ─────────────────────────────────────────────────────────

const css = {
  overlay: [
    "position:fixed",
    "inset:0",
    "background:rgba(0,0,0,0.3)",
    "z-index:1000000",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial",
  ].join(";"),

  dialog: [
    "width:740px",
    "max-width:92vw",
    "max-height:84vh",
    "background:var(--material-background,#fff)",
    "border:1px solid rgba(0,0,0,0.25)",
    "border-radius:8px",
    "box-shadow:0 8px 40px rgba(0,0,0,0.22)",
    "display:flex",
    "flex-direction:column",
    "overflow:hidden",
    "color:var(--fill-primary,#333)",
    "font-size:12px",
    "position:fixed",
    "left:50%",
    "top:50%",
    "transform:translate(-50%,-50%)",
  ].join(";"),

  titleBar: [
    "display:flex",
    "align-items:center",
    "padding:6px 10px",
    "background:var(--material-toolbar,#f0f0f0)",
    "border-bottom:1px solid rgba(0,0,0,0.12)",
    "user-select:none",
    "-moz-user-select:none",
    "flex-shrink:0",
  ].join(";"),

  tabBar: [
    "display:flex",
    "padding:0 10px",
    "background:var(--material-toolbar,#f0f0f0)",
    "border-bottom:1px solid rgba(0,0,0,0.12)",
    "flex-shrink:0",
    "gap:0",
  ].join(";"),

  tabBtn: (active: boolean) =>
    [
      "padding:8px 18px",
      "border:none",
      "border-bottom:2px solid " + (active ? "#4a90d9" : "transparent"),
      "background:transparent",
      "font-size:12px",
      "font-weight:" + (active ? "600" : "400"),
      "color:" + (active ? "#4a90d9" : "var(--fill-primary,#555)"),
      "cursor:pointer",
      "transition:all 0.15s",
      "white-space:nowrap",
    ].join(";"),

  subTabBar: [
    "display:flex",
    "padding:0 14px",
    "gap:0",
    "border-bottom:1px solid rgba(0,0,0,0.08)",
    "flex-shrink:0",
    "background:var(--material-background,#fff)",
  ].join(";"),

  subTabBtn: (active: boolean) =>
    [
      "padding:7px 16px",
      "border:none",
      "border-bottom:2px solid " + (active ? "#e67e22" : "transparent"),
      "background:transparent",
      "font-size:11px",
      "font-weight:" + (active ? "600" : "400"),
      "color:" + (active ? "#e67e22" : "var(--fill-primary,#666)"),
      "cursor:pointer",
      "transition:all 0.15s",
      "white-space:nowrap",
    ].join(";"),

  winBtn: [
    "border:none",
    "background:transparent",
    "font-size:13px",
    "cursor:pointer",
    "padding:4px 10px",
    "line-height:1",
    "color:var(--fill-primary,#333)",
    "border-radius:2px",
  ].join(";"),

  searchRow: [
    "display:flex",
    "align-items:center",
    "padding:10px 14px",
    "gap:8px",
    "flex-shrink:0",
  ].join(";"),

  fieldLabel: [
    "font-size:12px",
    "font-weight:600",
    "color:var(--fill-primary,#333)",
    "min-width:50px",
    "flex-shrink:0",
  ].join(";"),

  searchInput: [
    "flex:1",
    "padding:6px 10px",
    "border:1px solid rgba(0,0,0,0.2)",
    "border-radius:4px",
    "font-size:12px",
    "font-family:inherit",
    "outline:none",
    "background:var(--material-background,#fff)",
    "color:var(--fill-primary,#333)",
  ].join(";"),

  searchBtn: [
    "padding:6px 16px",
    "border:1px solid rgba(0,0,0,0.2)",
    "border-radius:4px",
    "background:var(--material-toolbar,#f5f5f5)",
    "color:var(--fill-primary,#333)",
    "font-size:12px",
    "font-weight:500",
    "cursor:pointer",
    "white-space:nowrap",
  ].join(";"),

  infoRow: [
    "padding:0 14px 8px 14px",
    "border-bottom:1px solid rgba(0,0,0,0.08)",
    "flex-shrink:0",
  ].join(";"),

  instrArea: [
    "padding:10px 14px",
    "border-bottom:1px solid rgba(0,0,0,0.08)",
    "flex-shrink:0",
  ].join(";"),

  tableWrap: [
    "flex:1",
    "overflow:auto",
    "border-bottom:1px solid rgba(0,0,0,0.08)",
  ].join(";"),

  table: ["width:100%", "border-collapse:collapse", "font-size:12px"].join(";"),

  th: [
    "text-align:left",
    "padding:8px 10px",
    "font-size:11px",
    "font-weight:600",
    "color:var(--fill-primary,#555)",
    "border-bottom:2px solid rgba(0,0,0,0.1)",
    "background:var(--material-toolbar,#fafafa)",
    "position:sticky",
    "top:0",
    "white-space:nowrap",
  ].join(";"),

  td: [
    "padding:7px 10px",
    "border-bottom:1px solid rgba(0,0,0,0.06)",
    "font-size:12px",
    "vertical-align:middle",
  ].join(";"),

  tr: "transition:background 0.1s; cursor:default;",

  answerArea: [
    "margin:8px 14px",
    "padding:10px 12px",
    "background:rgba(74,144,217,0.05)",
    "border-left:3px solid #4a90d9",
    "border-radius:4px",
    "font-size:12px",
    "white-space:pre-wrap",
    "word-break:break-word",
    "color:var(--fill-primary,#333)",
    "line-height:1.5",
    "max-height:140px",
    "overflow-y:auto",
    "flex-shrink:0",
  ].join(";"),

  footer: [
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "padding:8px 14px",
    "border-top:1px solid rgba(0,0,0,0.1)",
    "flex-shrink:0",
    "background:var(--material-toolbar,#fafafa)",
  ].join(";"),

  footerBtn: [
    "padding:5px 16px",
    "border:1px solid rgba(0,0,0,0.2)",
    "border-radius:4px",
    "background:var(--material-toolbar,#f5f5f5)",
    "color:var(--fill-primary,#333)",
    "font-size:12px",
    "cursor:pointer",
  ].join(";"),

  primaryBtn: [
    "padding:6px 20px",
    "border:1px solid #4a90d9",
    "border-radius:4px",
    "background:#4a90d9",
    "color:#fff",
    "font-size:12px",
    "font-weight:600",
    "cursor:pointer",
    "white-space:nowrap",
  ].join(";"),

  smallPrimaryBtn: [
    "padding:4px 12px",
    "border:1px solid #4a90d9",
    "border-radius:4px",
    "background:#4a90d9",
    "color:#fff",
    "font-size:11px",
    "font-weight:500",
    "cursor:pointer",
    "white-space:nowrap",
  ].join(";"),

  categoryGroup: [
    "margin:8px 14px",
    "padding:12px",
    "background:rgba(0,0,0,0.02)",
    "border:1px solid rgba(0,0,0,0.08)",
    "border-radius:6px",
  ].join(";"),

  categoryChip: [
    "padding:4px 12px",
    "background:#e67e22",
    "color:#fff",
    "border-radius:12px",
    "font-size:12px",
    "font-weight:600",
  ].join(";"),

  catPaperRow: [
    "padding:3px 0",
    "font-size:11px",
    "color:var(--fill-primary,#444)",
    "display:flex",
    "gap:6px",
    "align-items:baseline",
  ].join(";"),

  compareOutput: [
    "padding:12px 14px",
    "background:rgba(74,144,217,0.04)",
    "border-left:3px solid #4a90d9",
    "border-radius:4px",
    "font-size:12px",
    "white-space:pre-wrap",
    "word-break:break-word",
    "color:var(--fill-primary,#333)",
    "line-height:1.6",
  ].join(";"),

  tagChipsArea: [
    "flex:1",
    "padding:12px 14px",
    "overflow-y:auto",
    "min-height:100px",
  ].join(";"),

  tagChip: (selected: boolean) =>
    [
      "padding:5px 14px",
      "border:1px solid " + (selected ? "#4a90d9" : "rgba(0,0,0,0.18)"),
      "border-radius:16px",
      "background:" +
        (selected ? "#4a90d9" : "var(--material-background,#fff)"),
      "color:" + (selected ? "#fff" : "var(--fill-primary,#333)"),
      "font-size:12px",
      "cursor:pointer",
      "transition:all 0.15s",
      "font-family:inherit",
      "line-height:1.3",
    ].join(";"),

  linkBtn: [
    "border:none",
    "background:transparent",
    "color:#4a90d9",
    "font-size:11px",
    "cursor:pointer",
    "padding:2px 4px",
    "text-decoration:underline",
  ].join(";"),

  applyRow: [
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "padding:10px 14px",
    "border-top:1px solid rgba(0,0,0,0.08)",
    "flex-shrink:0",
  ].join(";"),

  spinner: [
    "display:inline-block",
    "width:12px",
    "height:12px",
    "border:2px solid rgba(0,0,0,0.1)",
    "border-top-color:#4a90d9",
    "border-radius:50%",
    "animation:zotero-ai-spin 0.6s linear infinite",
    "vertical-align:middle",
    "margin-right:4px",
  ].join(";"),
} as const;

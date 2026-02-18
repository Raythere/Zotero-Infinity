import type { PaperContext } from "./pdf-extract";
import * as OllamaAPI from "./ollama-api";
import type { ChatMessage } from "./ollama-api";

declare const Zotero: any;

const DEFAULT_MODEL = "llama3.2:1b";
const MAX_CONTEXT_CHARS = 24000;

let _model = DEFAULT_MODEL;

export interface ChatSession {
  id: string;
  label: string;
  papers: PaperContext[];
  messages: ChatMessage[];
}

const _sessions = new Map<string, ChatSession>();
let _activeSessionId = "";

export function getModel(): string {
  return _model;
}

export function setModel(model: string): void {
  _model = model;
}

export function getActiveSession(): ChatSession | undefined {
  return _sessions.get(_activeSessionId);
}

export function getActiveSessionId(): string {
  return _activeSessionId;
}

export function getAllSessions(): ChatSession[] {
  return Array.from(_sessions.values());
}

export function getPapers(): PaperContext[] {
  return getActiveSession()?.papers || [];
}

export function getMessages(): ChatMessage[] {
  return getActiveSession()?.messages || [];
}

export function isActive(): boolean {
  return (getActiveSession()?.papers.length || 0) > 0;
}

/** Switch to a session by ID. Returns true if the session exists. */
export function switchSession(id: string): boolean {
  if (_sessions.has(id)) {
    _activeSessionId = id;
    return true;
  }
  return false;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n[... truncated, ${text.length - maxChars} characters omitted ...]`
  );
}

function buildSystemPrompt(papers: PaperContext[]): string {
  if (papers.length === 0) {
    return "You are a helpful research assistant inside Zotero. The user has not loaded any papers yet.";
  }

  const perPaperBudget = Math.floor(MAX_CONTEXT_CHARS / papers.length);

  const paperSections = papers.map((p, i) => {
    const header =
      `--- Paper ${i + 1} ---\n` +
      `Title: ${p.title}\n` +
      (p.authors ? `Authors: ${p.authors}\n` : "") +
      (p.year ? `Year: ${p.year}\n` : "") +
      (p.itemType ? `Type: ${p.itemType}\n` : "");

    const abstractSection = p.abstract ? `\nAbstract:\n${p.abstract}\n` : "";

    const headerLen = header.length + abstractSection.length;
    const textBudget = Math.max(0, perPaperBudget - headerLen);
    const textSection = p.text
      ? `\nFull Text:\n${truncateText(p.text, textBudget)}\n`
      : "\n(No full text available)\n";

    return header + abstractSection + textSection;
  });

  const intro =
    papers.length === 1
      ? "You are a helpful research assistant inside Zotero. The user is asking about the following paper. Answer questions based on its content. Be precise and cite specific parts when possible."
      : `You are a helpful research assistant inside Zotero. The user is asking about the following ${papers.length} papers. You can compare, contrast, summarize, and answer questions about them. Reference papers by their title or number.`;

  return intro + "\n\n" + paperSections.join("\n");
}

/**
 * Start a new chat session for the given papers.
 * Uses the provided sessionId to allow switching back later.
 */
export function startChat(papers: PaperContext[], sessionId?: string): void {
  const id = sessionId || `session-${Date.now()}`;
  const label =
    papers.length === 1
      ? (papers[0].title || "Untitled").slice(0, 30)
      : `${papers.length} papers`;

  const session: ChatSession = {
    id,
    label,
    papers,
    messages: [{ role: "system", content: buildSystemPrompt(papers) }],
  };

  _sessions.set(id, session);
  _activeSessionId = id;

  Zotero.debug(
    `[zotero-local-ai] Chat session "${id}" started with ${papers.length} paper(s), model=${_model}`,
  );
}

/**
 * Add more papers to the active session (for comparison).
 */
export function addPapers(papers: PaperContext[]): void {
  const session = getActiveSession();
  if (!session) return;

  session.papers.push(...papers);
  session.messages[0] = {
    role: "system",
    content: buildSystemPrompt(session.papers),
  };
  session.label =
    session.papers.length === 1
      ? (session.papers[0].title || "Untitled").slice(0, 30)
      : `${session.papers.length} papers`;

  Zotero.debug(
    `[zotero-local-ai] Added ${papers.length} paper(s) to "${session.id}", total=${session.papers.length}`,
  );
}

export async function sendMessage(
  userMsg: string,
  onToken?: (token: string) => void,
): Promise<string> {
  const session = getActiveSession();
  if (!session) throw new Error("No active chat session");

  session.messages.push({ role: "user", content: userMsg });

  try {
    const reply = await OllamaAPI.chat(_model, session.messages, onToken);
    session.messages.push({ role: "assistant", content: reply });
    return reply;
  } catch (e: any) {
    session.messages.pop();
    throw e;
  }
}

/** Close a specific session. */
export function closeSession(id: string): void {
  _sessions.delete(id);
  if (_activeSessionId === id) {
    // Switch to the most recent remaining session, or clear
    const remaining = Array.from(_sessions.keys());
    _activeSessionId =
      remaining.length > 0 ? remaining[remaining.length - 1] : "";
  }
}

/** Clear all sessions. */
export function clearChat(): void {
  _sessions.clear();
  _activeSessionId = "";
}

export function abortGeneration(): void {
  OllamaAPI.abort();
}

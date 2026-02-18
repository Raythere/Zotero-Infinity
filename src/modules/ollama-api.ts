declare const Zotero: any;

const OLLAMA_BASE = "http://127.0.0.1:11434";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

let _abortXHR: any = null;

/**
 * Make an HTTP request using Zotero.HTTP.request — the most reliable
 * way to call external services from within a Zotero plugin.
 */
async function zoteroHTTP(
  method: string,
  url: string,
  body?: string,
  timeoutMs = 5000,
): Promise<{ status: number; text: string }> {
  const options: any = {
    timeout: timeoutMs,
    responseType: "text",
    // Accept any status so we can handle it ourselves
    successCodes: false,
  };
  if (body) {
    options.body = body;
    options.headers = { "Content-Type": "application/json" };
  }
  const xhr = await Zotero.HTTP.request(method, url, options);
  return {
    status: xhr.status,
    text: xhr.responseText || "",
  };
}

/** Check whether the Ollama server is reachable. */
export async function isRunning(): Promise<boolean> {
  try {
    Zotero.debug("[zotero-local-ai] isRunning: checking " + OLLAMA_BASE);
    const resp = await zoteroHTTP("GET", OLLAMA_BASE, undefined, 3000);
    const ok = resp.status >= 200 && resp.status < 300;
    Zotero.debug(
      `[zotero-local-ai] isRunning: status=${resp.status} ok=${ok} body=${resp.text.slice(0, 100)}`,
    );
    return ok;
  } catch (e: any) {
    Zotero.debug(`[zotero-local-ai] isRunning error: ${String(e)}`);
    return false;
  }
}

/** List locally available models. */
export async function listModels(): Promise<OllamaModel[]> {
  try {
    const resp = await zoteroHTTP("GET", `${OLLAMA_BASE}/api/tags`);
    if (resp.status < 200 || resp.status >= 300) return [];
    const data = JSON.parse(resp.text);
    return (data?.models || []) as OllamaModel[];
  } catch {
    return [];
  }
}

/** Check if a specific model is available locally. */
export async function hasModel(name: string): Promise<boolean> {
  const models = await listModels();
  return models.some((m) => m.name === name || m.name.startsWith(name + ":"));
}

/**
 * Pull (download) a model.
 */
export async function pullModel(
  name: string,
  onProgress?: (status: string, completed: number, total: number) => void,
): Promise<boolean> {
  try {
    if (onProgress) onProgress("Starting pull...", 0, 0);
    const resp = await zoteroHTTP(
      "POST",
      `${OLLAMA_BASE}/api/pull`,
      JSON.stringify({ model: name, stream: false }),
      600000,
    );
    if (resp.status < 200 || resp.status >= 300) {
      Zotero.debug(`[zotero-local-ai] pullModel bad status: ${resp.status}`);
      return false;
    }
    const data = JSON.parse(resp.text);
    if (data?.error) {
      Zotero.debug(`[zotero-local-ai] pullModel error: ${data.error}`);
      return false;
    }
    if (onProgress) onProgress("Done", 100, 100);
    return true;
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] pullModel exception: ${String(e)}`);
    return false;
  }
}

/**
 * Send a chat request and stream the response token-by-token.
 * Uses XMLHttpRequest from the main window for streaming via onprogress.
 */
export async function chat(
  model: string,
  messages: ChatMessage[],
  onToken?: (token: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const win = Zotero.getMainWindow();
      const xhr = new win.XMLHttpRequest();
      _abortXHR = xhr;

      xhr.open("POST", `${OLLAMA_BASE}/api/chat`, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.timeout = 300000;
      xhr.responseType = "text";

      let lastProcessed = 0;
      let fullResponse = "";

      xhr.addEventListener("progress", () => {
        const text = xhr.responseText || "";
        const newText = text.slice(lastProcessed);
        lastProcessed = text.length;

        const lines = newText.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.error) {
              reject(new Error(obj.error));
              return;
            }
            const token = obj.message?.content || "";
            if (token) {
              fullResponse += token;
              if (onToken) onToken(token);
            }
          } catch {
            // partial JSON, skip
          }
        }
      });

      xhr.addEventListener("load", () => {
        _abortXHR = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          const text = xhr.responseText || "";
          const newText = text.slice(lastProcessed);
          const lines = newText.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              const token = obj.message?.content || "";
              if (token) {
                fullResponse += token;
                if (onToken) onToken(token);
              }
            } catch {
              // ignore
            }
          }
          resolve(fullResponse);
        } else {
          reject(
            new Error(`Ollama chat error ${xhr.status}: ${xhr.statusText}`),
          );
        }
      });

      xhr.addEventListener("error", () => {
        _abortXHR = null;
        reject(new Error("Network error connecting to Ollama"));
      });

      xhr.addEventListener("timeout", () => {
        _abortXHR = null;
        reject(new Error("Ollama request timed out"));
      });

      xhr.addEventListener("abort", () => {
        _abortXHR = null;
        reject(new DOMException("Aborted", "AbortError"));
      });

      xhr.send(JSON.stringify({ model, messages, stream: true }));
    } catch (e: any) {
      Zotero.debug(`[zotero-local-ai] chat() setup error: ${String(e)}`);
      reject(e);
    }
  });
}

/** Abort any in-flight chat request. */
export function abort(): void {
  if (_abortXHR) {
    try {
      _abortXHR.abort();
    } catch {
      // ignore
    }
    _abortXHR = null;
  }
}

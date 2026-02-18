import * as OllamaAPI from "./ollama-api";

declare const Zotero: any;
declare const Components: any;
declare const IOUtils: any;
declare const PathUtils: any;

const OLLAMA_VERSION = "0.16.2";
const DEFAULT_MODEL = "llama3.2:1b";

const DOWNLOAD_URLS: Record<string, string> = {
  win: `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-windows-amd64.zip`,
  mac: `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-darwin`,
  linux: `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-amd64.tgz`,
};

let _ollamaProcess: any = null;
let _weStartedOllama = false;

// ── Platform detection ───────────────────────────────────────────

function getPlatform(): "win" | "mac" | "linux" {
  if (Zotero.isWin) return "win";
  if (Zotero.isMac) return "mac";
  return "linux";
}

function getDataDir(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, "zotero-local-ai");
}

function getBinDir(): string {
  return PathUtils.join(getDataDir(), "bin");
}

function getOllamaPath(): string {
  const platform = getPlatform();
  if (platform === "win") return PathUtils.join(getBinDir(), "ollama.exe");
  return PathUtils.join(getBinDir(), "ollama");
}

// ── File helpers ─────────────────────────────────────────────────

async function ensureDir(path: string): Promise<void> {
  try {
    await IOUtils.makeDirectory(path, { createAncestors: true });
  } catch {
    // already exists
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await IOUtils.stat(path);
    return true;
  } catch {
    return false;
  }
}

// ── Download and extract ─────────────────────────────────────────

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  Zotero.debug(`[zotero-local-ai] Downloading ${url}`);

  const xhr = new (Zotero.getMainWindow().XMLHttpRequest)();
  xhr.open("GET", url, true);
  xhr.responseType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    xhr.onprogress = (ev: any) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = new Uint8Array(xhr.response);
          await IOUtils.write(destPath, data);
          resolve();
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send();
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const { ZipReader } = Components.Constructor(
    "@mozilla.org/libjar/zip-reader;1",
    "nsIZipReader",
    "open",
  );

  const zipFile = Components.classes["@mozilla.org/file/local;1"].createInstance(
    Components.interfaces.nsIFile,
  );
  zipFile.initWithPath(zipPath);

  const reader = new ZipReader(zipFile);

  try {
    const entries = reader.findEntries("*");
    while (entries.hasMore()) {
      const entryName = entries.getNext();
      const entry = reader.getEntry(entryName);

      const destPath = PathUtils.join(destDir, ...entryName.split("/"));

      if (entry.isDirectory) {
        await ensureDir(destPath);
      } else {
        const parentDir = PathUtils.parent(destPath);
        if (parentDir) await ensureDir(parentDir);

        const inputStream = reader.getInputStream(entryName);
        const data = readStreamToUint8(inputStream);
        await IOUtils.write(destPath, data);
      }
    }
  } finally {
    reader.close();
  }
}

function readStreamToUint8(inputStream: any): Uint8Array {
  const bis = Components.classes[
    "@mozilla.org/binaryinputstream;1"
  ].createInstance(Components.interfaces.nsIBinaryInputStream);
  bis.setInputStream(inputStream);
  const len = bis.available();
  const bytes = bis.readBytes(len);
  bis.close();
  return Uint8Array.from(bytes, (c: string) => c.charCodeAt(0));
}

async function makeExecutable(filePath: string): Promise<void> {
  if (getPlatform() === "win") return; // not needed on Windows
  try {
    const file = Components.classes["@mozilla.org/file/local;1"].createInstance(
      Components.interfaces.nsIFile,
    );
    file.initWithPath(filePath);
    file.permissions = 0o755;
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] makeExecutable error: ${String(e)}`);
  }
}

// ── Ollama lifecycle ─────────────────────────────────────────────

export async function isInstalled(): Promise<boolean> {
  return fileExists(getOllamaPath());
}

/**
 * Download and install the Ollama binary for the current platform.
 */
export async function install(
  onProgress?: (message: string, percent: number) => void,
): Promise<boolean> {
  const platform = getPlatform();
  const url = DOWNLOAD_URLS[platform];
  if (!url) {
    Zotero.debug(`[zotero-local-ai] Unsupported platform: ${platform}`);
    return false;
  }

  try {
    await ensureDir(getBinDir());

    const isZip = url.endsWith(".zip") || url.endsWith(".tgz");
    const downloadDest = isZip
      ? PathUtils.join(getDataDir(), "ollama-download.tmp")
      : getOllamaPath();

    if (onProgress) onProgress("Downloading Ollama...", 0);

    await downloadFile(url, downloadDest, (pct) => {
      if (onProgress) onProgress(`Downloading Ollama... ${pct}%`, pct);
    });

    if (url.endsWith(".zip")) {
      if (onProgress) onProgress("Extracting...", 100);
      await extractZip(downloadDest, getBinDir());
      // Clean up zip
      try {
        await IOUtils.remove(downloadDest);
      } catch { /* ignore */ }
    } else if (url.endsWith(".tgz")) {
      // For tgz, use system tar
      if (onProgress) onProgress("Extracting...", 100);
      try {
        await Zotero.Utilities.Internal.exec(
          "/bin/tar",
          ["xzf", downloadDest, "-C", getBinDir()],
        );
        await IOUtils.remove(downloadDest);
      } catch (e) {
        Zotero.debug(`[zotero-local-ai] tar extract error: ${String(e)}`);
        return false;
      }
    }

    await makeExecutable(getOllamaPath());

    const installed = await isInstalled();
    Zotero.debug(`[zotero-local-ai] Ollama installed: ${installed}`);
    return installed;
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] install error: ${String(e)}`);
    return false;
  }
}

/**
 * Start the Ollama server process.
 */
export async function startServer(): Promise<boolean> {
  // Already running externally?
  if (await OllamaAPI.isRunning()) {
    Zotero.debug("[zotero-local-ai] Ollama already running externally");
    return true;
  }

  const ollamaPath = getOllamaPath();
  if (!(await fileExists(ollamaPath))) {
    Zotero.debug("[zotero-local-ai] Ollama binary not found");
    return false;
  }

  try {
    const file = Components.classes["@mozilla.org/file/local;1"].createInstance(
      Components.interfaces.nsIFile,
    );
    file.initWithPath(ollamaPath);

    const process = Components.classes[
      "@mozilla.org/process/util;1"
    ].createInstance(Components.interfaces.nsIProcess);
    process.init(file);

    // Set custom model storage directory via environment variable
    const modelsDir = PathUtils.join(getDataDir(), "models");
    await ensureDir(modelsDir);

    const env = Components.classes["@mozilla.org/process/environment;1"]?.getService(
      Components.interfaces.nsIEnvironment,
    );
    if (env) {
      env.set("OLLAMA_MODELS", modelsDir);
    }

    // Start non-blocking
    const args = ["serve"];
    process.runAsync(args, args.length, null, false);

    _ollamaProcess = process;
    _weStartedOllama = true;

    // Wait for server to be ready
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await OllamaAPI.isRunning()) {
        Zotero.debug("[zotero-local-ai] Ollama server started");
        return true;
      }
    }

    Zotero.debug("[zotero-local-ai] Ollama server did not respond in time");
    return false;
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] startServer error: ${String(e)}`);
    return false;
  }
}

/**
 * Stop the Ollama server (only if we started it).
 */
export function stopServer(): void {
  if (!_weStartedOllama || !_ollamaProcess) return;
  try {
    _ollamaProcess.kill();
    Zotero.debug("[zotero-local-ai] Ollama server stopped");
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] stopServer error: ${String(e)}`);
  }
  _ollamaProcess = null;
  _weStartedOllama = false;
}

/**
 * Ensure the default model is available, pulling it if necessary.
 */
export async function ensureModel(
  model?: string,
  onProgress?: (message: string, percent: number) => void,
): Promise<boolean> {
  const name = model || DEFAULT_MODEL;

  if (await OllamaAPI.hasModel(name)) {
    Zotero.debug(`[zotero-local-ai] Model ${name} already available`);
    return true;
  }

  if (onProgress) onProgress(`Downloading model ${name}...`, 0);

  const ok = await OllamaAPI.pullModel(name, (status, completed, total) => {
    if (onProgress && total > 0) {
      const pct = Math.round((completed / total) * 100);
      onProgress(`${status} ${pct}%`, pct);
    } else if (onProgress) {
      onProgress(status, -1);
    }
  });

  return ok;
}

/**
 * Full initialization flow:
 * 1. Check if Ollama is running
 * 2. If not, check if installed
 * 3. If not installed, download + install
 * 4. Start server
 * 5. Ensure model is available
 */
export async function initialize(
  onProgress?: (message: string, percent: number) => void,
): Promise<boolean> {
  try {
    // Step 1: Check if already running
    if (onProgress) onProgress("Checking for Ollama...", 0);
    if (await OllamaAPI.isRunning()) {
      Zotero.debug("[zotero-local-ai] Ollama already running");
      // Ensure model
      const hasModel = await ensureModel(undefined, onProgress);
      return hasModel;
    }

    // Step 2: Check if installed
    if (!(await isInstalled())) {
      // Step 3: Install
      if (onProgress) onProgress("Installing Ollama...", 0);
      const installed = await install(onProgress);
      if (!installed) {
        if (onProgress) onProgress("Failed to install Ollama", -1);
        return false;
      }
    }

    // Step 4: Start server
    if (onProgress) onProgress("Starting Ollama server...", 0);
    const started = await startServer();
    if (!started) {
      if (onProgress) onProgress("Failed to start Ollama server", -1);
      return false;
    }

    // Step 5: Ensure model
    const hasModel = await ensureModel(undefined, onProgress);
    if (!hasModel) {
      if (onProgress) onProgress("Failed to download model", -1);
      return false;
    }

    if (onProgress) onProgress("Ready!", 100);
    return true;
  } catch (e) {
    Zotero.debug(`[zotero-local-ai] initialize error: ${String(e)}`);
    if (onProgress) onProgress(`Error: ${String(e)}`, -1);
    return false;
  }
}

# Zotero Infinity

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)

A free, privacy-first AI assistant for [Zotero](https://www.zotero.org/) that runs entirely on your computer. Chat with your papers, compare research, search your library, and auto-tag documents -- all powered by a local AI model via [Ollama](https://ollama.com/).

**No API keys. No cloud. No cost. Everything stays on your machine.**

---

## Features

- **AI Chat** -- Open any paper and ask questions about it. The AI reads the full text and answers in context.
- **Paper Comparison** -- Select multiple papers and get an AI-generated comparison of their methods, findings, and contributions.
- **Library Search** -- Deep-search your entire library by title, author, abstract, tags, or even full paper text. Results ranked by relevance.
- **Smart Tagging** -- Get AI-suggested tags for your papers, review them, and apply with one click.
- **Library Categorization** -- Let the AI group similar papers in your library and suggest organizational tags.
- **Tabbed Sessions** -- Each paper opens in its own chat tab with persistent conversation history.
- **Compact Mode** -- A small, non-distracting chat panel that auto-opens when you view a paper.

## Installation

### Option A: One-Click Installer (Windows, Recommended)

1. Download **`ZoteroInfinity-Setup.exe`** from the [latest GitHub Release](https://github.com/irbazalam/zotero-local-ai/releases/latest)
2. Run the installer
3. Open Zotero -- the AI Chat is ready to use

The installer automatically:

- Installs [Ollama](https://ollama.com/) (the local AI engine) if not already present
- Installs the Zotero plugin into your Zotero profile
- Downloads the AI model (~700 MB)

### Option B: Manual Install (All Platforms)

1. **Install Ollama** from [ollama.com/download](https://ollama.com/download)
2. Pull the AI model:
   ```bash
   ollama pull llama3.2:1b
   ```
3. Download **`zotero-local-ai.xpi`** from the [latest GitHub Release](https://github.com/irbazalam/zotero-local-ai/releases/latest)
4. In Zotero: `Tools` > `Add-ons` > gear icon > `Install Add-on From File...` > select the `.xpi`
5. Restart Zotero

## Updating

When you release a new version, users only need to update the plugin — Ollama and the model stay installed:

- **Installed via .xpi:** Zotero checks for updates automatically. Users see an update prompt in `Tools` > `Add-ons` and click Update.
- **Installed via .exe:** Users can run the new `ZoteroInfinity-Setup.exe` — it skips Ollama if already installed and overwrites the plugin. Or they can install the new `.xpi` manually.

The release workflow publishes `update.json` to a `release` tag so Zotero can fetch plugin updates.

## Usage

1. **Open a paper** in Zotero — the AI Chat panel appears automatically
2. **Ask questions** about the paper in the chat input
3. Use **Ctrl+T** to start a chat with the currently selected paper
4. Use **Ctrl+Shift+F** to open the Library Tools dialog for search, tagging, and comparison
5. The chat panel button in the toolbar toggles the panel visibility

## Requirements

- **Zotero 7** or later
- **Ollama** running locally (installed automatically with Option A)
- **~1 GB disk space** for the AI model
- **4 GB+ RAM** recommended

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Git](https://git-scm.com/)

### Development

1. **Clone and install:**

   ```bash
   git clone https://github.com/irbazalam/zotero-local-ai.git
   cd zotero-local-ai
   npm install
   ```

2. **Configure Zotero paths** (required for `npm start` to launch Zotero):
   - Copy `.env.example` to `.env`
   - Edit `.env` and set:
     - `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` — path to `Zotero.exe` (e.g. `C:\Program Files\Zotero\Zotero.exe`)
     - `ZOTERO_PLUGIN_PROFILE_PATH` — path to your Zotero profile folder (e.g. `C:\Users\YourName\AppData\Roaming\Zotero\Zotero\Profiles\xxxxx.default`)
   - To find your profile: run Zotero once, then check `%APPDATA%\Zotero\Zotero\Profiles\` on Windows.

3. **Run the plugin:**
   ```bash
   npm start
   ```
   (Use `npm start`, not `npm run` alone.) This builds the plugin, installs it as a temporary add-on, and launches Zotero. If you see "Server Ready!" but Zotero does not open, check that `.env` exists and the paths are correct.

### Production Build

```bash
npm run build
```

The `.xpi` file will be in `.scaffold/build/`.

### Building the Windows Installer

Requires [Inno Setup 6](https://jrsoftware.org/isinfo.php) installed on Windows.

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
```

The installer `.exe` will be in `installer/output/`.

## Tech Stack

- **TypeScript** + [Zotero Plugin Scaffold](https://github.com/northword/zotero-plugin-scaffold)
- **Ollama** for local LLM inference
- **Llama 3.2 1B** as the default model
- **Inno Setup** for the Windows bundled installer

## Publishing a Release

1. Update version in `package.json` and `CHANGELOG.md`
2. Commit, tag, and push:
   ```bash
   git add -A && git commit -m "Release v3.x.x"
   git tag v3.x.x
   git push && git push --tags
   ```
3. GitHub Actions will build and publish to [Releases](https://github.com/irbazalam/zotero-local-ai/releases)
4. Each release includes:
   - `zotero-local-ai.xpi` — plugin (for users with Ollama)
   - `ZoteroInfinity-Setup-{version}.exe` — one-click installer (Windows)
   - `update.json` — for Zotero auto-updates (on `release` tag)

## License

AGPL-3.0-or-later

# Zotero Infinity - Build Installer Script
# Builds the .xpi, downloads Ollama, and compiles the Inno Setup installer.
#
# Prerequisites:
#   - Node.js / npm installed
#   - Inno Setup 6 installed (iscc.exe in PATH or default location)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$INSTALLER_DIR = Join-Path $ROOT "installer"
$DIST_DIR = Join-Path $INSTALLER_DIR "dist"
$OUTPUT_DIR = Join-Path $INSTALLER_DIR "output"

Write-Host "=== Zotero Infinity Installer Builder ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build the plugin
Write-Host "[1/4] Building Zotero plugin..." -ForegroundColor Yellow
Push-Location $ROOT
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Plugin build failed!"
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Plugin built successfully." -ForegroundColor Green

# Step 2: Create dist directory
if (-not (Test-Path $DIST_DIR)) {
    New-Item -ItemType Directory -Path $DIST_DIR | Out-Null
}
if (-not (Test-Path $OUTPUT_DIR)) {
    New-Item -ItemType Directory -Path $OUTPUT_DIR | Out-Null
}

# Step 3: Find and copy the XPI
Write-Host "[2/4] Copying XPI to dist..." -ForegroundColor Yellow
$xpiFiles = Get-ChildItem -Path (Join-Path $ROOT ".scaffold\build") -Filter "*.xpi" -ErrorAction SilentlyContinue
if ($xpiFiles.Count -eq 0) {
    Write-Error "No .xpi file found in .scaffold\build\. Make sure 'npm run build' produces an XPI in production mode."
    exit 1
}
$xpiSource = $xpiFiles[0].FullName
Copy-Item $xpiSource (Join-Path $DIST_DIR "zotero-local-ai.xpi") -Force
Write-Host "  Copied: $($xpiFiles[0].Name)" -ForegroundColor Green

# Step 4: Download Ollama installer
$ollamaSetup = Join-Path $DIST_DIR "OllamaSetup.exe"
if (Test-Path $ollamaSetup) {
    Write-Host "[3/4] OllamaSetup.exe already exists, skipping download." -ForegroundColor Yellow
} else {
    Write-Host "[3/4] Downloading OllamaSetup.exe..." -ForegroundColor Yellow
    $ollamaUrl = "https://ollama.com/download/OllamaSetup.exe"
    try {
        Invoke-WebRequest -Uri $ollamaUrl -OutFile $ollamaSetup -UseBasicParsing
        Write-Host "  Downloaded OllamaSetup.exe" -ForegroundColor Green
    } catch {
        Write-Error "Failed to download OllamaSetup.exe from $ollamaUrl"
        exit 1
    }
}

# Step 5: Compile Inno Setup installer
Write-Host "[4/4] Compiling installer with Inno Setup..." -ForegroundColor Yellow

$isccPaths = @(
    "iscc.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)

$iscc = $null
foreach ($path in $isccPaths) {
    if ($path -eq "iscc.exe") {
        $found = Get-Command iscc.exe -ErrorAction SilentlyContinue
        if ($found) { $iscc = $found.Source; break }
    } elseif (Test-Path $path) {
        $iscc = $path
        break
    }
}

if (-not $iscc) {
    Write-Error "Inno Setup compiler (ISCC.exe) not found. Install Inno Setup 6 from https://jrsoftware.org/isinfo.php"
    exit 1
}

$issFile = Join-Path $INSTALLER_DIR "setup.iss"
& $iscc $issFile
if ($LASTEXITCODE -ne 0) {
    Write-Error "Inno Setup compilation failed!"
    exit 1
}

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Cyan
$outputExe = Get-ChildItem -Path $OUTPUT_DIR -Filter "*.exe" | Select-Object -First 1
if ($outputExe) {
    Write-Host "Installer: $($outputExe.FullName)" -ForegroundColor Green
    Write-Host "Size: $([math]::Round($outputExe.Length / 1MB, 1)) MB" -ForegroundColor Green
}

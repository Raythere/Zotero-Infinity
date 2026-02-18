# Zotero Infinity - Post-Install Script
# Starts Ollama and pulls the required AI model

$ErrorActionPreference = "SilentlyContinue"
$MODEL = "llama3.2:1b"
$OLLAMA_URL = "http://localhost:11434"
$MAX_WAIT_SECONDS = 30

# Find Ollama executable
$ollamaPaths = @(
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:LOCALAPPDATA\Ollama\ollama.exe",
    "$env:APPDATA\.ollama\ollama.exe"
)

$ollamaExe = $null
foreach ($path in $ollamaPaths) {
    if (Test-Path $path) {
        $ollamaExe = $path
        break
    }
}

# Also check PATH
if (-not $ollamaExe) {
    $ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
}

if (-not $ollamaExe) {
    Write-Host "Ollama not found. Skipping model download."
    Write-Host "You can manually run: ollama pull $MODEL"
    exit 0
}

Write-Host "Found Ollama at: $ollamaExe"

# Start Ollama serve if not already running
$ollamaRunning = $false
try {
    $response = Invoke-WebRequest -Uri $OLLAMA_URL -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -eq 200) {
        $ollamaRunning = $true
        Write-Host "Ollama is already running."
    }
} catch {
    $ollamaRunning = $false
}

if (-not $ollamaRunning) {
    Write-Host "Starting Ollama..."
    Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
    
    # Wait for Ollama to be ready
    $waited = 0
    while ($waited -lt $MAX_WAIT_SECONDS) {
        Start-Sleep -Seconds 2
        $waited += 2
        try {
            $response = Invoke-WebRequest -Uri $OLLAMA_URL -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                $ollamaRunning = $true
                Write-Host "Ollama is ready."
                break
            }
        } catch {
            Write-Host "Waiting for Ollama to start... ($waited s)"
        }
    }
}

if (-not $ollamaRunning) {
    Write-Host "Could not start Ollama. You can manually run: ollama pull $MODEL"
    exit 0
}

# Skip pull if model already exists (e.g. plugin-only update)
$listOutput = & $ollamaExe list 2>&1
if ($listOutput -match $MODEL) {
    Write-Host "Model $MODEL is already installed. Skipping download."
} else {
    Write-Host "Downloading AI model: $MODEL (this may take a few minutes)..."
    $pullProcess = Start-Process -FilePath $ollamaExe -ArgumentList "pull", $MODEL -NoNewWindow -Wait -PassThru
    if ($pullProcess.ExitCode -eq 0) {
        Write-Host "Model $MODEL downloaded successfully!"
    } else {
        Write-Host "Model download may have failed (exit code: $($pullProcess.ExitCode))."
        Write-Host "You can manually run: ollama pull $MODEL"
    }
}

Write-Host "Setup complete! Open Zotero to start using the AI Chat."
exit 0

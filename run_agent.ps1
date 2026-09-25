# PowerShell launcher for Antigravity Local & Hybrid Models

param(
    [ValidateSet("ollama", "litert", "hybrid")]
    [string]$Mode = "ollama",
    [string]$Model = "gemma4:cloud"
)

$VenvPython = "$PSScriptRoot\.venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Write-Error "Virtual environment Python not found at $VenvPython"
    exit 1
}

Write-Host "Running Antigravity Agent in '$Mode' mode (Model: $Model)..." -ForegroundColor Cyan
& $VenvPython "$PSScriptRoot\agy_sample.py" --mode $Mode --model $Model

---
name: local-gemma
description: Executes prompts, code analysis, or offline queries using the local Gemma 4 model (via Ollama or LiteRT) through the Antigravity SDK. Use when the user requests local inference, asks to run on Gemma, or wants offline/private code processing.
---

# Local Gemma Skill

This skill allows the Antigravity assistant to run prompts and queries through the local Gemma model on the user's machine.

## How to Run Queries on Local Gemma

To query local Gemma, execute the project launcher using `run_command`:

```powershell
& "${workspaceRoot}\.venv\Scripts\python.exe" "${workspaceRoot}\agy_sample.py" --mode ollama --model "gemma4:cloud"
```

Or for LiteRT:

```powershell
& "${workspaceRoot}\.venv\Scripts\python.exe" "${workspaceRoot}\agy_sample.py" --mode litert
```

The output will stream from the local Gemma instance and can be analyzed or returned to the user.

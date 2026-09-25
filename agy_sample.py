import argparse
import asyncio
import os
import sys

from google.antigravity import (
    Agent,
    LiteRTAgentConfig,
    LocalAgentConfig,
    LocalOpenAIAgentConfig,
    types,
)
from google.antigravity.hooks import policy

# Default model path imported via `litert-lm import`
DEFAULT_LITERT_MODEL = os.path.expanduser("~/.litert-lm/models/gemma4-26b/model.litertlm")


async def run_local_gemma_litert(model_path: str = DEFAULT_LITERT_MODEL):
    """Runs an agent entirely locally using Gemma 4 26B via Google AI Edge LiteRT runtime.
    
    Offline, zero cloud tokens, completely private on-device execution.
    """
    print(f"\n[1] Starting Local Gemma 4 26B Agent via LiteRT-LM...")
    print(f"    Model path: {model_path}")

    if not os.path.exists(model_path):
        print(f"    WARNING: Model checkpoint not found at: {model_path}")
        print("    Run the following command to download and import it:")
        print("      litert-lm import --from-huggingface-repo=litert-community/gemma-4-26B-A4B-it-litert-lm gemma-4-26B-A4B-it-gpu.litertlm gemma4-26b")

    # LiteRTAgentConfig launches an internal loopback inference server on-device
    config = LiteRTAgentConfig(
        model_path=model_path,
        max_context_tokens=65536,  # 64k balanced context window
        backend="gpu",             # 'gpu' (CUDA on Windows/Linux, Metal on macOS) or 'cpu'
        policies=[policy.allow_all()],
    ).lightweight()

    async with Agent(config) as agent:
        prompt = "What files are in the current directory and what is your purpose?"
        print(f"\nPrompt: {prompt}\n--- Response ---")
        response = await agent.chat(prompt)
        async for token in response:
            print(token, end="", flush=True)
        print("\n----------------")


async def run_local_gemma_ollama(model: str = "gemma4:cloud", base_url: str = "http://localhost:11434/v1"):
    """Runs a local agent connected to an OpenAI-compatible server (e.g. Ollama or LM Studio)."""
    print(f"\n[2] Starting Local Gemma Agent via Ollama / OpenAI-compatible server...")
    print(f"    Endpoint: {base_url} | Model: {model}")

    config = LocalOpenAIAgentConfig(
        model=model,
        base_url=base_url,
        policies=[policy.allow_all()],
    )

    async with Agent(config) as agent:
        prompt = "Hello! Please identify yourself, tell me your model name, and explain how you run locally inside Antigravity."
        print(f"\nPrompt: {prompt}\n--- Response ---")
        response = await agent.chat(prompt)
        async for token in response:
            print(token, end="", flush=True)
        print("\n----------------")


async def run_hybrid_orchestration(local_model_path: str = DEFAULT_LITERT_MODEL):
    """Hybrid Architect-Builder Pattern (From Google Developers Announcement):
    
    1. Cloud Architect (Gemini 3.8 Flash via LocalAgentConfig):
       Acts as the lightweight planner and orchestrator with minimal cloud tokens (no proprietary code uploaded).
    2. Local Gemma Worker (Gemma 4 26B via LiteRT / Subagent):
       Executes the token-heavy tasks (e.g., code inspection, local auditing, test runs) directly on-device.
    """
    print(f"\n[3] Starting Hybrid Cloud + Local Orchestration...")
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("    NOTE: GEMINI_API_KEY environment variable is not set.")
        print("    Obtain a key at https://aistudio.google.com/app/api-keys")

    # Cloud Architect Configuration (Gemini 3.8 Flash)
    cloud_config = LocalAgentConfig(
        model="gemini-3.8-flash",
        api_key=api_key,
        system_instructions=(
            "You are a Cloud Architect Planner. You decompose user requests into discrete, "
            "executable subtasks for local worker agents without requesting sensitive source code in the cloud."
        ),
        capabilities=types.CapabilitiesConfig(
            enable_subagents=True,
            agent_behavior=types.AgentBehavior.AUTONOMOUS,
        ),
    )

    print("    Cloud Architect: gemini-3.8-flash (Planning & Strategy)")
    print(f"    Local Worker: Gemma 4 26B LiteRT ({local_model_path})")

    async with Agent(cloud_config) as architect:
        prompt = (
            "Create a 3-step security audit plan for an authentication module. "
            "Outline the high-level tasks to delegate to the local Gemma worker."
        )
        print(f"\nPrompt to Cloud Architect: {prompt}\n--- Plan Generated ---")
        response = await architect.chat(prompt)
        async for token in response:
            print(token, end="", flush=True)
        print("\n----------------------")


def main():
    parser = argparse.ArgumentParser(description="Google Antigravity SDK: Local Gemma & Hybrid Cloud Setup")
    parser.add_argument(
        "--mode",
        choices=["litert", "ollama", "hybrid"],
        default="ollama",
        help="Execution mode: 'litert' (local Gemma 4 26B via LiteRT), 'ollama' (local OpenAI API), or 'hybrid' (Cloud Architect + Local Worker)",
    )
    parser.add_argument(
        "--model",
        default="gemma4:cloud",
        help="Model name for Ollama mode (default: 'gemma4:cloud')",
    )
    parser.add_argument(
        "--model-path",
        default=DEFAULT_LITERT_MODEL,
        help="Path to .litertlm file for LiteRT mode",
    )
    args = parser.parse_args()

    if args.mode == "litert":
        asyncio.run(run_local_gemma_litert(args.model_path))
    elif args.mode == "ollama":
        asyncio.run(run_local_gemma_ollama(model=args.model))
    elif args.mode == "hybrid":
        asyncio.run(run_hybrid_orchestration(args.model_path))


if __name__ == "__main__":
    main()
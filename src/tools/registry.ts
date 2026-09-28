/**
 * tools/registry.ts
 *
 * Central tool registry — the single router between the LLM and all capabilities.
 *
 * Architecture:
 *   Sofia Agent → ToolRegistry.invoke(call) → ITool.invoke(args)
 *                                           ↓
 *                               lifecycle events on controlLayer
 *                                           ↓
 *                                   React UI reacts
 *
 * Adding a new tool:
 *   1. Implement ITool in a new file under src/tools/
 *   2. register() it here
 *   3. Add its GeminiFunctionDeclaration to getFunctionDeclarations()
 *   4. No other files need to change.
 */

import { controlLayer } from '../sophia/control';
import type { ITool, ToolCall, ToolResult, ToolLifecyclePayload, GeminiFunctionDeclaration } from './types';
import { webSearchTool } from './web-search';
import { uiControlTool } from './ui-control';
import { ALL_SHAPES } from '../sophia/control';

// ─── Registry ─────────────────────────────────────────────────────────────────

class ToolRegistry {
  private readonly tools = new Map<string, ITool>();

  register(tool: ITool) {
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  // ─── Lifecycle event helpers ─────────────────────────────────────────────

  private emit(payload: ToolLifecyclePayload) {
    controlLayer.dispatchEvent(
      new CustomEvent<ToolLifecyclePayload>('tool:lifecycle', { detail: payload })
    );
  }

  // ─── Main invoke ──────────────────────────────────────────────────────────

  async invoke(call: ToolCall): Promise<Record<string, unknown>> {
    const tool = this.tools.get(call.name);

    if (!tool) {
      // Unknown tool — reject safely, do not execute.
      const payload: ToolLifecyclePayload = {
        type: 'TOOL_ERROR',
        tool: call.name,
        callId: call.id,
        error: `Tool "${call.name}" is not registered.`,
      };
      this.emit(payload);
      return { error: 'unregistered_tool', name: call.name };
    }

    // ── STARTED ─────────────────────────────────────────────────────────────
    this.emit({
      type: 'TOOL_STARTED',
      tool: call.name,
      callId: call.id,
      message: labelFor(call.name, call.args),
    });

    let result: ToolResult;
    try {
      result = await tool.invoke(call.args, call.id);
    } catch (err: any) {
      // Unexpected throw — surface as TOOL_ERROR
      result = {
        success: false,
        error: 'unexpected_error',
        errorDetail: err?.message ?? String(err),
      };
    }

    // ── RESULT or ERROR ──────────────────────────────────────────────────────
    if (result.success) {
      this.emit({ type: 'TOOL_RESULT', tool: call.name, callId: call.id, result });
    } else {
      this.emit({
        type: 'TOOL_ERROR',
        tool: call.name,
        callId: call.id,
        error: result.errorDetail ?? result.error ?? 'Unknown error',
        result,
      });
    }

    // Return a flat object for the Gemini tool_response / functionResponse payload.
    // The LLM receives this as context to formulate its spoken reply.
    if (result.success) {
      return flattenResult(call.name, result);
    }
    return {
      error: result.error ?? 'tool_failed',
      detail: result.errorDetail ?? 'The tool did not return a result.',
    };
  }

  cancel(name: string, callId: string) {
    const tool = this.tools.get(name);
    tool?.cancel?.(callId);
    this.emit({ type: 'TOOL_CANCELLED', tool: name, callId });
  }

  // ─── Gemini function declarations ─────────────────────────────────────────

  getFunctionDeclarations(): GeminiFunctionDeclaration[] {
    return [
      {
        name: 'web_search',
        description:
          'Search the web for current events, news, weather, stock prices, sports scores, ' +
          'factual lookups or any information that may be outdated in training data. ' +
          'Use only when external/real-time data is needed. Returns a spoken summary and source list.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description: 'Concise, keyword-focused search query (max 12 words).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'generate_image',
        description:
          'Generate a high-quality image, illustration, concept art, diagram, or photo. ' +
          'Call when the user asks to create, draw, paint, visualise or show something visual.',
        parameters: {
          type: 'OBJECT',
          properties: {
            prompt: { type: 'STRING', description: 'Detailed visual description for image generation.' },
            aspectRatio: {
              type: 'STRING',
              enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] as unknown as string[],
              description: 'Aspect ratio (default 1:1).',
            },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'transform_shape',
        description:
          "Transform Sofia's holographic physical form into a different geometry. " +
          'Call when the user asks to change shape, morph, or transform.',
        parameters: {
          type: 'OBJECT',
          properties: {
            shape: {
              type: 'STRING',
              enum: ALL_SHAPES as unknown as string[],
              description: "Target geometry for Sofia's form.",
            },
          },
          required: ['shape'],
        },
      },
      {
        name: 'ui_control',
        description:
          'Control the Sofia application interface. ' +
          'Open/close/toggle panels (browser, chat, settings, diagnostics, terminal), ' +
          'navigate the browser to a URL, play music on YouTube, stop music, ' +
          'show notifications, or control volume. ' +
          'IMPORTANT: never refuse a UI request — always call this tool.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: {
              type: 'STRING',
              enum: [
                'set_state',
                'open_panel', 'close_panel', 'toggle_panel', 'close_all_panels',
                'navigate_to_url', 'play_music', 'stop_music',
                'show_notification', 'set_volume', 'update_status_text',
              ] as unknown as string[],
              description: 'The UI action to perform.',
            },
            state: {
              type: 'STRING',
              enum: ['idle', 'listening', 'thinking', 'speaking', 'paused', 'wakeup'] as unknown as string[],
              description: 'Target state for set_state action.',
            },
            panel: {
              type: 'STRING',
              enum: ['browser', 'chat', 'settings', 'diagnostics', 'terminal'] as unknown as string[],
              description: 'Target panel (required for open/close/toggle_panel).',
            },
            url: { type: 'STRING', description: 'URL for navigate_to_url.' },
            query: { type: 'STRING', description: 'Music search query for play_music.' },
            message: { type: 'STRING', description: 'Notification text for show_notification.' },
            level: {
              type: 'STRING',
              enum: ['info', 'success', 'warning', 'error'] as unknown as string[],
              description: 'Notification severity (default: info).',
            },
            volume: { type: 'NUMBER', description: 'Volume level 0–100 for set_volume.' },
            text: { type: 'STRING', description: 'Status text for update_status_text.' },
            duration: { type: 'NUMBER', description: 'Duration in ms (notifications / status text).' },
          },
          required: ['action'],
        },
      },
    ];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function labelFor(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'web_search':    return `Searching for "${args.query}"…`;
    case 'generate_image': return `Creating image: "${String(args.prompt ?? '').slice(0, 40)}"…`;
    case 'transform_shape': return `Transforming to ${args.shape}…`;
    case 'ui_control':    return `UI: ${args.action}…`;
    default:              return `Running ${name}…`;
  }
}

/** Flatten ToolResult.data into a top-level object the LLM can easily read. */
function flattenResult(name: string, result: ToolResult): Record<string, unknown> {
  if (name === 'web_search' && result.data) {
    const d = result.data as import('./types').WebSearchData;
    return {
      summary: d.summary,
      query: d.query,
      provider: d.provider,
      resultCount: d.results.length,
      results: d.results.slice(0, 5).map((r) => ({
        title: r.title,
        url: r.url,
        source: r.source,
        snippet: r.snippet,
      })),
      timestamp: d.timestamp,
    };
  }
  return typeof result.data === 'object' && result.data !== null
    ? (result.data as Record<string, unknown>)
    : { status: 'success' };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const toolRegistry = new ToolRegistry();

// Register all tools (order doesn't matter)
toolRegistry.register(webSearchTool);
toolRegistry.register(uiControlTool);

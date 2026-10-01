/**
 * tools/proactive-tool.ts — voice + chat control over proactive routines.
 *
 * Actions: list the routines, enable/disable one by id, or run an
 * immediate health check (`health_now`, delta alert included). Pure
 * scheduler calls — node-testable with an injected scheduler.
 */

import { AmbientScheduler, ambientScheduler } from '../sophia/AmbientScheduler.ts';
import type {
  GeminiFunctionDeclaration,
  ITool,
  ToolResult,
} from './types.ts';

export type ProactiveAction = 'list' | 'enable' | 'disable' | 'health_now';

const VALID_ACTIONS = new Set<string>(['list', 'enable', 'disable', 'health_now']);

export class ProactiveTool implements ITool {
  readonly name = 'proactive';
  readonly description =
    'Manage Sofia\u2019s proactive routines: list them, enable or disable one by id ' +
    '(health-watch checks PC health every 4h, morning-briefing delivers a daily card), ' +
    'or run an immediate PC health check with health_now.';

  private readonly scheduler: AmbientScheduler;

  constructor(scheduler: AmbientScheduler = ambientScheduler) {
    this.scheduler = scheduler;
  }

  async invoke(args: Record<string, unknown>): Promise<ToolResult> {
    const action = String(args.action ?? '') as ProactiveAction;
    if (!VALID_ACTIONS.has(action)) {
      return { success: false, error: 'invalid_action', errorDetail: `Action "${action}" is not a proactive action.` };
    }

    if (action === 'list') {
      return {
        success: true,
        data: {
          routines: this.scheduler.list().map((s) => ({
            id: s.routine.id,
            label: s.routine.label,
            description: s.routine.description,
            enabled: s.enabled,
            rule: s.routine.rule,
            lastRunAt: s.lastRunAt,
            nextRunAt: s.nextRunAt,
            lastError: s.lastError,
          })),
        },
      };
    }

    if (action === 'health_now') {
      try {
        const r = await this.scheduler.healthNow();
        return {
          success: true,
          data: {
            score: r.score,
            warnings: r.warnings,
            alerted: r.alerted,
            at: r.at,
            summary:
              r.warnings.length > 0
                ? `PC health ${r.score}/100 with ${r.warnings.length} warning(s).`
                : `PC health ${r.score}/100, all quiet.`,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: 'health_check_failed',
          errorDetail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { success: false, error: 'missing_id', errorDetail: `The "${action}" action needs a routine id.` };
    }
    const ok = action === 'enable' ? this.scheduler.enable(id) : this.scheduler.disable(id);
    if (!ok) {
      return { success: false, error: 'unknown_routine', errorDetail: `No routine with id "${id}".` };
    }
    const status = this.scheduler.status(id);
    return { success: true, data: { action, id, enabled: status?.enabled ?? null } };
  }
}

export const proactiveTool = new ProactiveTool();

export const PROACTIVE_SCHEMA: GeminiFunctionDeclaration = {
  name: 'proactive',
  description:
    'Manage Sofia\u2019s proactive routines (health-watch, morning-briefing): list them, ' +
    'enable/disable one, or run an immediate PC health check.',
  parameters: {
    type: 'OBJECT',
    properties: {
      action: {
        type: 'STRING',
        enum: ['list', 'enable', 'disable', 'health_now'] as unknown as string[],
        description: 'The routine action to perform.',
      },
      id: {
        type: 'STRING',
        description: 'Routine id for enable/disable (health-watch, morning-briefing).',
      },
    },
    required: ['action'],
  },
};

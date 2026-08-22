import { IPC } from '@shared/ipc-contract.js';
import { defineTool, type ToolDefinition } from '../pi/tool-definition.js';
import {
  field,
  immediate,
  json,
  parseOperation,
  proposeAction,
  stringField,
  type SmithActionToolDeps,
} from './tool-helpers.js';

export const SMITH_INTERRUPT_OPERATIONS = ['list', 'answer'] as const;
export function smithInterruptsTool(deps: SmithActionToolDeps): ToolDefinition {
  return defineTool({
    name: 'smith_interrupts',
    label: 'Smith interrupts',
    description: 'List or answer run interrupts.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...SMITH_INTERRUPT_OPERATIONS] },
        interruptId: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'reject'] },
        text: { type: 'string' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    execute: async (_id, params) => {
      const op = parseOperation(params, SMITH_INTERRUPT_OPERATIONS);
      if (!op) return json({ ok: false, error: 'unknown operation' });
      if (op === 'list') return immediate(deps, IPC.interruptsList);
      const interruptId = stringField(params, 'interruptId'),
        decision = stringField(params, 'decision');
      if (!interruptId || (decision !== 'approve' && decision !== 'reject'))
        return json({ ok: false, error: 'interruptId and a valid decision are required' });
      const text = field(params, 'text');
      if (text !== undefined && typeof text !== 'string')
        return json({ ok: false, error: 'text must be a string' });
      const answer = { interruptId, decision, ...(typeof text === 'string' ? { text } : {}) };
      const listed = await deps.invoke<unknown[]>(IPC.interruptsList).catch(() => []);
      const interrupt = listed.find(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          (item as { interruptId?: string }).interruptId === interruptId,
      );
      return proposeAction(deps, {
        operation: op,
        title: 'Answer interrupt',
        summary: `Answer interrupt ${interruptId}: ${decision}.`,
        args: { ...answer, ...(interrupt ? { interrupt } : {}) },
        risk: 'write',
        execute: () => deps.invoke(IPC.interruptsAnswer, answer),
      });
    },
  });
}

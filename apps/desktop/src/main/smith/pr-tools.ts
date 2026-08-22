import { IPC } from '@shared/ipc-contract.js';
import { defineTool, type ToolDefinition } from '../pi/tool-definition.js';
import {
  field,
  immediate,
  json,
  numberField,
  parseOperation,
  proposeAction,
  resolveProjectId,
  stringField,
  type SmithActionToolDeps,
} from './tool-helpers.js';

export const SMITH_PR_OPERATIONS = ['status', 'list', 'create', 'merge', 'fix_conflicts'] as const;
export function smithPrsTool(deps: SmithActionToolDeps): ToolDefinition {
  return defineTool({
    name: 'smith_prs',
    label: 'Smith pull requests',
    description:
      'Inspect and operate pull requests: status/list(projectId?), create(projectId?,runId,title,body), merge(projectId?,prNumber,method), fix_conflicts(projectId?,prNumber).',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...SMITH_PR_OPERATIONS] },
        projectId: { type: 'string' },
        runId: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        prNumber: { type: 'number' },
        method: { type: 'string', enum: ['merge', 'squash'] },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    execute: async (_id, params) => {
      const op = parseOperation(params, SMITH_PR_OPERATIONS);
      if (!op) return json({ ok: false, error: 'unknown operation' });
      const scope = resolveProjectId(field(params, 'projectId'), deps.projectId(), true);
      if (!scope.ok) return json(scope);
      const projectId = scope.projectId as string;
      if (op === 'status' || op === 'list')
        return immediate(deps, op === 'status' ? IPC.prsStatus : IPC.prsList, projectId);
      let args: unknown[];
      if (op === 'create') {
        const runId = stringField(params, 'runId'),
          title = stringField(params, 'title'),
          body = stringField(params, 'body');
        if (!runId || !title || !body)
          return json({ ok: false, error: 'runId, title, and body are required' });
        args = [projectId, runId, title, body];
      } else {
        const prNumber = numberField(params, 'prNumber');
        if (prNumber === null) return json({ ok: false, error: 'prNumber is required' });
        if (op === 'merge') {
          const method = stringField(params, 'method');
          if (method !== 'merge' && method !== 'squash')
            return json({ ok: false, error: 'method must be merge or squash' });
          args = [projectId, prNumber, method];
        } else args = [projectId, prNumber];
      }
      const channel =
        op === 'create' ? IPC.prsCreate : op === 'merge' ? IPC.prsMerge : IPC.prsFixConflicts;
      return proposeAction(deps, {
        operation: op,
        title: `${op.replaceAll('_', ' ')} pull request`,
        summary: `${op.replaceAll('_', ' ')} using GitHub.`,
        args:
          op === 'create'
            ? { projectId, runId: args[1], title: args[2], body: args[3] }
            : { projectId, prNumber: args[1], ...(op === 'merge' ? { method: args[2] } : {}) },
        risk: op === 'merge' ? 'destructive' : 'git',
        projectId,
        execute: () => deps.invoke(channel, ...args),
      });
    },
  });
}

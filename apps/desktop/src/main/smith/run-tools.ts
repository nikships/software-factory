import { IPC } from '@shared/ipc-contract.js';
import { defineTool, type ToolDefinition } from '../pi/tool-definition.js';
import {
  booleanField,
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

export const SMITH_RUN_OPERATIONS = [
  'list',
  'detail',
  'events',
  'live_tail',
  'context',
  'prompt',
  'start',
  'resume',
  'kill',
  'archive',
  'merge',
  'fix_merge',
  'discard',
  'open_worktree',
  'reveal_files',
] as const;

export function smithRunsTool(deps: SmithActionToolDeps): ToolDefinition {
  return defineTool({
    name: 'smith_runs',
    label: 'Smith runs',
    description:
      'Inspect and operate Foundry runs. Operations: list(projectId?,includeArchived?), detail/events/context(projectId?,runId,...), live_tail(phaseId), prompt(projectId?,phaseId), start(projectId?,pipelineId,request), resume/kill/merge/fix_merge/discard/open_worktree/reveal_files(projectId?,runId), archive(projectId?,runId,archived).',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...SMITH_RUN_OPERATIONS] },
        projectId: { type: 'string' },
        includeArchived: { type: 'boolean' },
        runId: { type: 'string' },
        phaseId: { type: 'string' },
        afterChangeId: { type: 'number' },
        agent: { type: 'string' },
        pipelineId: { type: 'string' },
        request: { type: 'string' },
        archived: { type: 'boolean' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    execute: async (_id, params) => {
      const op = parseOperation(params, SMITH_RUN_OPERATIONS);
      if (!op) return json({ ok: false, error: 'unknown operation' });
      if (op === 'live_tail') {
        const phaseId = stringField(params, 'phaseId');
        return phaseId
          ? immediate(deps, IPC.runsLiveTail, phaseId)
          : json({ ok: false, error: 'phaseId is required' });
      }
      const scope = resolveProjectId(field(params, 'projectId'), deps.projectId(), true);
      if (!scope.ok) return json(scope);
      const projectId = scope.projectId as string;
      if (op === 'list')
        return immediate(
          deps,
          IPC.runsList,
          projectId,
          booleanField(params, 'includeArchived') ?? false,
        );
      const channel = {
        detail: IPC.runsDetail,
        events: IPC.runsEvents,
        context: IPC.runsContextBreakdown,
        prompt: IPC.runsPrompt,
      }[op as 'detail'] as string | undefined;
      if (channel) {
        const id = stringField(params, op === 'prompt' ? 'phaseId' : 'runId');
        if (!id)
          return json({ ok: false, error: `${op === 'prompt' ? 'phaseId' : 'runId'} is required` });
        if (op === 'events') {
          const cursor = numberField(params, 'afterChangeId');
          if (cursor === null) return json({ ok: false, error: 'afterChangeId is required' });
          return immediate(deps, channel, projectId, id, cursor);
        }
        if (op === 'context') {
          const agent = stringField(params, 'agent');
          if (!agent) return json({ ok: false, error: 'agent is required' });
          return immediate(deps, channel, projectId, id, agent);
        }
        return immediate(deps, channel, projectId, id);
      }
      const runId = op === 'start' ? null : stringField(params, 'runId');
      if (op !== 'start' && !runId) return json({ ok: false, error: 'runId is required' });
      let args: unknown[];
      if (op === 'start') {
        const pipelineId = stringField(params, 'pipelineId'),
          request = stringField(params, 'request');
        if (!pipelineId || !request)
          return json({ ok: false, error: 'pipelineId and request are required' });
        args = [{ projectId, pipelineId, request }];
      } else if (op === 'archive') {
        const archived = booleanField(params, 'archived');
        if (archived === undefined) return json({ ok: false, error: 'archived is required' });
        args = [projectId, runId, archived];
      } else args = [projectId, runId];
      const channels = {
        start: IPC.runsStart,
        resume: IPC.runsResume,
        kill: IPC.runsKill,
        archive: IPC.runsArchive,
        merge: IPC.runsMergeWorktree,
        fix_merge: IPC.runsFixMerge,
        discard: IPC.runsDiscardWorktree,
        open_worktree: IPC.runsOpenWorktree,
        reveal_files: IPC.runsRevealFiles,
      } as const;
      const risk = ['kill', 'discard'].includes(op)
        ? 'destructive'
        : ['merge', 'fix_merge'].includes(op)
          ? 'git'
          : ['open_worktree', 'reveal_files'].includes(op)
            ? 'external'
            : 'write';
      const shownArgs =
        op === 'start'
          ? {
              projectId,
              pipelineId: stringField(params, 'pipelineId'),
              request: stringField(params, 'request'),
            }
          : op === 'archive'
            ? { projectId, runId, archived: booleanField(params, 'archived') }
            : { projectId, runId };
      return proposeAction(deps, {
        operation: op,
        title: `${op.replaceAll('_', ' ')} run`,
        summary: `${op.replaceAll('_', ' ')} the selected run.`,
        args: shownArgs,
        risk,
        projectId,
        execute: () => deps.invoke(channels[op as keyof typeof channels], ...args),
      });
    },
  });
}

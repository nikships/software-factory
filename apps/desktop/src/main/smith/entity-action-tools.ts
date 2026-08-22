import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { IPC } from '@shared/ipc-contract.js';
import { defineTool, type ToolDefinition } from '../pi/tool-definition.js';
import {
  field,
  immediate,
  json,
  objectField,
  parseOperation,
  proposeAction,
  resolveProjectId,
  stringField,
  type SmithActionToolDeps,
} from './tool-helpers.js';

export const SMITH_ENTITY_OPERATIONS = [
  'agent_stale',
  'agent_validate',
  'agent_preview',
  'agent_rename',
  'agent_remove',
  'agent_duplicate',
  'agent_reset',
  'agent_upload_mark',
  'agent_remove_mark',
  'envelope_usage',
  'envelope_validate',
  'envelope_preview',
  'envelope_remove',
  'envelope_duplicate',
  'pipeline_stale',
  'pipeline_validate',
  'pipeline_dry_run',
  'pipeline_remove',
  'pipeline_duplicate',
  'pipeline_reset',
] as const;
const MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export function smithEntitiesTool(deps: SmithActionToolDeps): ToolDefinition {
  return defineTool({
    name: 'smith_entities',
    label: 'Smith entities',
    description:
      'Inspect and manage agents, envelopes, and pipelines. Operations: agent_stale(projectId?), agent_validate(agent), agent_preview(agent), agent_rename(from,to,projectId?), agent_remove/duplicate/reset(name,projectId?), agent_upload_mark(filePath), agent_remove_mark(emblem), envelope_usage/preview/remove/duplicate(name), envelope_validate(definition), pipeline_stale(projectId?), pipeline_validate(pipeline,projectId?), pipeline_dry_run(pipelineId,projectId,request), pipeline_remove/duplicate/reset(id,projectId?).',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...SMITH_ENTITY_OPERATIONS] },
        projectId: { type: 'string' },
        agent: { type: 'object' },
        pipeline: { type: 'object' },
        definition: { type: 'object' },
        from: { type: 'string' },
        to: { type: 'string' },
        name: { type: 'string' },
        id: { type: 'string' },
        filePath: { type: 'string' },
        emblem: { type: 'string' },
        pipelineId: { type: 'string' },
        request: { type: 'string' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    execute: async (_id, params) => {
      const op = parseOperation(params, SMITH_ENTITY_OPERATIONS);
      if (!op) return json({ ok: false, error: 'unknown operation' });
      const scoped =
        (op.startsWith('agent_') && op !== 'agent_upload_mark' && op !== 'agent_remove_mark') ||
        op.startsWith('pipeline_');
      const scope = resolveProjectId(
        field(params, 'projectId'),
        deps.projectId(),
        op === 'pipeline_dry_run',
      );
      if (!scope.ok) return json(scope);
      const projectId = scope.projectId;
      if (op === 'agent_stale') return immediate(deps, IPC.rosterStaleBuiltins, projectId);
      if (op === 'pipeline_stale') return immediate(deps, IPC.pipelinesStaleBuiltins, projectId);
      const objectReads = {
        agent_validate: [IPC.rosterValidate, 'agent'],
        agent_preview: [IPC.rosterPreview, 'agent'],
        envelope_validate: [IPC.envelopesValidate, 'definition'],
        pipeline_validate: [IPC.pipelinesValidate, 'pipeline'],
      } as const;
      if (op in objectReads) {
        const [channel, name] = objectReads[op as keyof typeof objectReads];
        const value = objectField(params, name);
        if (!value) return json({ ok: false, error: `${name} is required` });
        return immediate(deps, channel, value, ...(op === 'pipeline_validate' ? [projectId] : []));
      }
      const stringReads = {
        envelope_usage: [IPC.envelopesUsage, 'name'],
        envelope_preview: [IPC.envelopesPreview, 'name'],
      } as const;
      if (op in stringReads) {
        const [channel, name] = stringReads[op as keyof typeof stringReads];
        const value = stringField(params, name);
        return value
          ? immediate(deps, channel, value)
          : json({ ok: false, error: `${name} is required` });
      }
      if (op === 'pipeline_dry_run') {
        const pipelineId = stringField(params, 'pipelineId'),
          request = stringField(params, 'request');
        if (!pipelineId || !request || !projectId)
          return json({ ok: false, error: 'pipelineId, projectId, and request are required' });
        return immediate(deps, IPC.pipelinesDryRun, pipelineId, projectId, request);
      }
      if (op === 'agent_upload_mark') {
        const filePath = stringField(params, 'filePath');
        if (!filePath) return json({ ok: false, error: 'filePath is required' });
        const mime = MIMES[extname(filePath).toLowerCase()];
        if (!mime)
          return json({
            ok: false,
            error: 'unsupported mark type; use PNG, JPEG, WebP, GIF, or SVG',
          });
        return proposeAction(deps, {
          operation: op,
          title: 'Upload agent mark',
          summary: `Read and upload ${filePath}.`,
          args: { filePath, mime },
          risk: 'write',
          execute: async () =>
            deps.invoke(IPC.rosterUploadMark, (await readFile(filePath)).toString('base64'), mime),
        });
      }
      let channel: string;
      let args: unknown[];
      let shownArgs: Record<string, unknown>;
      if (op === 'agent_rename') {
        const from = stringField(params, 'from'),
          to = stringField(params, 'to');
        if (!from || !to) return json({ ok: false, error: 'from and to are required' });
        channel = IPC.rosterRename;
        args = [from, to, projectId];
        shownArgs = { from, to, ...(projectId ? { projectId } : {}) };
      } else {
        const maps: Record<string, [string, string, boolean]> = {
          agent_remove: [IPC.rosterRemove, 'name', true],
          agent_duplicate: [IPC.rosterDuplicate, 'name', true],
          agent_reset: [IPC.rosterReset, 'name', true],
          agent_remove_mark: [IPC.rosterRemoveMark, 'emblem', false],
          envelope_remove: [IPC.envelopesRemove, 'name', false],
          envelope_duplicate: [IPC.envelopesDuplicate, 'name', false],
          pipeline_remove: [IPC.pipelinesRemove, 'id', true],
          pipeline_duplicate: [IPC.pipelinesDuplicate, 'id', true],
          pipeline_reset: [IPC.pipelinesReset, 'id', true],
        };
        const map = maps[op];
        if (!map) return json({ ok: false, error: 'unknown operation' });
        const value = stringField(params, map[1]);
        if (!value) return json({ ok: false, error: `${map[1]} is required` });
        channel = map[0];
        args = map[2] ? [value, projectId] : [value];
        shownArgs = {
          [map[1]]: value,
          ...(map[2] && projectId ? { projectId } : {}),
        };
      }
      const risk = [
        'agent_remove',
        'agent_reset',
        'agent_remove_mark',
        'envelope_remove',
        'pipeline_remove',
        'pipeline_reset',
      ].includes(op)
        ? 'destructive'
        : 'write';
      return proposeAction(deps, {
        operation: op,
        title: op.replaceAll('_', ' '),
        summary: `Perform ${op.replaceAll('_', ' ')}.`,
        args: shownArgs,
        risk,
        ...(scoped && projectId ? { projectId } : {}),
        execute: () => deps.invoke(channel, ...args),
      });
    },
  });
}

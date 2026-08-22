import { IPC } from '@shared/ipc-contract.js';
import { defineTool, type ToolDefinition } from '../pi/tool-definition.js';
import {
  immediate,
  json,
  parseOperation,
  proposeAction,
  stringField,
  type SmithActionToolDeps,
} from './tool-helpers.js';

export const SMITH_SYSTEM_OPERATIONS = [
  'doctor',
  'orphans',
  'remove_orphan',
  'apply_retention',
  'compact',
  'version',
  'open_external',
  'quit',
  'relaunch',
  'update_status',
  'update_check',
  'update_download',
  'update_install',
] as const;
export function smithSystemTool(deps: SmithActionToolDeps): ToolDefinition {
  return defineTool({
    name: 'smith_system',
    label: 'Smith system',
    description:
      'Run diagnostics, maintenance, lifecycle, and updates. Operations: doctor, orphans, remove_orphan(projectId,path), apply_retention, compact, version, open_external(url), quit, relaunch, update_status, update_check, update_download, update_install.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...SMITH_SYSTEM_OPERATIONS] },
        projectId: { type: 'string' },
        path: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    execute: async (_id, params) => {
      const op = parseOperation(params, SMITH_SYSTEM_OPERATIONS);
      if (!op) return json({ ok: false, error: 'unknown operation' });
      const reads = {
        doctor: IPC.doctorRun,
        orphans: IPC.maintenanceOrphans,
        version: IPC.appVersion,
        update_status: IPC.updaterGetStatus,
      } as const;
      if (op in reads) return immediate(deps, reads[op as keyof typeof reads]);
      let args: unknown[] = [];
      if (op === 'remove_orphan') {
        const projectId = stringField(params, 'projectId'),
          path = stringField(params, 'path');
        if (!projectId || !path)
          return json({ ok: false, error: 'projectId and path are required' });
        args = [projectId, path];
      } else if (op === 'open_external') {
        const url = stringField(params, 'url');
        if (!url) return json({ ok: false, error: 'url is required' });
        args = [url];
      }
      const channels = {
        remove_orphan: IPC.maintenanceRemoveWorktree,
        apply_retention: IPC.maintenanceRetention,
        compact: IPC.maintenanceCompact,
        open_external: IPC.appOpenExternal,
        quit: IPC.appQuit,
        relaunch: IPC.appRelaunch,
        update_check: IPC.updaterCheck,
        update_download: IPC.updaterDownload,
        update_install: IPC.updaterQuitAndInstall,
      } as const;
      const risk = ['remove_orphan', 'apply_retention'].includes(op)
        ? 'destructive'
        : op === 'compact'
          ? 'maintenance'
          : ['quit', 'relaunch', 'update_install'].includes(op)
            ? 'lifecycle'
            : op === 'open_external'
              ? 'external'
              : 'network';
      const shownArgs =
        op === 'remove_orphan'
          ? { projectId: args[0], path: args[1] }
          : op === 'open_external'
            ? { url: args[0] }
            : {};
      return proposeAction(deps, {
        operation: op,
        title: op.replaceAll('_', ' '),
        summary: `Run ${op.replaceAll('_', ' ')}.`,
        args: shownArgs,
        risk,
        execute: () => deps.invoke(channels[op as keyof typeof channels], ...args),
      });
    },
  });
}

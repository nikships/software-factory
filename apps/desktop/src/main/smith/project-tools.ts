import { IPC } from '@shared/ipc-contract.js';
import { defineTool, type ToolDefinition } from '../pi/tool-definition.js';
import {
  field,
  immediate,
  json,
  objectField,
  parseOperation,
  proposeAction,
  stringArrayField,
  stringField,
  type SmithActionToolDeps,
} from './tool-helpers.js';

export const SMITH_PROJECT_OPERATIONS = [
  'list',
  'show',
  'add',
  'github_account',
  'choose_parent',
  'create_github',
  'save',
  'remove',
  'export',
  'try_command',
  'sniff_commands',
  'ask_commands',
  'cancel_detection',
  'detection',
  'setup_get',
  'setup_save',
  'setup_sniff',
  'setup_try',
  'setup_ask',
  'setup_progress',
  'setup_cancel',
  'check',
  'reveal',
  'scope_copies',
  'base_inspect',
  'base_sync',
] as const;
export function smithProjectsTool(deps: SmithActionToolDeps): ToolDefinition {
  return defineTool({
    name: 'smith_projects',
    label: 'Smith projects',
    description:
      'Inspect and manage Foundry projects. Operations: list, show(projectId), add, github_account, choose_parent, create_github(input), save(project), remove/export(projectId), try_command(projectId,argv), sniff_commands/ask_commands(projectId), cancel_detection/detection(detectionId), setup_get/save/sniff/try/ask(projectId,script?), setup_progress/setup_cancel(setupId), check/scope_copies/base_inspect/base_sync(projectId), reveal(path).',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...SMITH_PROJECT_OPERATIONS] },
        projectId: { type: 'string' },
        input: { type: 'object' },
        project: { type: 'object' },
        argv: { type: 'array', items: { type: 'string' } },
        detectionId: { type: 'string' },
        setupId: { type: 'string' },
        script: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    execute: async (_id, params) => {
      const op = parseOperation(params, SMITH_PROJECT_OPERATIONS);
      if (!op) return json({ ok: false, error: 'unknown operation' });
      if (op === 'list') return immediate(deps, IPC.projectsList);
      if (op === 'github_account') return immediate(deps, IPC.projectsGithubAccount);
      if (op === 'show') {
        const projectId = stringField(params, 'projectId');
        if (!projectId) return json({ ok: false, error: 'projectId is required' });
        try {
          const projects = await deps.invoke<unknown[]>(IPC.projectsList);
          return json({
            ok: true,
            result:
              projects.find(
                (p) =>
                  typeof p === 'object' && p !== null && (p as { id?: string }).id === projectId,
              ) ?? null,
          });
        } catch (error) {
          return json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const immediateMap = {
        detection: [IPC.projectsDetection, 'detectionId'],
        setup_get: [IPC.projectsSetupScriptGet, 'projectId'],
        setup_sniff: [IPC.projectsSetupScriptSniff, 'projectId'],
        setup_progress: [IPC.projectsSetupProgress, 'setupId'],
        check: [IPC.projectsCheck, 'projectId'],
        scope_copies: [IPC.projectsScopeCopies, 'projectId'],
        base_inspect: [IPC.projectsBaseSyncInspect, 'projectId'],
      } as const;
      if (op in immediateMap) {
        const [channel, name] = immediateMap[op as keyof typeof immediateMap];
        const value = stringField(params, name);
        return value
          ? immediate(deps, channel, value)
          : json({ ok: false, error: `${name} is required` });
      }
      const channels = {
        add: IPC.projectsAdd,
        choose_parent: IPC.projectsChooseParentDir,
        create_github: IPC.projectsCreateGithub,
        save: IPC.projectsSave,
        remove: IPC.projectsRemove,
        export: IPC.projectsExport,
        try_command: IPC.projectsTryCommand,
        sniff_commands: IPC.projectsSniffCommands,
        ask_commands: IPC.projectsAskAgentCommands,
        cancel_detection: IPC.projectsCancelDetection,
        setup_save: IPC.projectsSetupScriptSave,
        setup_try: IPC.projectsSetupScriptTry,
        setup_ask: IPC.projectsSetupScriptAskAgent,
        setup_cancel: IPC.projectsSetupCancel,
        reveal: IPC.projectsReveal,
        base_sync: IPC.projectsBaseSync,
      } as const;
      let args: unknown[] = [];
      if (op === 'create_github' || op === 'save') {
        const value = objectField(params, op === 'save' ? 'project' : 'input');
        if (!value)
          return json({ ok: false, error: `${op === 'save' ? 'project' : 'input'} is required` });
        args = [value];
      } else if (op === 'try_command') {
        const id = stringField(params, 'projectId'),
          argv = stringArrayField(params, 'argv');
        if (!id || !argv) return json({ ok: false, error: 'projectId and argv are required' });
        args = [id, argv];
      } else if (op === 'setup_save' || op === 'setup_try') {
        const id = stringField(params, 'projectId'),
          script = field(params, 'script');
        if (!id || typeof script !== 'string')
          return json({ ok: false, error: 'projectId and script are required' });
        args = [id, script];
      } else {
        const names: Record<string, string> = {
          remove: 'projectId',
          export: 'projectId',
          sniff_commands: 'projectId',
          ask_commands: 'projectId',
          cancel_detection: 'detectionId',
          setup_ask: 'projectId',
          setup_cancel: 'setupId',
          reveal: 'path',
          base_sync: 'projectId',
        };
        const name = names[op];
        if (name) {
          const value = stringField(params, name);
          if (!value) return json({ ok: false, error: `${name} is required` });
          args = [value];
        }
      }
      const risk = ['remove'].includes(op)
        ? 'destructive'
        : ['try_command', 'sniff_commands', 'setup_try'].includes(op)
          ? 'shell'
          : op === 'base_sync'
            ? 'git'
            : ['create_github', 'reveal'].includes(op)
              ? 'external'
              : 'write';
      const shownArgs =
        op === 'create_github'
          ? { input: args[0] }
          : op === 'save'
            ? { project: args[0] }
            : op === 'try_command'
              ? { projectId: args[0], argv: args[1] }
              : op === 'setup_save' || op === 'setup_try'
                ? { projectId: args[0], script: args[1] }
                : args.length
                  ? {
                      [op === 'reveal'
                        ? 'path'
                        : op.includes('detection')
                          ? 'detectionId'
                          : op.includes('setup_cancel')
                            ? 'setupId'
                            : 'projectId']: args[0],
                    }
                  : {};
      return proposeAction(deps, {
        operation: op,
        title: `${op.replaceAll('_', ' ')} project`,
        summary: `Perform ${op.replaceAll('_', ' ')}.`,
        args: shownArgs,
        risk,
        execute: () => deps.invoke(channels[op as keyof typeof channels], ...args),
      });
    },
  });
}

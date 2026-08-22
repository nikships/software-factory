import { IPC } from '@shared/ipc-contract.js';
import { defineTool, type ToolDefinition } from '../pi/tool-definition.js';
import {
  immediate,
  objectField,
  parseOperation,
  proposeAction,
  type SmithActionToolDeps,
  json,
} from './tool-helpers.js';

export const SMITH_SETTINGS_OPERATIONS = [
  'get',
  'patch',
  'catalog_gates',
  'catalog_template_variables',
  'catalog_models',
] as const;

export function smithSettingsTool(deps: SmithActionToolDeps): ToolDefinition {
  return defineTool({
    name: 'smith_settings',
    label: 'Smith settings',
    description:
      'Read or change Foundry settings and catalogs: get, patch(patch), catalog_gates, catalog_template_variables, catalog_models.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...SMITH_SETTINGS_OPERATIONS] },
        patch: { type: 'object' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    execute: async (_id, params) => {
      const op = parseOperation(params, SMITH_SETTINGS_OPERATIONS);
      if (!op) return json({ ok: false, error: 'unknown operation' });
      if (op === 'get') return immediate(deps, IPC.settingsGet);
      if (op === 'catalog_gates') return immediate(deps, IPC.catalogGates);
      if (op === 'catalog_template_variables') return immediate(deps, IPC.catalogTemplateVariables);
      if (op === 'catalog_models') return immediate(deps, IPC.catalogAgentModels);
      const patch = objectField(params, 'patch');
      if (!patch) return json({ ok: false, error: 'patch must be an object' });
      return proposeAction(deps, {
        operation: op,
        title: 'Change settings',
        summary: 'Apply the shown settings patch.',
        args: { patch },
        risk: 'write',
        execute: () => deps.invoke(IPC.settingsPatch, patch),
      });
    },
  });
}

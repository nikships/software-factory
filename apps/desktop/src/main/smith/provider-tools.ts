import { IPC } from '@shared/ipc-contract.js';
import { defineTool, type ToolDefinition } from '../pi/tool-definition.js';
import {
  immediate,
  json,
  parseOperation,
  proposeAction,
  rejectSecretFields,
  stringField,
  type SmithActionToolDeps,
} from './tool-helpers.js';

export const SMITH_PROVIDER_OPERATIONS = [
  'state',
  'stored_keys',
  'connect',
  'disconnect',
  'cancel_login',
  'set_api_key',
  'clear_api_key',
] as const;

export function smithProvidersTool(deps: SmithActionToolDeps): ToolDefinition {
  return defineTool({
    name: 'smith_providers',
    label: 'Smith providers',
    description:
      'Inspect and configure providers: state, stored_keys, connect/disconnect/cancel_login(provider), set_api_key/clear_api_key(providerId). API key values are entered only in the masked approval card.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...SMITH_PROVIDER_OPERATIONS] },
        provider: { type: 'string' },
        providerId: { type: 'string' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    execute: async (_id, params) => {
      const secretError = rejectSecretFields(params);
      if (secretError) return json({ ok: false, error: secretError });
      const op = parseOperation(params, SMITH_PROVIDER_OPERATIONS);
      if (!op) return json({ ok: false, error: 'unknown operation' });
      if (op === 'state') return immediate(deps, IPC.bridgeState);
      if (op === 'stored_keys') return immediate(deps, IPC.bridgeStoredKeys);
      const name =
        op === 'set_api_key' || op === 'clear_api_key'
          ? stringField(params, 'providerId')
          : stringField(params, 'provider');
      if (!name)
        return json({
          ok: false,
          error: `${op.startsWith('set_') || op.startsWith('clear_') ? 'providerId' : 'provider'} is required`,
        });
      const channels = {
        connect: IPC.bridgeConnect,
        disconnect: IPC.bridgeDisconnect,
        cancel_login: IPC.bridgeCancelLogin,
        set_api_key: IPC.bridgeSetApiKey,
        clear_api_key: IPC.bridgeClearApiKey,
      } as const;
      const risk =
        op === 'disconnect' || op === 'set_api_key' || op === 'clear_api_key'
          ? 'credential'
          : op === 'connect'
            ? 'external'
            : 'write';
      return proposeAction(deps, {
        operation: op,
        title: `${op.replaceAll('_', ' ')} provider`,
        summary: `${op.replaceAll('_', ' ')} ${name}.`,
        args: { [op.includes('api_key') ? 'providerId' : 'provider']: name },
        risk,
        ...(op === 'set_api_key'
          ? {
              secretRequest: {
                kind: 'api-key' as const,
                label: `API key for ${name}`,
                placeholder: 'Enter API key',
              },
            }
          : {}),
        execute: (secret) =>
          op === 'set_api_key'
            ? deps.invoke(channels[op], name, secret)
            : deps.invoke(channels[op], name),
      });
    },
  });
}

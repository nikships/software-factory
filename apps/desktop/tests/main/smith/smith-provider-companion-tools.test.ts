import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../src/shared/ipc-contract.js';
import {
  SMITH_PROVIDER_OPERATIONS,
  smithProvidersTool,
} from '../../../src/main/smith/provider-tools.js';
import {
  SMITH_COMPANION_OPERATIONS,
  smithCompanionTool,
} from '../../../src/main/smith/companion-tools.js';
import { ProposalQueue } from '../../../src/main/smith/proposals.js';
import type { MainInvoker } from '../../../src/main/ipc/shared.js';

const json = (r: unknown) =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text);
function setup(kind: 'provider' | 'companion', reply: unknown = 'ok') {
  const invoke = vi.fn().mockResolvedValue(reply);
  const queue = new ProposalQueue(
    () => {},
    async () => ({ ok: true, entity: {} }),
  );
  const deps = { invoke: invoke as MainInvoker, queue, projectId: () => undefined };
  const tool = kind === 'provider' ? smithProvidersTool(deps) : smithCompanionTool(deps);
  return {
    invoke,
    queue,
    tool,
    execute: (p: unknown) =>
      (tool.execute as unknown as (id: string, p: unknown) => Promise<unknown>)('id', p),
  };
}

describe('Smith provider and Companion tools', () => {
  it.each([
    ['provider', SMITH_PROVIDER_OPERATIONS],
    ['companion', SMITH_COMPANION_OPERATIONS],
  ] as const)('recognizes all exported %s operations', async (kind, operations) => {
    expect(
      (setup(kind).tool.parameters as { properties: { operation: unknown } }).properties.operation,
    ).toMatchObject({
      enum: [...operations],
    });
  });

  it.each(['apiKey', 'api_key', 'key', 'token', 'secret'])(
    'rejects API secret argument field %s',
    async (field) => {
      const h = setup('provider');
      expect(
        json(
          await h.execute({
            operation: 'set_api_key',
            providerId: 'openai',
            [field]: 'TOP-SECRET',
          }),
        ),
      ).toMatchObject({ ok: false, error: expect.stringContaining('masked approval card') });
      expect(h.queue.list()).toHaveLength(0);
    },
  );

  it('keeps an API key out of proposal/model serialization and passes it only after approval', async () => {
    const h = setup('provider');
    const promise = h.execute({ operation: 'set_api_key', providerId: 'openai' });
    await vi.waitFor(() => expect(h.queue.list()).toHaveLength(1));
    const proposal = h.queue.list()[0]!;
    expect(proposal).toMatchObject({
      args: { providerId: 'openai' },
      risk: 'credential',
      secretRequest: { kind: 'api-key' },
    });
    expect(JSON.stringify(proposal)).not.toContain('TOP-SECRET');
    expect(h.invoke).not.toHaveBeenCalled();
    await h.queue.answer(proposal.id, { approved: true, secret: 'TOP-SECRET' });
    expect(h.invoke).toHaveBeenCalledWith(IPC.bridgeSetApiKey, 'openai', 'TOP-SECRET');
    expect(JSON.stringify(json(await promise))).not.toContain('TOP-SECRET');
  });

  it('never passes a rejected API key to the invoker', async () => {
    const h = setup('provider');
    const promise = h.execute({ operation: 'set_api_key', providerId: 'openai' });
    await vi.waitFor(() => expect(h.queue.list()).toHaveLength(1));
    await h.queue.answer(h.queue.list()[0]!.id, { approved: false, secret: 'TOP-SECRET' });
    expect(json(await promise)).toEqual({ ok: false, rejected: true });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['connect', 'provider'],
    ['disconnect', 'provider'],
    ['set_api_key', 'providerId'],
    ['clear_api_key', 'providerId'],
  ])('validates provider %s argument', async (operation, name) => {
    expect(json(await setup('provider').execute({ operation }))).toEqual({
      ok: false,
      error: `${name} is required`,
    });
  });

  it('separates Companion pairing model result from private display', async () => {
    const payload = { url: 'https://pair', token: 'PAIR-SECRET', expiresAt: 'later' };
    const h = setup('companion', payload);
    const promise = h.execute({ operation: 'pairing', refresh: true });
    await vi.waitFor(() => expect(h.queue.list()).toHaveLength(1));
    expect(JSON.stringify(h.queue.list()[0])).not.toContain('PAIR-SECRET');
    const answer = await h.queue.answer(h.queue.list()[0]!.id, { approved: true });
    expect(answer).toEqual({ ok: true, privateDisplay: { kind: 'companion-pairing', payload } });
    expect(h.invoke).toHaveBeenCalledWith(IPC.companionPairingPayload, { refresh: true });
    const model = json(await promise);
    expect(model).toEqual({ ok: true, available: true });
    expect(JSON.stringify(model)).not.toContain('PAIR-SECRET');
  });
});

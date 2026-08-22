import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../src/shared/ipc-contract.js';
import { SMITH_RUN_OPERATIONS, smithRunsTool } from '../../../src/main/smith/run-tools.js';
import { SMITH_PR_OPERATIONS, smithPrsTool } from '../../../src/main/smith/pr-tools.js';
import { ProposalQueue } from '../../../src/main/smith/proposals.js';
import type { MainInvoker } from '../../../src/main/ipc/shared.js';

const json = (r: unknown) =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text);
function setup(kind: 'runs' | 'prs', projectId: string | null = 'session') {
  const invoke = vi.fn().mockResolvedValue('normalized');
  const queue = new ProposalQueue(
    () => {},
    async () => ({ ok: true, entity: {} }),
  );
  const deps = { invoke: invoke as MainInvoker, queue, projectId: () => projectId ?? undefined };
  const tool = kind === 'runs' ? smithRunsTool(deps) : smithPrsTool(deps);
  return {
    invoke,
    queue,
    tool,
    execute: (p: unknown) =>
      (tool.execute as unknown as (id: string, p: unknown) => Promise<unknown>)('id', p),
  };
}
async function approve(h: ReturnType<typeof setup>, params: Record<string, unknown>) {
  const promise = h.execute(params);
  await vi.waitFor(() => expect(h.queue.list()).toHaveLength(1));
  await h.queue.answer(h.queue.list()[0]!.id, { approved: true });
  return json(await promise);
}

describe('Smith run and PR tools', () => {
  it.each([
    ['runs', SMITH_RUN_OPERATIONS],
    ['prs', SMITH_PR_OPERATIONS],
  ] as const)('recognizes all %s operations', async (kind, operations) => {
    expect(
      (setup(kind).tool.parameters as { properties: { operation: unknown } }).properties.operation,
    ).toMatchObject({
      enum: [...operations],
    });
  });

  it.each(['runs', 'prs'] as const)(
    'requires an explicit project in global %s scope',
    async (kind) => {
      expect(json(await setup(kind, null).execute({ operation: 'list' }))).toEqual({
        ok: false,
        error: 'projectId is required in All projects scope',
      });
    },
  );

  it('defaults run reads to the session project and uses exact argument order', async () => {
    const h = setup('runs');
    expect(json(await h.execute({ operation: 'events', runId: 'r1', afterChangeId: 7 }))).toEqual({
      ok: true,
      result: 'normalized',
    });
    expect(h.invoke).toHaveBeenCalledWith(IPC.runsEvents, 'session', 'r1', 7);
    await h.execute({ operation: 'live_tail', phaseId: 'ph1' });
    expect(h.invoke).toHaveBeenLastCalledWith(IPC.runsLiveTail, 'ph1');
  });

  it.each([
    ['detail', {}, 'runId'],
    ['events', { runId: 'r' }, 'afterChangeId'],
    ['context', { runId: 'r' }, 'agent'],
    ['start', {}, 'pipelineId and request'],
    ['archive', { runId: 'r' }, 'archived'],
  ])('validates run %s arguments', async (operation, args, error) => {
    expect(json(await setup('runs').execute({ operation, ...args }))).toMatchObject({
      ok: false,
      error: expect.stringContaining(error),
    });
  });

  it.each([
    [
      'start',
      { pipelineId: 'pipe', request: 'do it' },
      IPC.runsStart,
      [{ projectId: 'session', pipelineId: 'pipe', request: 'do it' }],
    ],
    ['archive', { runId: 'r', archived: false }, IPC.runsArchive, ['session', 'r', false]],
    ['merge', { runId: 'r' }, IPC.runsMergeWorktree, ['session', 'r']],
  ])('gates run %s and invokes exact channel', async (operation, args, channel, expected) => {
    const h = setup('runs');
    expect(await approve(h, { operation, ...args })).toEqual({ ok: true, result: 'normalized' });
    expect(h.invoke).toHaveBeenCalledWith(channel, ...expected);
  });

  it('covers PR immediate and gated channels', async () => {
    const h = setup('prs');
    expect(json(await h.execute({ operation: 'status' }))).toEqual({
      ok: true,
      result: 'normalized',
    });
    expect(h.invoke).toHaveBeenCalledWith(IPC.prsStatus, 'session');
    expect(await approve(h, { operation: 'create', runId: 'r', title: 'T', body: 'B' })).toEqual({
      ok: true,
      result: 'normalized',
    });
    expect(h.invoke).toHaveBeenLastCalledWith(IPC.prsCreate, 'session', 'r', 'T', 'B');
  });

  it.each([
    ['create', {}, 'runId, title, and body'],
    ['merge', {}, 'prNumber'],
    ['merge', { prNumber: 4, method: 'rebase' }, 'method must be merge or squash'],
    ['fix_conflicts', {}, 'prNumber'],
  ])('validates PR %s arguments', async (operation, args, error) => {
    expect(json(await setup('prs').execute({ operation, ...args }))).toMatchObject({
      ok: false,
      error: expect.stringContaining(error),
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../src/shared/ipc-contract.js';
import { SMITH_SYSTEM_OPERATIONS, smithSystemTool } from '../../../src/main/smith/system-tools.js';
import {
  SMITH_INTERRUPT_OPERATIONS,
  smithInterruptsTool,
} from '../../../src/main/smith/interrupt-tools.js';
import { ProposalQueue } from '../../../src/main/smith/proposals.js';
import type { MainInvoker } from '../../../src/main/ipc/shared.js';

const json = (r: unknown) =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text);
function setup(kind: 'system' | 'interrupt', reply: unknown = 'value') {
  const invoke = vi.fn().mockResolvedValue(reply === null ? undefined : reply);
  const queue = new ProposalQueue(
    () => {},
    async () => ({ ok: true, entity: {} }),
  );
  const deps = { invoke: invoke as MainInvoker, queue, projectId: () => undefined };
  const tool = kind === 'system' ? smithSystemTool(deps) : smithInterruptsTool(deps);
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
  const proposal = h.queue.list()[0]!;
  await h.queue.answer(proposal.id, { approved: true });
  return { proposal, output: json(await promise) };
}

describe('Smith system and interrupt tools', () => {
  it.each([
    ['system', SMITH_SYSTEM_OPERATIONS],
    ['interrupt', SMITH_INTERRUPT_OPERATIONS],
  ] as const)('recognizes every exported %s operation', async (kind, operations) => {
    expect(
      (setup(kind).tool.parameters as { properties: { operation: unknown } }).properties.operation,
    ).toMatchObject({
      enum: [...operations],
    });
  });

  it.each([
    ['doctor', IPC.doctorRun],
    ['orphans', IPC.maintenanceOrphans],
    ['version', IPC.appVersion],
    ['update_status', IPC.updaterGetStatus],
  ])('runs immediate system %s and normalizes results', async (operation, channel) => {
    const h = setup('system', null);
    expect(json(await h.execute({ operation }))).toEqual({ ok: true, result: null });
    expect(h.invoke).toHaveBeenCalledWith(channel);
    expect(h.queue.list()).toHaveLength(0);
  });

  it.each([
    ['remove_orphan', {}, 'projectId and path'],
    ['open_external', {}, 'url'],
  ])('validates system %s arguments', async (operation, args, error) => {
    expect(json(await setup('system').execute({ operation, ...args }))).toEqual({
      ok: false,
      error: `${error} are required`.replace('url are', 'url is'),
    });
  });

  it.each([
    [
      'remove_orphan',
      { projectId: 'p', path: '/worktree' },
      IPC.maintenanceRemoveWorktree,
      ['p', '/worktree'],
    ],
    [
      'open_external',
      { url: 'https://example.test' },
      IPC.appOpenExternal,
      ['https://example.test'],
    ],
    ['update_download', {}, IPC.updaterDownload, []],
    ['quit', {}, IPC.appQuit, []],
  ])('gates system %s with exact channel order', async (operation, args, channel, expected) => {
    const h = setup('system');
    const { output } = await approve(h, { operation, ...args });
    expect(h.invoke).toHaveBeenCalledWith(channel, ...expected);
    expect(output).toEqual({ ok: true, result: 'value' });
  });

  it('lists interrupts immediately', async () => {
    const h = setup('interrupt', []);
    expect(json(await h.execute({ operation: 'list' }))).toEqual({ ok: true, result: [] });
    expect(h.invoke).toHaveBeenCalledWith(IPC.interruptsList);
  });

  it.each([
    [{}, 'interruptId and a valid decision are required'],
    [{ interruptId: 'i1', decision: 'maybe' }, 'interruptId and a valid decision are required'],
    [{ interruptId: 'i1', decision: 'approve', text: 3 }, 'text must be a string'],
  ])('validates interrupt answer arguments', async (args, error) => {
    expect(json(await setup('interrupt').execute({ operation: 'answer', ...args }))).toEqual({
      ok: false,
      error,
    });
  });

  it('includes matched interrupt data in the approval card and sends only the answer', async () => {
    const interrupt = { interruptId: 'i1', runId: 'r1', runTitle: 'Release', question: 'Proceed?' };
    const h = setup('interrupt', [interrupt]);
    const promise = h.execute({
      operation: 'answer',
      interruptId: 'i1',
      decision: 'approve',
      text: 'ship it',
    });
    await vi.waitFor(() => expect(h.queue.list()).toHaveLength(1));
    const proposal = h.queue.list()[0]!;
    expect(proposal).toMatchObject({
      args: { interruptId: 'i1', decision: 'approve', text: 'ship it', interrupt },
    });
    await h.queue.answer(proposal.id, { approved: true });
    expect(h.invoke).toHaveBeenNthCalledWith(1, IPC.interruptsList);
    expect(h.invoke).toHaveBeenNthCalledWith(2, IPC.interruptsAnswer, {
      interruptId: 'i1',
      decision: 'approve',
      text: 'ship it',
    });
    expect(json(await promise)).toEqual({ ok: true, result: [interrupt] });
  });
});

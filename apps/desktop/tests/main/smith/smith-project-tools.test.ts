import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../src/shared/ipc-contract.js';
import {
  SMITH_PROJECT_OPERATIONS,
  smithProjectsTool,
} from '../../../src/main/smith/project-tools.js';
import { ProposalQueue } from '../../../src/main/smith/proposals.js';
import type { MainInvoker } from '../../../src/main/ipc/shared.js';

const result = (value: unknown) =>
  JSON.parse((value as { content: Array<{ text: string }> }).content[0]!.text);
function harness(reply: unknown = 'done') {
  const invoke = vi.fn().mockResolvedValue(reply === null ? undefined : reply);
  const queue = new ProposalQueue(
    () => {},
    async () => ({ ok: true, entity: {} }),
  );
  const tool = smithProjectsTool({
    invoke: invoke as MainInvoker,
    queue,
    projectId: () => 'session-project',
  });
  const execute = (params: unknown) =>
    (tool.execute as unknown as (id: string, params: unknown) => Promise<unknown>)('call', params);
  return { invoke, queue, execute, tool };
}
async function approve(h: ReturnType<typeof harness>, params: Record<string, unknown>) {
  const pending = h.execute(params);
  await vi.waitFor(() => expect(h.queue.list()).toHaveLength(1));
  const proposal = h.queue.list()[0]!;
  await h.queue.answer(proposal.id, { approved: true });
  return { proposal, output: result(await pending) };
}

describe('smith_projects', () => {
  it('recognizes every exported operation and rejects unknown operations', async () => {
    const h = harness();
    expect(
      (h.tool.parameters as { properties: { operation: unknown } }).properties.operation,
    ).toMatchObject({
      enum: [...SMITH_PROJECT_OPERATIONS],
    });
    expect(result(await h.execute({ operation: 'arbitrary' }))).toEqual({
      ok: false,
      error: 'unknown operation',
    });
  });

  it.each([
    ['show', 'projectId'],
    ['create_github', 'input'],
    ['save', 'project'],
    ['remove', 'projectId'],
    ['try_command', 'projectId and argv'],
    ['cancel_detection', 'detectionId'],
    ['setup_save', 'projectId and script'],
    ['setup_cancel', 'setupId'],
    ['reveal', 'path'],
    ['base_sync', 'projectId'],
  ])('validates %s required arguments', async (operation, message) => {
    expect(result(await harness().execute({ operation }))).toMatchObject({
      ok: false,
      error: expect.stringContaining(message),
    });
  });

  it.each([
    ['list', {}, IPC.projectsList, []],
    ['github_account', {}, IPC.projectsGithubAccount, []],
    ['detection', { detectionId: 'd1' }, IPC.projectsDetection, ['d1']],
    ['setup_get', { projectId: 'p1' }, IPC.projectsSetupScriptGet, ['p1']],
    ['check', { projectId: 'p1' }, IPC.projectsCheck, ['p1']],
  ])('executes immediate %s on the exact channel', async (operation, args, channel, expected) => {
    const h = harness(null);
    expect(result(await h.execute({ operation, ...args }))).toEqual({ ok: true, result: null });
    expect(h.invoke).toHaveBeenCalledWith(channel, ...expected);
    expect(h.queue.list()).toHaveLength(0);
  });

  it('shows a project by exact id and normalizes its result', async () => {
    const h = harness([{ id: 'p1' }, { id: 'p2', name: 'Two' }]);
    expect(result(await h.execute({ operation: 'show', projectId: 'p2' }))).toEqual({
      ok: true,
      result: { id: 'p2', name: 'Two' },
    });
    expect(h.invoke).toHaveBeenCalledWith(IPC.projectsList);
  });

  it.each([
    ['add', {}, IPC.projectsAdd, []],
    ['create_github', { input: { name: 'repo' } }, IPC.projectsCreateGithub, [{ name: 'repo' }]],
    [
      'try_command',
      { projectId: 'p1', argv: ['npm', 'test'] },
      IPC.projectsTryCommand,
      ['p1', ['npm', 'test']],
    ],
    ['setup_save', { projectId: 'p1', script: '' }, IPC.projectsSetupScriptSave, ['p1', '']],
    ['base_sync', { projectId: 'p1' }, IPC.projectsBaseSync, ['p1']],
  ])(
    'gates %s and preserves channel argument order',
    async (operation, args, channel, expected) => {
      const h = harness({ changed: true });
      const { output } = await approve(h, { operation, ...args });
      expect(h.invoke).toHaveBeenCalledWith(channel, ...expected);
      expect(output).toEqual({ ok: true, result: { changed: true } });
    },
  );

  it('does not invoke a rejected proposal', async () => {
    const h = harness();
    const pending = h.execute({ operation: 'remove', projectId: 'p1' });
    await vi.waitFor(() => expect(h.queue.list()).toHaveLength(1));
    await h.queue.answer(h.queue.list()[0]!.id, { approved: false, note: 'no' });
    expect(result(await pending)).toEqual({ ok: false, rejected: true, note: 'no' });
    expect(h.invoke).not.toHaveBeenCalled();
  });
});

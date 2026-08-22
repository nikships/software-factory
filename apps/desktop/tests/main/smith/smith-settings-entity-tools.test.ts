import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../src/shared/ipc-contract.js';
import {
  SMITH_SETTINGS_OPERATIONS,
  smithSettingsTool,
} from '../../../src/main/smith/settings-tools.js';
import {
  SMITH_ENTITY_OPERATIONS,
  smithEntitiesTool,
} from '../../../src/main/smith/entity-action-tools.js';
import { ProposalQueue } from '../../../src/main/smith/proposals.js';
import type { MainInvoker } from '../../../src/main/ipc/shared.js';

const json = (r: unknown) =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text);
function setup(kind: 'settings' | 'entities', projectId: string | null = 'session') {
  const invoke = vi.fn().mockResolvedValue(undefined);
  const queue = new ProposalQueue(
    () => {},
    async () => ({ ok: true, entity: {} }),
  );
  const deps = { invoke: invoke as MainInvoker, queue, projectId: () => projectId ?? undefined };
  const tool = kind === 'settings' ? smithSettingsTool(deps) : smithEntitiesTool(deps);
  return {
    invoke,
    queue,
    tool,
    execute: (p: unknown) =>
      (tool.execute as unknown as (id: string, p: unknown) => Promise<unknown>)('id', p),
  };
}
async function decide(
  h: ReturnType<typeof setup>,
  params: Record<string, unknown>,
  approved = true,
) {
  const promise = h.execute(params);
  await vi.waitFor(() => expect(h.queue.list()).toHaveLength(1));
  const proposal = h.queue.list()[0]!;
  await h.queue.answer(proposal.id, { approved });
  return { proposal, output: json(await promise) };
}

describe('Smith settings and entity actions', () => {
  it.each([
    ['settings', SMITH_SETTINGS_OPERATIONS],
    ['entities', SMITH_ENTITY_OPERATIONS],
  ] as const)('recognizes all exported %s operations', async (kind, operations) => {
    expect(
      (setup(kind).tool.parameters as { properties: { operation: unknown } }).properties.operation,
    ).toMatchObject({
      enum: [...operations],
    });
  });

  it.each([
    ['get', IPC.settingsGet],
    ['catalog_gates', IPC.catalogGates],
    ['catalog_template_variables', IPC.catalogTemplateVariables],
    ['catalog_models', IPC.catalogAgentModels],
  ])('executes immediate settings %s', async (operation, channel) => {
    const h = setup('settings');
    expect(json(await h.execute({ operation }))).toEqual({ ok: true, result: null });
    expect(h.invoke).toHaveBeenCalledWith(channel);
  });

  it('validates and gates settings patches', async () => {
    expect(json(await setup('settings').execute({ operation: 'patch', patch: [] }))).toEqual({
      ok: false,
      error: 'patch must be an object',
    });
    const h = setup('settings');
    const { output } = await decide(h, { operation: 'patch', patch: { retentionDays: 3 } });
    expect(h.invoke).toHaveBeenCalledWith(IPC.settingsPatch, { retentionDays: 3 });
    expect(output).toEqual({ ok: true, result: null });
  });

  it.each([
    [{ ok: false, detail: 'settings were rejected' }, 'settings were rejected'],
    [{ error: 'settings were invalid' }, 'settings were invalid'],
    [false, 'action returned false'],
  ])('turns a returned handler failure into a failed action result', async (result, error) => {
    const h = setup('settings');
    h.invoke.mockResolvedValue(result);
    const { output } = await decide(h, {
      operation: 'patch',
      patch: { retentionDays: 3 },
    });

    expect(output).toEqual({ ok: false, error });
    expect(h.queue.list()).toEqual([]);
  });

  it.each([
    ['agent_validate', {}, 'agent'],
    ['agent_rename', {}, 'from and to'],
    ['agent_remove', {}, 'name'],
    ['envelope_validate', {}, 'definition'],
    ['pipeline_validate', {}, 'pipeline'],
    ['pipeline_dry_run', { projectId: 'p' }, 'pipelineId, projectId, and request'],
    ['pipeline_remove', {}, 'id'],
  ])('validates entity %s arguments', async (operation, args, error) => {
    expect(json(await setup('entities').execute({ operation, ...args }))).toMatchObject({
      ok: false,
      error: expect.stringContaining(error),
    });
  });

  it('uses session defaults, permits global roster scope, and requires global dry-run scope', async () => {
    const local = setup('entities');
    await local.execute({ operation: 'agent_stale' });
    expect(local.invoke).toHaveBeenCalledWith(IPC.rosterStaleBuiltins, 'session');
    const global = setup('entities', null);
    await global.execute({ operation: 'agent_stale' });
    expect(global.invoke).toHaveBeenCalledWith(IPC.rosterStaleBuiltins, undefined);
    expect(
      json(await global.execute({ operation: 'pipeline_dry_run', pipelineId: 'p', request: 'r' })),
    ).toEqual({ ok: false, error: 'projectId is required in All projects scope' });
  });

  it('reads upload bytes only after approval and never exposes them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'smith-mark-'));
    const path = join(dir, 'mark.png');
    const bytes = 'private image bytes';
    const h = setup('entities');
    const pending = h.execute({ operation: 'agent_upload_mark', filePath: path });
    await vi.waitFor(() => expect(h.queue.list()).toHaveLength(1));
    const proposal = h.queue.list()[0]!;
    expect(JSON.stringify(proposal)).not.toContain(bytes);
    await expect(readFile(path)).rejects.toThrow();
    await writeFile(path, bytes);
    await h.queue.answer(proposal.id, { approved: true });
    const output = json(await pending);
    expect(h.invoke).toHaveBeenCalledWith(
      IPC.rosterUploadMark,
      Buffer.from(bytes).toString('base64'),
      'image/png',
    );
    expect(JSON.stringify(output)).not.toContain(bytes);
    expect(JSON.stringify(output)).not.toContain(Buffer.from(bytes).toString('base64'));
  });

  it('does not read or invoke a rejected upload', async () => {
    const h = setup('entities');
    const { output } = await decide(
      h,
      { operation: 'agent_upload_mark', filePath: '/missing/mark.png' },
      false,
    );
    expect(output).toEqual({ ok: false, rejected: true });
    expect(h.invoke).not.toHaveBeenCalled();
  });
});

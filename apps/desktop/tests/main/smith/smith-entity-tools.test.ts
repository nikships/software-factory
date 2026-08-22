/**
 * Smith's entity tools, called the way the runtime calls them.
 *
 * These are the in-process successors to the socket server's `dispatch()`, so
 * the same load-bearing rules are asserted at this layer: validation runs
 * BEFORE any card — an invalid propose comes straight back as JSON with
 * nothing enqueued; only a valid spec reaches the proposal queue and blocks.
 * Reads answer from the stores immediately. Projects expose their full
 * definitions. Overwrite is decided by whether the store already
 * has the name/id.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AgentDef, EnvelopeDef, PipelineDef } from '../../../src/shared/types.js';
import { ProposalQueue } from '../../../src/main/smith/proposals.js';
import {
  SMITH_TOOL_NAMES,
  smithListTool,
  smithProposeTool,
  smithShowTool,
  type SmithEntityStores,
  type SmithEntityToolDeps,
} from '../../../src/main/smith/entity-tools.js';

const validAgent: AgentDef = {
  name: 'planner',
  purpose: 'Plan the work.',
  model: 'inherit',
  reasoningEffort: 'medium',
  systemPrompt: 'You plan.',
  userPrompt: 'Work on: {{request}}',
  writes: [],
  envelope: 'plan',
  color: '#5ad2dd',
};

/**
 * A project as the store holds it: far more than the tools may hand out, so
 * the projection assertion below is meaningful.
 */
const storedProject = {
  id: 'proj_1a2b',
  name: 'Foundry',
  path: '/Users/nik/code/foundry',
  baseRef: 'main',
  isolation: true,
  mergePolicy: 'manual',
  commands: [{ name: 'test', argv: ['npm', 'test'] }],
  protectedPaths: ['.github/'],
  ownRoster: false,
  ownPipelines: false,
  setupScript: 'npm ci',
  addedAt: '2026-08-01T00:00:00.000Z',
};

const validPipeline: PipelineDef = {
  id: 'ship-it',
  name: 'Ship it',
  description: 'A one-phase pipeline for tool tests.',
  acceptance: { kind: 'all_phases_pass' },
  phases: [
    {
      name: 'plan',
      kind: 'agent',
      description: 'Plan the work.',
      agent: 'planner',
      prompt: { inputs: ['request'] },
    },
  ],
};

const validEnvelope: EnvelopeDef = {
  name: 'severity_report',
  description: 'A severity-tagged report',
  fields: [{ name: 'severity', type: 'string', required: true, description: 'low|med|high' }],
};

/** A store-shaped slice with just what the tools read; agents seed the roster. */
function makeStores(
  seed: AgentDef[] = [],
  extras: { pipelines?: PipelineDef[]; envelopes?: EnvelopeDef[] } = {},
): SmithEntityStores {
  const agents = [...seed];
  const pipelines = [...(extras.pipelines ?? [])];
  const envelopes = [...(extras.envelopes ?? [])];
  return {
    roster: { get: (name: string) => agents.find((a) => a.name === name) ?? null },
    pipelines: { get: (id: string) => pipelines.find((p) => p.id === id) ?? null },
    envelopes: {
      list: () => envelopes,
      get: (name: string) => envelopes.find((e) => e.name === name) ?? null,
    },
    projects: { list: () => [storedProject] },
    rosterScope: () => ({}),
    pipelineScope: () => ({}),
    rosterFor: () => agents,
    pipelinesFor: () => pipelines,
    commandNames: () => [],
  } as unknown as SmithEntityStores;
}

function makeDeps(stores = makeStores()): { deps: SmithEntityToolDeps; queue: ProposalQueue } {
  const queue = new ProposalQueue(
    () => {},
    async (p) => ({ ok: true, entity: p.spec }),
  );
  return { deps: { stores, queue, projectId: () => undefined }, queue };
}

/** The runtime hands `execute` a call id, the args, and context it may ignore. */
function call(
  tool: { execute: (...args: never[]) => unknown },
  params: unknown,
): Promise<{ content: { type: string; text: string }[] }> {
  const execute = tool.execute as unknown as (
    id: string,
    params: unknown,
    signal: undefined,
    onUpdate: undefined,
    ctx: undefined,
  ) => Promise<{ content: { type: string; text: string }[] }>;
  return execute('call-1', params, undefined, undefined, undefined);
}

async function answerOf(tool: Parameters<typeof call>[0], params: unknown): Promise<unknown> {
  const result = await call(tool, params);
  return JSON.parse(result.content.map((block) => block.text).join(''));
}

describe('the Smith entity tool set', () => {
  it('is exactly the three tools the chat session registers', () => {
    expect([...SMITH_TOOL_NAMES]).toEqual(['smith_list', 'smith_show', 'smith_propose']);
  });

  it('declares a schema on every tool, so the runtime validates before executing', () => {
    const { deps } = makeDeps();
    for (const tool of [smithListTool(deps), smithShowTool(deps), smithProposeTool(deps)]) {
      expect(tool.parameters, `${tool.name} must carry a schema`).toBeDefined();
      expect((tool.parameters as { type?: string }).type).toBe('object');
    }
  });
});

describe('smith_list / smith_show', () => {
  it('lists entities from the store without approval', async () => {
    const { deps } = makeDeps(makeStores([validAgent]));
    expect(await answerOf(smithListTool(deps), { kind: 'agent' })).toEqual({
      ok: true,
      kind: 'agent',
      entities: [validAgent],
    });
  });

  it('shows a named entity, or errors when it is absent', async () => {
    const { deps } = makeDeps(makeStores([validAgent]));
    const tool = smithShowTool(deps);
    expect(await answerOf(tool, { kind: 'agent', name: 'planner' })).toEqual({
      ok: true,
      kind: 'agent',
      entity: validAgent,
    });
    expect(await answerOf(tool, { kind: 'agent', name: 'ghost' })).toEqual({
      ok: false,
      error: 'no agent named "ghost"',
    });
  });

  it('lists full project definitions', async () => {
    const { deps } = makeDeps();
    expect(await answerOf(smithListTool(deps), { kind: 'project' })).toEqual({
      ok: true,
      kind: 'project',
      entities: [storedProject],
    });
  });

  it('shows a project by exact id without raising a card', async () => {
    const { deps, queue } = makeDeps();
    const proposeSpy = vi.spyOn(queue, 'propose');
    const res = (await answerOf(smithShowTool(deps), {
      kind: 'project',
      name: 'proj_1a2b',
    })) as { ok: boolean; error: string };
    expect(res).toEqual({ ok: true, kind: 'project', entity: storedProject });
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(queue.list()).toHaveLength(0);
  });

  it('errors on an unknown kind rather than guessing', async () => {
    const { deps } = makeDeps();
    expect(await answerOf(smithListTool(deps), { kind: 'run' })).toEqual({
      ok: false,
      error: 'unknown kind',
    });
    expect(await answerOf(smithShowTool(deps), { kind: 'run', name: 'x' })).toEqual({
      ok: false,
      error: 'unknown kind',
    });
  });

  it('lists and shows pipelines and envelopes from the store', async () => {
    const { deps } = makeDeps(
      makeStores([validAgent], { pipelines: [validPipeline], envelopes: [validEnvelope] }),
    );
    expect(await answerOf(smithListTool(deps), { kind: 'pipeline' })).toEqual({
      ok: true,
      kind: 'pipeline',
      entities: [validPipeline],
    });
    expect(await answerOf(smithShowTool(deps), { kind: 'pipeline', name: 'ship-it' })).toEqual({
      ok: true,
      kind: 'pipeline',
      entity: validPipeline,
    });
    expect(await answerOf(smithListTool(deps), { kind: 'envelope' })).toEqual({
      ok: true,
      kind: 'envelope',
      entities: [validEnvelope],
    });
    expect(
      await answerOf(smithShowTool(deps), { kind: 'envelope', name: 'severity_report' }),
    ).toEqual({
      ok: true,
      kind: 'envelope',
      entity: validEnvelope,
    });
  });

  it('refuses a show with no name, raising no card', async () => {
    const { deps, queue } = makeDeps();
    expect(await answerOf(smithShowTool(deps), { kind: 'agent', name: '' })).toEqual({
      ok: false,
      error: 'show needs a name',
    });
    expect(queue.list()).toHaveLength(0);
  });

  it('reads the session project id per call rather than capturing it', async () => {
    const seen: Array<string | undefined> = [];
    const stores = makeStores([validAgent]);
    stores.rosterFor = (projectId) => {
      seen.push(projectId);
      return [validAgent];
    };
    let projectId: string | undefined = 'proj_scope';
    const queue = new ProposalQueue(
      () => {},
      async (p) => ({ ok: true, entity: p.spec }),
    );
    const deps: SmithEntityToolDeps = { stores, queue, projectId: () => projectId };
    await answerOf(smithListTool(deps), { kind: 'agent' });
    projectId = 'proj_other';
    await answerOf(smithListTool(deps), { kind: 'agent' });
    expect(seen).toEqual(['proj_scope', 'proj_other']);
  });
});

describe('smith_propose', () => {
  it('refuses an invalid create before raising a card', async () => {
    const { deps, queue } = makeDeps();
    const proposeSpy = vi.spyOn(queue, 'propose');

    const res = (await answerOf(smithProposeTool(deps), {
      kind: 'agent',
      mode: 'create',
      spec: { ...validAgent, name: 'Bad Name', color: 'red' },
    })) as { ok: boolean; validation?: unknown[] };

    expect(res.ok).toBe(false);
    expect(res.validation?.length).toBeTruthy();
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it('enqueues a valid create and resolves with the saved entity on approve', async () => {
    const { deps, queue } = makeDeps();
    const pending = answerOf(smithProposeTool(deps), {
      kind: 'agent',
      mode: 'create',
      spec: validAgent,
    });

    // The valid spec is now pending a human decision.
    await vi.waitFor(() => expect(queue.list()).toHaveLength(1));
    const proposal = queue.list()[0]!;
    expect(proposal.type).toBe('entity');
    if (proposal.type !== 'entity') throw new Error('expected entity proposal');
    expect(proposal.mode).toBe('create');
    expect(proposal.overwrites).toBe(false);

    await queue.answer(proposal.id, { approved: true });
    await expect(pending).resolves.toEqual({ ok: true, entity: validAgent });
  });

  it('marks an edit of an existing agent as an overwrite, and a reject settles it', async () => {
    const { deps, queue } = makeDeps(makeStores([validAgent]));
    const pending = answerOf(smithProposeTool(deps), {
      kind: 'agent',
      mode: 'edit',
      spec: { ...validAgent, purpose: 'Plan more.' },
    });

    await vi.waitFor(() => expect(queue.list()).toHaveLength(1));
    const proposal = queue.list()[0]!;
    expect(proposal.type).toBe('entity');
    if (proposal.type !== 'entity') throw new Error('expected entity proposal');
    expect(proposal.mode).toBe('edit');
    expect(proposal.overwrites).toBe(true);

    // Rejection carries no note: the next chat message is the guidance.
    await queue.answer(proposal.id, { approved: false });
    await expect(pending).resolves.toEqual({ ok: false, rejected: true });
  });

  it('returns proposal_pending when a second write races a pending one', async () => {
    const { deps, queue } = makeDeps();
    const tool = smithProposeTool(deps);
    const first = answerOf(tool, { kind: 'agent', mode: 'create', spec: validAgent });
    await vi.waitFor(() => expect(queue.list()).toHaveLength(1));

    expect(
      await answerOf(tool, {
        kind: 'agent',
        mode: 'create',
        spec: { ...validAgent, name: 'builder' },
      }),
    ).toEqual({ ok: false, error: 'proposal_pending' });

    await queue.answer(queue.list()[0]!.id, { approved: false });
    await first;
  });

  it('rejects a write with no spec object', async () => {
    const { deps } = makeDeps();
    expect(await answerOf(smithProposeTool(deps), { kind: 'agent', mode: 'create' })).toEqual({
      ok: false,
      error: 'propose needs a spec object',
    });
  });

  it('rejects a bad mode', async () => {
    const { deps } = makeDeps();
    expect(
      await answerOf(smithProposeTool(deps), { kind: 'agent', mode: 'delete', spec: validAgent }),
    ).toEqual({ ok: false, error: 'mode must be "create" or "edit"' });
  });

  it('refuses a project write even past the schema, raising no card', async () => {
    const { deps, queue } = makeDeps();
    const proposeSpy = vi.spyOn(queue, 'propose');
    const res = (await answerOf(smithProposeTool(deps), {
      kind: 'project',
      mode: 'create',
      spec: {},
    })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('read-only');
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(queue.list()).toHaveLength(0);
  });

  it('reports a spec missing its name', async () => {
    const { deps } = makeDeps();
    expect(
      await answerOf(smithProposeTool(deps), {
        kind: 'agent',
        mode: 'create',
        spec: { ...validAgent, name: undefined },
      }),
    ).toEqual({ ok: false, error: 'agent spec is missing its name' });
  });

  it('enqueues a valid pipeline and a valid envelope', async () => {
    const { deps, queue } = makeDeps(makeStores([validAgent]));
    const tool = smithProposeTool(deps);

    const pipePending = answerOf(tool, { kind: 'pipeline', mode: 'create', spec: validPipeline });
    await vi.waitFor(() => expect(queue.list()).toHaveLength(1));
    expect(queue.list()[0]).toMatchObject({ kind: 'pipeline', name: 'ship-it', mode: 'create' });
    await queue.answer(queue.list()[0]!.id, { approved: true });
    await expect(pipePending).resolves.toEqual({ ok: true, entity: validPipeline });

    const envPending = answerOf(tool, { kind: 'envelope', mode: 'create', spec: validEnvelope });
    await vi.waitFor(() => expect(queue.list()).toHaveLength(1));
    expect(queue.list()[0]).toMatchObject({
      kind: 'envelope',
      name: 'severity_report',
      overwrites: false,
    });
    await queue.answer(queue.list()[0]!.id, { approved: false });
    await expect(envPending).resolves.toEqual({ ok: false, rejected: true });
  });

  it('refuses an invalid pipeline or envelope before raising a card', async () => {
    const { deps, queue } = makeDeps(makeStores([validAgent]));
    const tool = smithProposeTool(deps);

    const badPipe = (await answerOf(tool, {
      kind: 'pipeline',
      mode: 'create',
      spec: { ...validPipeline, id: 'Not Kebab' },
    })) as { ok: boolean; validation?: unknown[] };
    expect(badPipe.ok).toBe(false);
    expect(badPipe.validation?.length).toBeTruthy();

    const badEnv = (await answerOf(tool, {
      kind: 'envelope',
      mode: 'create',
      spec: { ...validEnvelope, name: 'generic' },
    })) as { ok: boolean; validation?: unknown[] };
    expect(badEnv.ok).toBe(false);
    expect(badEnv.validation?.length).toBeTruthy();
    expect(queue.list()).toHaveLength(0);
  });

  it('lets warnings ride along on the card instead of blocking the propose', async () => {
    const { deps, queue } = makeDeps();
    const pending = answerOf(smithProposeTool(deps), {
      kind: 'agent',
      mode: 'create',
      spec: { ...validAgent, envelope: 'not_in_the_library' },
    });
    await vi.waitFor(() => expect(queue.list()).toHaveLength(1));
    const proposal = queue.list()[0]!;
    expect(proposal.type).toBe('entity');
    if (proposal.type !== 'entity') throw new Error('expected entity proposal');
    expect(proposal.validation).toEqual([
      expect.objectContaining({ level: 'warning', where: 'envelope' }),
    ]);
    await queue.answer(queue.list()[0]!.id, { approved: false });
    await pending;
  });

  it('reports a pipeline spec missing its id', async () => {
    const { deps } = makeDeps();
    expect(
      await answerOf(smithProposeTool(deps), {
        kind: 'pipeline',
        mode: 'create',
        spec: { ...validPipeline, id: undefined },
      }),
    ).toEqual({ ok: false, error: 'pipeline spec is missing its name' });
  });

  it('keeps the card up when the save fails, so the human can retry', async () => {
    const stores = makeStores();
    const queue = new ProposalQueue(
      () => {},
      async () => ({ ok: false, error: 'disk full' }),
    );
    const deps: SmithEntityToolDeps = { stores, queue, projectId: () => undefined };
    const pending = answerOf(smithProposeTool(deps), {
      kind: 'agent',
      mode: 'create',
      spec: validAgent,
    });

    await vi.waitFor(() => expect(queue.list()).toHaveLength(1));
    const proposal = queue.list()[0]!;
    expect(await queue.answer(proposal.id, { approved: true })).toEqual({
      ok: false,
      error: 'disk full',
    });
    // The proposal is still pending; the tool call is still blocked.
    expect(queue.list()).toHaveLength(1);

    // A rejection finally settles it and unblocks the tool.
    await queue.answer(proposal.id, { approved: false });
    await expect(pending).resolves.toEqual({ ok: false, rejected: true });
  });
});

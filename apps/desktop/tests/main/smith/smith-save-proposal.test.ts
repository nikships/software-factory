/**
 * `saveProposal` is the store write the approval card waits on. These tests
 * drive real JSON stores in a temp dir — no IPC, no renderer — so an approve
 * that the store would refuse stays refused.
 */

import { describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../helpers/tmp.js';
import { saveProposal } from '../../../src/main/ipc/smith.js';
import { RosterStore } from '../../../src/main/store/roster.js';
import { PipelineStore } from '../../../src/main/store/pipelines.js';
import { EnvelopeStore } from '../../../src/main/store/envelopes.js';
import type {
  AgentDef,
  EnvelopeDef,
  PipelineDef,
  SmithEntityProposal,
} from '../../../src/shared/types.js';

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

const validPipeline: PipelineDef = {
  id: 'ship-it',
  name: 'Ship it',
  description: 'A one-phase pipeline.',
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
  fields: [{ name: 'severity', type: 'string', required: true }],
};

function proposal(over: Partial<SmithEntityProposal>): SmithEntityProposal {
  return {
    type: 'entity',
    id: 'prop_1',
    kind: 'agent',
    mode: 'create',
    name: 'planner',
    spec: validAgent,
    validation: [],
    overwrites: false,
    projectId: '',
    createdAt: '2026-08-21T00:00:00.000Z',
    ...over,
  };
}

function ctx() {
  const dir = tempDir('foundry-smith-save-');
  const roster = new RosterStore(dir);
  const pipelines = new PipelineStore(dir);
  const envelopes = new EnvelopeStore(dir);
  const broadcast = vi.fn();
  return {
    roster,
    pipelines,
    envelopes,
    rosterScope: () => ({}),
    pipelineScope: () => ({}),
    rosterFor: () => roster.list(),
    commandNames: () => [] as string[],
    broadcast,
  };
}

describe('saveProposal', () => {
  it('saves a valid agent and broadcasts settings-changed', () => {
    const stores = ctx();
    const result = saveProposal(stores, proposal({ spec: validAgent }));
    expect(result).toEqual({ ok: true, entity: validAgent });
    expect(stores.roster.get('planner')).toMatchObject({ name: 'planner' });
    expect(stores.broadcast).toHaveBeenCalledOnce();
  });

  it('refuses an invalid agent and does not broadcast', () => {
    const stores = ctx();
    const result = saveProposal(stores, proposal({ spec: { ...validAgent, name: 'Bad Name' } }));
    expect(result.ok).toBe(false);
    expect(stores.roster.get('Bad Name')).toBeNull();
    expect(stores.broadcast).not.toHaveBeenCalled();
  });

  it('saves a valid pipeline against the live roster', () => {
    const stores = ctx();
    saveProposal(stores, proposal({ spec: validAgent }));
    stores.broadcast.mockClear();
    const result = saveProposal(
      stores,
      proposal({ kind: 'pipeline', name: 'ship-it', spec: validPipeline }),
    );
    expect(result).toEqual({ ok: true, entity: validPipeline });
    expect(stores.pipelines.get('ship-it')?.name).toBe('Ship it');
    expect(stores.broadcast).toHaveBeenCalledOnce();
  });

  it('saves a valid envelope', () => {
    const stores = ctx();
    const result = saveProposal(
      stores,
      proposal({ kind: 'envelope', name: 'severity_report', spec: validEnvelope }),
    );
    expect(result).toEqual({ ok: true, entity: validEnvelope });
    expect(stores.envelopes.get('severity_report')?.name).toBe('severity_report');
  });

  it('refuses an envelope that collides with a built-in kind', () => {
    const stores = ctx();
    const result = saveProposal(
      stores,
      proposal({
        kind: 'envelope',
        name: 'generic',
        spec: { ...validEnvelope, name: 'generic' },
      }),
    );
    expect(result.ok).toBe(false);
    expect(stores.envelopes.get('generic')).toBeNull();
  });
});

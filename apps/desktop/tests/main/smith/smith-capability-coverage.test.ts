import { describe, expect, it } from 'vitest';
import {
  SMITH_CAPABILITY_COVERAGE,
  uncoveredSmithInvokeChannels,
} from '../../../src/main/smith/capability-coverage.js';
import { IPC } from '../../../src/shared/ipc-contract.js';

describe('Smith capability coverage', () => {
  it('classifies every non-Smith invoke exactly once and treats events separately', () => {
    expect(uncoveredSmithInvokeChannels()).toEqual([]);

    const classified = Object.keys(SMITH_CAPABILITY_COVERAGE);
    expect(new Set(classified).size).toBe(classified.length);
    expect(classified).not.toContain(expect.stringMatching(/^event:/));
    expect(classified).not.toContain(expect.stringMatching(/^smith:/));

    const invokes = Object.values(IPC).filter(
      (channel) => !channel.startsWith('event:') && !channel.startsWith('smith:'),
    );
    expect(classified.sort()).toEqual([...invokes].sort());
  });

  it('has one renderer-only exclusion and pins equivalent secure adapters', () => {
    const rendererOnly = Object.entries(SMITH_CAPABILITY_COVERAGE).filter(
      ([, coverage]) => coverage.mode === 'renderer-only',
    );
    expect(rendererOnly).toEqual([
      [IPC.appAssetUrl, { tool: 'renderer', operation: 'asset_url', mode: 'renderer-only' }],
    ]);
    expect(SMITH_CAPABILITY_COVERAGE[IPC.rosterUploadMark]).toEqual({
      tool: 'smith_entities',
      operation: 'agent_upload_mark',
      mode: 'approval',
    });
    expect(SMITH_CAPABILITY_COVERAGE[IPC.bridgeSetApiKey]?.mode).toBe('secure');
    expect(SMITH_CAPABILITY_COVERAGE[IPC.companionPairingPayload]?.mode).toBe('secure');
  });

  it('contains tool operations, never Smith targets or raw channel names', () => {
    for (const [channel, coverage] of Object.entries(SMITH_CAPABILITY_COVERAGE)) {
      expect(coverage.tool).not.toMatch(/^smith:/);
      expect(coverage.operation).not.toBe(channel);
      expect(coverage.operation).not.toContain(':');
    }
  });

  it('reports a newly added invoke while ignoring events and Smith lifecycle channels', () => {
    expect(
      uncoveredSmithInvokeChannels({
        ...IPC,
        futureInvoke: 'future:invoke',
        futureEvent: 'event:future',
        futureSmithLifecycle: 'smith:future',
      }),
    ).toEqual(['future:invoke']);
  });
});

/**
 * A router split must not change what the renderer can reach. These tests pin the
 * registered channel set against the contract, and pin that `ipcMain` is reachable
 * from exactly one file, which is what makes "the surface is the contract" a
 * property you can check rather than a claim.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const registered: string[] = [];
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      registered.push(channel);
      handlers.set(channel, handler);
    },
  },
  app: { getVersion: () => '0.0.0', quit: vi.fn(), relaunch: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
}));

const { registerIpc } = await import('../../../src/main/ipc/index.js');
const { IPC } = await import('../../../src/shared/ipc-contract.js');

/** Registration only closes over ctx; nothing is read until a handler fires. */
const stubCtx = {} as never;

const invokeChannels = Object.entries(IPC)
  .filter(([key]) => !key.startsWith('event'))
  .map(([, channel]) => channel);

describe('the IPC surface', () => {
  beforeEach(() => {
    registered.length = 0;
    handlers.clear();
    registerIpc(stubCtx);
  });

  it('registers exactly the invoke channels the contract declares', () => {
    expect([...registered].sort()).toEqual([...invokeChannels].sort());
  });

  it('registers each channel once, so no router shadows another', () => {
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('uses the same collected handler for Electron and direct invocation', async () => {
    const get = vi.fn(() => ({ source: 'settings' }));
    registered.length = 0;
    handlers.clear();
    const invoke = registerIpc({ settings: { get } } as never);

    await expect(invoke(IPC.settingsGet)).resolves.toEqual({ source: 'settings' });
    await expect(handlers.get(IPC.settingsGet)?.({})).resolves.toEqual({ source: 'settings' });
    expect(get).toHaveBeenCalledTimes(2);
    expect(registered.filter((channel) => channel === IPC.settingsGet)).toHaveLength(1);
  });

  it('registers 120 channels, so a deleted handler is not a silent capability loss', () => {
    expect(registered).toHaveLength(120);
  });

  it('registers the Smith chat lifecycle without turning a long send into a push invoke', () => {
    expect(registered).toContain(IPC.smithSend);
    expect(registered).toContain(IPC.smithCancel);
    expect(registered).toContain(IPC.smithNewChat);
    expect(registered).toContain(IPC.smithState);
    expect(registered).toContain(IPC.smithSetModel);
    expect(registered).toContain(IPC.smithAnswerProposal);
  });

  it('registers the companion channels Settings uses to manage the host', () => {
    expect(registered).toContain(IPC.companionState);
    expect(registered).toContain(IPC.companionStart);
    expect(registered).toContain(IPC.companionStop);
    expect(registered).toContain(IPC.companionPairingPayload);
    expect(registered).toContain(IPC.companionUnpair);
  });

  it('registers the Bridge channels Settings connects providers through', () => {
    expect(registered).toContain(IPC.bridgeState);
    expect(registered).toContain(IPC.bridgeConnect);
    expect(registered).toContain(IPC.bridgeDisconnect);
    expect(registered).toContain(IPC.bridgeSetApiKey);
    // The Providers pane shows which keys are set without ever reading one, so
    // the list channel is as load-bearing as the write.
    expect(registered).toContain(IPC.bridgeStoredKeys);
  });

  it('no longer offers the CLI channels the picker used to read', () => {
    // Models come off pi's catalog and tools off the live session. A surviving
    // handler here would be a second, stale source for both.
    for (const channel of registered) {
      expect(channel).not.toBe('catalog:clis');
      expect(channel).not.toBe('catalog:models');
      expect(channel).not.toBe('catalog:tools');
    }
  });

  it('registers the agent-model channel the picker reads', () => {
    expect(registered).toContain(IPC.catalogAgentModels);
  });

  it('registers the scope-copies channel the Design scope control reads', () => {
    expect(registered).toContain(IPC.projectsScopeCopies);
  });

  it('registers the base-sync channels the Runs bar reads', () => {
    expect(registered).toContain(IPC.projectsBaseSyncInspect);
    expect(registered).toContain(IPC.projectsBaseSync);
  });

  it('registers the roster preview channel the agent editor reads', () => {
    expect(registered).toContain(IPC.rosterPreview);
  });

  it('registers the mark-upload channels the Identity picker uses', () => {
    expect(registered).toContain(IPC.rosterUploadMark);
    expect(registered).toContain(IPC.rosterRemoveMark);
  });

  it('registers the context-breakdown channel, which the Inspector lane reads', () => {
    expect(registered).toContain(IPC.runsContextBreakdown);
  });

  it('never registers a push event channel as an invoke handler', () => {
    for (const channel of registered) expect(channel.startsWith('event:')).toBe(false);
  });

  it('reaches ipcMain from exactly one file', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(import.meta.dirname, '../../../src/main/ipc');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('ipcMain'));
    expect(offenders).toEqual([]);
  });
});

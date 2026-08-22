import { describe, expect, it, vi } from 'vitest';
import { MainHandlerRegistry } from '../../../src/main/ipc/shared.js';

describe('MainHandlerRegistry', () => {
  it('awaits synchronous and asynchronous handlers', async () => {
    const registry = new MainHandlerRegistry();
    registry.handle('sync', (value: number) => value + 1);
    registry.handle('async', async (value: number) => Promise.resolve(value + 2));

    await expect(registry.invoke<number>('sync', 2)).resolves.toBe(3);
    await expect(registry.invoke<number>('async', 2)).resolves.toBe(4);
  });

  it('rejects duplicate registrations', () => {
    const registry = new MainHandlerRegistry();
    registry.handle('same', vi.fn());

    expect(() => registry.handle('same', vi.fn())).toThrow('Duplicate IPC handler: same');
  });

  it('rejects unknown channels', async () => {
    const registry = new MainHandlerRegistry();

    await expect(registry.invoke('missing')).rejects.toThrow('Unknown IPC channel: missing');
  });
});

import type { ValidationIssue } from '@shared/types.js';
import { IPC } from '@shared/ipc-contract.js';
import type { AppContext } from '../context.js';
import type { SettleHooks } from '../engine/settle.js';

/**
 * The one wrapper that reaches the Electron IPC entry point. Routers receive
 * it rather than the module, so `ipc/index.ts` stays the only file that can
 * widen the surface.
 */
export type Handle = <T>(channel: string, fn: (...args: never[]) => Promise<T> | T) => void;

export type Router<Ctx = AppContext> = (ctx: Ctx, handle: Handle) => void;

/** A router handler, retained so Electron and main-process callers share it. */
export type MainHandler = (...args: never[]) => unknown;

/** Main-only invocation path. It always settles sync and async handlers alike. */
export type MainInvoker = <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;

/** Collects the complete handler surface before any of it is registered. */
export class MainHandlerRegistry {
  readonly #handlers = new Map<string, MainHandler>();

  readonly handle: Handle = (channel, fn): void => {
    if (this.#handlers.has(channel)) throw new Error(`Duplicate IPC handler: ${channel}`);
    this.#handlers.set(channel, fn);
  };

  entries(): IterableIterator<[string, MainHandler]> {
    return this.#handlers.entries();
  }

  readonly invoke: MainInvoker = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const handler = this.#handlers.get(channel);
    if (!handler) throw new Error(`Unknown IPC channel: ${channel}`);
    return (await handler(...(args as never[]))) as T;
  };
}

/** Shared empty issue list: every `ok: true` SaveResult carries the same one. */
export const noIssues: ValidationIssue[] = [];

export const notifySettings = (ctx: Pick<AppContext, 'broadcast'>): void =>
  ctx.broadcast(IPC.eventSettingsChanged);

export const notifyRuns = (ctx: Pick<AppContext, 'broadcast'>): void =>
  ctx.broadcast(IPC.eventRunsChanged);

/**
 * The hooks `landRun` / `repairBranch` need from the app, so the engine never
 * imports `AppContext` and a test can stand in for notify/save/one-shot.
 */
export function settleHooks(
  ctx: Pick<AppContext, 'settings' | 'projects' | 'oneShot' | 'broadcast'>,
): SettleHooks {
  return {
    getSettings: () => ctx.settings.get(),
    oneShot: ctx.oneShot,
    notifyRuns: () => notifyRuns(ctx),
    notifySettings: () => notifySettings(ctx),
    saveProject: (next) => ctx.projects.save(next),
  };
}

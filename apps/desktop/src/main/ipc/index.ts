/**
 * The entire IPC surface, assembled from one router per domain. Every handler is
 * invoke/handle: there is no `ipcRenderer.send` path into the main process and no
 * remote module, so the renderer's only capability is the sum of these routers,
 * which is exactly `src/shared/ipc-contract.ts`.
 *
 * Trace data crosses as polled pages with a change_id cursor rather than a push
 * stream, which is why live view and history are the same query.
 */

import { ipcMain } from 'electron';
import type { AppContext } from '../context.js';
import { MainHandlerRegistry } from './shared.js';
import type { MainInvoker } from './shared.js';
import * as settings from './settings.js';
import * as projects from './projects.js';
import * as roster from './roster.js';
import * as envelopes from './envelopes.js';
import * as pipelines from './pipelines.js';
import * as catalog from './catalog.js';
import * as bridge from './bridge.js';
import * as runs from './runs.js';
import * as prs from './prs.js';
import * as smith from './smith.js';
import * as companion from './companion.js';
import * as maintenance from './maintenance.js';
import * as appRouter from './app.js';
import * as readiness from './readiness.js';

export function registerIpc(ctx: AppContext): MainInvoker {
  const registry = new MainHandlerRegistry();

  settings.register(ctx, registry.handle);
  projects.register(ctx, registry.handle);
  readiness.register(ctx, registry.handle);
  roster.register(ctx, registry.handle);
  envelopes.register(ctx, registry.handle);
  pipelines.register(ctx, registry.handle);
  catalog.register(ctx, registry.handle);
  bridge.register(ctx, registry.handle);
  runs.register(ctx, registry.handle);
  prs.register(ctx, registry.handle);
  smith.register(ctx, registry.handle);
  companion.register(ctx, registry.handle);
  maintenance.register(ctx, registry.handle);
  appRouter.register(ctx, registry.handle);

  for (const [channel, handler] of registry.entries()) {
    ipcMain.handle(channel, async (_event, ...args) => handler(...(args as never[])));
  }

  return registry.invoke;
}

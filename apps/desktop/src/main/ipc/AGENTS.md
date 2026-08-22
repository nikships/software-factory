# AGENTS.md — src/main/ipc

Domain routers for the typed IPC seam. The capability flow is single‑way and explicit: `src/shared/types.ts` → `src/shared/ipc-contract.ts` (`IPC.*` constants) → router here → `src/preload/bridge.ts` → `src/renderer/api.ts` via `plain()`. There is no generic `invoke(channel, ...)` passthrough.

## Project Overview

- One router per domain: `app.ts`, `catalog.ts`, `envelopes.ts`, `pipelines.ts`, `projects.ts`, `prs.ts`, `roster.ts`, `runs.ts`, `settings.ts`, `maintenance.ts`, `shared.ts` (re-export + index).
- `index.ts` first collects those routers into `MainHandlerRegistry`, registers
  the same functions with Electron, and returns a main-only `MainInvoker` for
  Smith. The invoker is never exposed through preload or renderer.
- Handlers surface rejected promises; the renderer observes errors via the typed bridge.
- Long work returns a handle and progress is observed separately — never `await` an agent turn inside a click handler. Examples: `projects:askAgentCommands` returns a `detectionId`; setup-agent requests return a `setupId`.

## Setup Commands

```bash
npm ci
npm run dev    # IPC is wired in src/main/main.ts via registerIpc(ctx)
```

No IPC-specific setup. Channels are registered once at startup.

## Development Workflow

To add a new capability:

1. Add types to `src/shared/types.ts`.
2. Add an `IPC.*` constant and a method to `FoundryApi` in `src/shared/ipc-contract.ts` (both sides import the constant so a rename cannot silently break).
3. Add a domain router (or extend an existing one) under `src/main/ipc/`.
4. Expose the smallest typed wrapper in `src/preload/bridge.ts` (CJS, sandboxed).
5. Call it via `src/renderer/api.ts` through `plain()` so structured‑clone errors are visible.

Keep routers domain‑scoped; update the shared contract before wiring a new channel. `apps/desktop/tests/main/ipc/ipc-clone.test.ts` and `apps/desktop/tests/main/ipc/ipc-surface.test.ts` guard the surface.

Smith tools must map fixed operation enums to fixed `IPC.*` constants. Never
accept a channel string from the model or dispatch Smith from its coverage map.

## Testing Instructions

```bash
npm test
npx vitest run -t "ipc"
npx vitest run apps/desktop/tests/main/ipc/ipc-surface.test.ts
npx vitest run apps/desktop/tests/main/ipc/ipc-clone.test.ts
```

- IPC tests assert that every `IPC.*` constant is wired and that args/results survive `structuredClone`.
- When adding a channel, add a surface test ensuring the preload wrapper exists and round‑trips.

## Push Channels

Exactly ten push channels (from main → renderer):

- `runs-changed`
- `interrupts-changed`
- `settings-changed`
- `updater-status`
- `detection-progress`
- `setup-progress`
- `smith-proposals-changed`
- `smith-progress`
- `bridge-changed`
- `companion-changed`

`detection-progress`, `setup-progress`, and `smith-progress` carry progress for work that has **no trace rows**. `smith-proposals-changed` tells the renderer the one-slot proposal queue moved, so the approval card can appear or dismiss. `bridge-changed` and `companion-changed` report external state changes that complete outside a renderer invoke. Ordinary run data is **polled** via the `change_id` cursor (see `src/main/trace/AGENTS.md` + `src/renderer/stores/run.tsx`). Do not add a new push channel without updating this list and the bridge.

## Code Style

- Routers are thin: validate args, delegate to `AppContext` domain, return `plain()`‑safe values.
- No business logic in the router — it belongs in `engine/`, `store/`, `system/`, or `trace/`.
- No `eslint-disable`; use `@main/*` / `@shared/*` aliases.

## Build and Deployment

```bash
npm run typecheck && npm run lint && npm run build
```

IPC code bundles into `out/main/main.js`; `out/preload/bridge.cjs` is the sandbox bridge.

## Additional Notes

- `src/renderer/api.ts:plain()` eagerly clones args to surface structured‑clone failures with a clear message before they become silent IPC errors.
- `src/preload/bridge.ts` emits CJS because sandboxed preloads cannot be ESM.

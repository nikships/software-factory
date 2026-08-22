# AGENTS.md — apps/desktop/src/renderer

React 19 renderer. Unprivileged: no `fs`, `child_process`, `electron`, or `apps/desktop/src/main/` imports. Everything privileged goes through the typed IPC seam (`apps/desktop/src/shared/ipc-contract.ts` → `apps/desktop/src/preload/bridge.ts` → `apps/desktop/src/renderer/api.ts` via `plain()`).

## Project Overview

- **React 19 + Vite + CSS Modules** (`localsConvention: 'camelCase'` — `.phase-edge` → `styles.phaseEdge`).
- App shell: `App.tsx` + screens (`screens/`), domain-scoped components (`components/{common,inspector,layout,media,pipeline,project,readiness,run,smith,ui}`), view-models (`view-models/`), utils (`utils/`), design tokens (`design/tokens.css`, `tokens-base.css`), hooks, stores, and `view-models/pipeline-view.ts`. The Runs composer and Settings → Project → Git share `BaseSyncBar` (`view-models/base-sync-view.ts` owns the copy) so the operator can see whether local `main` matches the remote and fast-forward it before a run.
- Bridge: `api.ts` wraps `window.foundry` and eagerly `plain()`-clones args so structured‑clone errors are visible before IPC.
- Trace consumption: `stores/run.tsx` polls `runs:events` with a `change_id` cursor and merges by `eventId`; `utils/derive.ts` derives usage/duration/model from events (no denormalized columns). `components/inspector/entries.tsx` renders `TranscriptEntry` per event — new events need a switch case or the default silently drops them.
- Mock: `mockFoundry.ts` backs `window.foundry` when `window.foundry` is absent (vite web preview). Keep it in sync with `FoundryApi`; do not import Node/main behavior into it.
- Smith's screen and bubble share `smithProjectId`; null means “All projects.”
  Its proposal card narrows entity/action proposals. Masked secret input and
  Companion private displays stay component-local and never enter chat state.
- Factory tokens imported statically in `main.tsx`; keep provider icon + CSS imports narrow.

## Setup Commands

```bash
npm ci

# Full Electron (renderer served by electron-vite, with HMR)
npm run dev

# Plain browser preview — no Electron, fast UI iteration
npm run dev:web             # vite --config vite.web.config.ts
npm run build:web && npm run preview:web
```

`mockFoundry.ts` is active in the web preview; the Electron app uses the real `window.foundry` from the preload.

## Development Workflow

- Keep CSS in `.module.css` files. Inline `<style>` blocks must not redefine base classes (`.btn`, `.field`, `.hint`, … from `design/tokens-base.css`) — `npm run check:css` fails the build if they do.
- Don't add `src/main/` imports here — use `api.ts`.
- For new trace events: update `derive.ts`, add a `TranscriptEntry` branch in `inspector/entries.tsx`, and ensure `stores/run.tsx` merging handles it.
- `stores/run.tsx` owns polling + cursor merge; `pipeline-view.ts` / hooks own pipeline draft state.

## Testing Instructions

```bash
npm test
npm run test:watch
npx vitest run -t "<renderer|transcript|pipeline-view|keyboard>"
```

- Vitest runs with `pool: forks`, `environment: node`. Renderer tests must account for the Node/forks environment rather than assuming `jsdom`/browser DOM.
- Keep UI tests focused on hooks/stores/derivation. The real-window smoke is `npm run test:e2e` (Playwright launching the built Electron app). Interactive checks use the `foundry-ui` skill (CDP + agent-browser), not a web browser.

## Push Channels

Exactly ten main→renderer channels (subscribed via `window.foundry.on`):

- `runs-changed`, `interrupts-changed`, `settings-changed`, `updater-status`, `detection-progress`, `setup-progress`, `smith-proposals-changed`, `smith-progress`, `bridge-changed`, `companion-changed`

`detection-progress`, `setup-progress`, and `smith-progress` carry progress for work with no trace rows; `smith-proposals-changed` drives `SmithProposalCard`. `bridge-changed` and `companion-changed` report external state changes that complete outside a renderer invoke. Ordinary run data is **polled** via `change_id`, not pushed. Keep `mockFoundry.ts` in sync when adding channels.

## Code Style

- CSS modules with `camelCase`; never redefine base tokens in component style blocks.
- No `eslint-disable` comments — fix the real issue.
- Narrow icon/CSS imports to avoid pulling full UI bundles (see `main.tsx`).
- IPC args must go through `plain()` in `api.ts`.

## Build and Deployment

```bash
npm run build         # includes renderer build (chunked: react-vendor, icons)
npm run check:css     # CSS collision gate (real failure, not advisory)
npm run build:web     # web-only bundle (out/web)
```

- `electron.vite.config.ts` chunks `node_modules` (`react-vendor`, `icons`) and enforces CSS-module conventions.
- Factory design tokens in `design/tokens*.css` are statically imported.

## Additional Notes

- `keyboard.ts` / `local-store.ts` provide shared UI helpers; keep them side‑effect free.
- When changing `FoundryApi`, update `mockFoundry.ts`, `api.ts`, and `src/shared/ipc-contract.ts` together.

# AGENTS.md — src/shared

Pure types and constants imported by both processes. No `fs`, `child_process`, `electron`, or React imports — this directory must stay side‑effect free.

## Project Overview

- `types.ts` — source of truth for pipelines, phases, agents, envelopes, gates, boundaries, runs, events, projects, and settings.
- `ipc-contract.ts` — `FoundryApi` interface + `IPC.*` channel constants. Both processes import the constants so a rename cannot silently break a call.
- Boundary values: `null` (unrestricted except protected paths), `[]` (read-only), or an allowlist with `*` (single segment) / `**` (recursive).
- Model ids are opaque `provider/model` strings from pi's catalog; shared code never validates them against a vendor list.
- Smith chat scope is optional: absent means the global “All projects” session.
  `SmithProposal` is an entity/action union. Secret answers and private displays
  cross only the approval response and never enter `SmithChatState`.

## Setup Commands

```bash
npm ci
npm run typecheck   # validates shared types against all consumers
```

No shared-specific setup — both `electron.vite.config.ts` and `tsconfig.json` alias `@shared/*` to this directory.

## Development Workflow

For a new capability, do these in order:

1. Add types/constants to `types.ts` (phase kind, gate spec, envelope kind, etc.).
2. Add an `IPC.*` constant and a method to `FoundryApi` in `ipc-contract.ts`.
3. Add the main handler in `src/main/ipc/` (domain router).
4. Add the minimal typed wrapper in `src/preload/bridge.ts`.
5. Call it from `src/renderer/api.ts` through `plain()`.

Keep type docs in `types.ts` (especially `BUILTIN_ENVELOPE_BLURBS` next to `envelopes.ts` schemas).

## Testing Instructions

```bash
npm test
npx vitest run -t "ipc|envelope|gate|boundary"
npx vitest run apps/desktop/tests/main/ipc/ipc-surface.test.ts
npx vitest run apps/desktop/tests/main/engine/envelopes.test.ts
```

- Shared types are tested indirectly through the engine, pi, and ipc suites.
- When adding an envelope or gate, add argv/parse fixtures or schema tests rather than DOM tests.

## Code Style

- No runtime side effects here — only types, constants, and pure helpers.
- Import with `type` where possible (`consistent-type-imports`).
- No `eslint-disable`; fix the real issue.

## Build and Deployment

```bash
npm run typecheck && npm run lint && npm run build
```

Shared code is bundled into both `out/main/main.js` and the renderer chunk via Vite aliases; no standalone build.

## Additional Notes

- Boundaries and protected paths are enforced post-call by diffing git — not by permission policy. See `src/main/engine/AGENTS.md`.
- `AppSettings` carries no credential. Provider keys live in pi's credential store and subscription tokens in the Bridge's auth directory; a key in `settings.json` would be a key nothing reads and everything can see.

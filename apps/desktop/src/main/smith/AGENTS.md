# AGENTS.md — src/main/smith

Smith is Foundry's native in-app operator agent. It has functional parity with
meaningful desktop operations while preserving explicit typed capabilities and
inline human approval.

## Scope and sessions

- `SmithService` owns one persistent chat per project and one global “All
  projects” chat. Project sessions run in that checkout; global runs in
  `<supportDir>/pi/smith/global/workspace` and has no checkout.
- Scope is `projectId?: string` across IPC and snapshots. Global tools require an
  explicit project ID for project-specific operations.
- Chat state stays under `<supportDir>/pi/smith/<scope>/`; never touch `~/.pi`.
- Unknown tools fail closed. Direct writes are permitted only inside the current
  project checkout or global workspace.

## Tools and privilege

- `smith_list`, `smith_show`, `smith_propose`: full entity reads and validated
  entity create/edit proposals.
- `smith_entities`, `smith_settings`, `smith_projects`, `smith_runs`,
  `smith_prs`, `smith_interrupts`, `smith_providers`, `smith_companion`, and
  `smith_system`: fixed operation enums over existing handlers.
- Readiness exposes its three conversational tools plus `readiness_manage`.
- Read-only operations invoke immediately. Persistent/destructive/credential,
  process, Git/PR, lifecycle, network, and maintenance actions enqueue an action
  proposal whose executor closes over exactly one fixed `IPC.*` handler.
- `SmithService.invoke` is attached to the main-only handler registry at startup.
  It is not renderer IPC. Never accept a channel argument or dispatch from
  `capability-coverage.ts`; that file is documentation enforced by tests.

## Approval and secrets

- `ProposalQueue` permits one pending entity/action proposal globally. Public
  proposal data is clone-safe; executor closures remain in main.
- Entity validation occurs before the card. Entity save failures are retryable;
  ordinary action failures clear/unblock so Smith can correct arguments.
- API keys are accepted only as `SmithProposalAnswer.secret` for a proposal with
  `secretRequest`. Never put a key/token/secret in proposal args, transcript,
  model result, chat-state JSON, or logs.
- Companion pairing payloads are renderer-only private displays. Smith receives
  availability only.

## Tests

```bash
npx vitest run -t "smith"
npx vitest run apps/desktop/tests/main/smith/smith-capability-coverage.test.ts
npx vitest run apps/desktop/tests/main/ipc/ipc-invoker.test.ts
```

The capability coverage test must fail whenever a non-Smith invoke channel is
added without one immediate/approval/secure/renderer-only classification.

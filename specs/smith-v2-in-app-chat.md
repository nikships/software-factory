# Smith v2 — Native In-App Chat on Bundled Pi

**Status:** Approved (brainstorm reviewed 2026-08-21, all decisions settled)
**Companion artifact:** `.lavish/smith-brainstorm.html` (visual brainstorm + decision record)

## 1. Summary

Smith stops being a terminal handoff to a user-installed coding agent and becomes a
first-class, native chat surface inside Foundry, running on the bundled pi runtime.
The external-agent machinery (unix socket, `foundry-cli`, shipped skill, terminal
launcher) is deleted in the same release. The separate agent-readiness onboarding
experience (modal + bespoke state machine UI) is absorbed into Smith as part of the
same effort. Smith is reachable two ways: a dedicated screen in the side nav, and a
Fin-style floating bubble stuck to the bottom-right of every screen — two views of
one shared, persistent conversation.

## 2. Decision record

| Decision               | Choice                                  | Notes                                                                                                                                    |
| ---------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Direction              | In-app chat on bundled pi, full replace | No external agent install required                                                                                                       |
| Old machinery          | Delete outright, same release           | No escape hatch, no deprecation window                                                                                                   |
| Readiness migration    | One effort                              | Smith ships with readiness absorbed                                                                                                      |
| Repo access            | Full, including edits                   | Direct checkout edits; git is the undo. Readiness remediation stays in the `foundry-ready/<id>` worktree                                 |
| Model selection        | Global default + header dropdown        | Default in Settings → Smith; chat header picker reuses the Settings → Providers catalog rows (provider logo, display name, context size) |
| Session persistence    | Persisted history                       | Chat survives app relaunches                                                                                                             |
| Approval card          | Inline in transcript                    | Entity writes still gate on the card; it renders as a chat entry                                                                         |
| Mini chat bubble       | One shared session, always visible      | Bubble and full screen are two views of the same conversation                                                                            |
| Mini chat context      | Screen-aware                            | Smith knows what the user is viewing (current run/pipeline/agent)                                                                        |
| Mini chat capabilities | Full Smith                              | Approvals and readiness work in the popover (compact cards)                                                                              |
| Threads                | Single thread + New chat                | No multi-thread. A ⊕ clear/new button wipes context and starts fresh; readiness `needs_continue` state survives outside the chat         |

## 3. Current state (what is being replaced)

Today (`apps/desktop/src/main/smith/`, `src/cli/`, `skills/foundry-smith/`):

- Sidebar "Smith" opens the user's preferred terminal at the project root and starts
  their chosen agent CLI (`smith/launch.ts`, `system/terminal.ts`,
  `CODING_AGENTS` in `shared/types.ts`).
- The agent loads `skills/foundry-smith/SKILL.md` and drives `foundry-cli` over a
  unix domain socket (`smith/socket-server.ts`, `smith/protocol.ts`).
- Write proposals validate through the stores, then block on the one-slot
  `ProposalQueue` until the human answers `SmithProposalCard` in the renderer.

The validation + approval spine (**queue → card → store**) is correct and survives.
Only the front half — who runs the agent — changes.

Readiness today (`apps/desktop/src/main/readiness/`): a separate modal experience
driven by a bespoke state machine (`session.ts`), with its own push channel
(`readiness-progress`) and a parked-question mechanism (`ask-user.ts`).

## 4. Architecture

### 4.1 Main process: `SmithChatSession`

- Holds one pi `AgentSession` per project (the **run-session shape** over
  `pi/transport.ts`'s `AgentTransport` — multi-turn with tool state, not a one-shot).
  Lazy-open on first message, per the existing pattern in `pi/session.ts`.
- Lives behind the vendor-neutral seam: no `@earendil-works/pi-*` imports outside
  `src/main/pi/` (ESLint `no-restricted-imports` stands).
- **Model**: resolved via `pi/model.ts` from a new global `smithModel` setting;
  switchable mid-conversation from the chat header (model is stated at create, so a
  switch opens a successor session carrying the transcript context forward — exact
  mechanism to be settled during implementation against the pinned vendor docs in
  `references/`).
- **Persistence**: sessions persist to disk under the project's support dir
  (pi `SessionManager` file-backed, pinned under `<supportDir>/pi/` per the
  never-touch-`~/.pi` invariant). History reloads on app relaunch. "New chat"
  disposes the session and starts a fresh one.
- **Departure from run policy, on purpose**: Smith is interactive with the operator
  present. It does not run under the zero-interrupt policy; it is also not a run —
  no tracer rows, no `foundry/<runId>` branch, no engine involvement.

### 4.2 Tools

Smith's session opens with:

- **Full builtins** (`read`, `edit`, `write`, `bash`, …): Smith is a full coding
  agent in the project checkout. Ordinary file edits happen directly in the
  operator's checkout; git is the undo.
- **Entity tools** (replace the socket protocol ops):
  - `smith_list` / `smith_show` — scope-aware reads straight from the stores.
    Projects stay **list-only and projected** (`{id, name, path}`), same rule as
    today, enforced in the tool implementation.
  - `smith_propose` (create/edit for agent | pipeline | envelope) — validates via
    the store's own `validate()` first (errors return as JSON, never raise a card;
    warnings ride along), then blocks the tool call on the one-slot `ProposalQueue`
    until the human answers the inline card. The model naturally waits for the
    verdict and reads the result. One pending proposal at a time; a second write
    rejects with `proposal_pending`. Rejection carries no note — the next chat
    message is the revision guidance.
- **Readiness tools** (wrap the existing machinery; the invariants keep their code):
  - `readiness_check` — wraps `readiness/evaluate.ts` (static checklist) +
    `readMarkerAtBaseRef()`. Answers "how ready is this repo and why".
  - `readiness_remediate` — starts the write-capable remediator on the isolated
    `foundry-ready/<id>` worktree (existing `readiness/worktree.ts` +
    `remediator.ts` + `prompt.ts`) and streams its progress into the chat
    transcript with a clear visual seam (a distinct sub-agent block, like run
    phases in the inspector).
  - `readiness_pr_status` — merge polling via the operator's `gh`
    (existing `readiness/merge.ts`), and finalize: re-read the marker at base ref
    after fast-forward ("a merged PR is not proof" stands).
- **System prompt**: Smith persona + entity schemas distilled from
  `skills/foundry-smith/SKILL.md` into `systemPromptOverride` (Foundry harness
  pattern in `pi/system-prompt.ts`). Discovery stays off. The CLI-reference
  portions of the skill are dropped; the tools carry that contract now.
- **Screen context**: each user message is accompanied by a compact context header
  (current route + entity: run id / pipeline id / agent id / settings section)
  appended as standing context per turn — the `before_agent_start` pattern —
  so "why did this run fail?" resolves without the user naming the run.

### 4.3 Why readiness remediation keeps its worktree

Even though Smith itself edits the checkout directly, remediation stays on
`foundry-ready/<id>`:

1. Its deliverable is a reviewable PR.
2. Its proof is the marker on the base ref (`.agents/agent-ready.json`), not the
   working tree.
3. A half-done onboarding must be resumable across restarts (`needs_continue`).

Direct-checkout edits would satisfy none of those. `needs_continue` state lives
outside the chat session, exactly as today, so "New chat" never loses a half-done
onboarding — a fresh Smith session finds it and offers to continue.

### 4.4 Renderer

Two views, one session:

**Dedicated screen** (side nav "Smith", replaces the launcher):

- Chat transcript rendered with the existing folded-transcript rows
  (`pi/transcript.ts` fold → inspector-style entries) plus an input box.
- Header: Smith identity, scope chip (project), model picker (catalog rows with
  provider logo, polished display name, context size — same visual language as
  Settings → Providers), New chat (⊕).
- `SmithProposalCard` re-homed as an inline transcript entry (Approve / Reject).
- Readiness sub-agent turns render as visually distinct blocks.

**Mini chat bubble** (new, Fin-style):

- Floating launcher stuck to the bottom-right of every screen, Factory orange,
  always visible. Badges when a proposal is pending or a long task finishes.
- Opens a compact popover: same conversation, compact transcript, compact
  approval cards, input box. Header actions: New chat (⊕), Expand (⤢ → dedicated
  screen at the same point), Close (✕).
- Full capabilities — approvals and readiness are usable from the popover.

**IPC** (typed seam as always: `shared/ipc-contract.ts` → `main/ipc/` →
`preload/bridge.ts` → `renderer/api.ts`):

- Invokes: `smith:send`, `smith:cancel`, `smith:newChat`, `smith:state`
  (snapshot incl. transcript), `smith:setModel`, `smith:answerProposal` (existing).
- Push: reuse `smith-proposals-changed`; add one `smith-progress` channel for
  live transcript updates (cloned snapshots, renderer never shares live arrays).
- The renderer sends the screen-context descriptor with each `smith:send`.

### 4.5 Settings

- **Settings → Smith** (new): default model (catalog picker), bubble visibility
  is _not_ configurable (always visible — decided).
- **Removed**: preferred terminal, preferred coding agent (`CODING_AGENTS`),
  and their Settings → General rows.

## 5. Deletions

Same release, outright:

| Deleted                                                                                          | Why                                                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/cli/` (`foundry-cli.ts`, `args.ts`)                                                         | Replaced by in-process tools                                                                |
| `src/main/smith/socket-server.ts`, `protocol.ts`                                                 | No external caller                                                                          |
| `src/main/smith/launch.ts`, `session.ts` (shim writer)                                           | No handoff                                                                                  |
| `src/main/system/terminal.ts`                                                                    | No terminal to open                                                                         |
| `skills/foundry-smith/` shipping + `asarUnpack` entries                                          | Persona folds into the system prompt; delete the skill dir and its electron-builder entries |
| `SmithLauncher` component                                                                        | No fallback handoff                                                                         |
| `CODING_AGENTS`, `codingAgentFor`, terminal/coding-agent settings                                | No external agent                                                                           |
| `electron.vite.config.ts` second main entry (`out/main/foundry-cli.js`)                          | Binary gone                                                                                 |
| Tests: `smith-cli-args`, `smith-skill`, `smith-launch`, socket-transport parts of `smith-socket` | Subjects deleted; `dispatch()`-level validation tests migrate to the tool layer             |
| Readiness modal UI + `readiness-progress` channel + `readiness/ask-user.ts`                      | Chat is the surface; the chat is the ask-user                                               |

Kept and re-plumbed: `smith/proposals.ts` (queue), store `validate()`,
`SmithProposalCard` (re-homed), `readiness/evaluate.ts`, `marker.ts`,
`worktree.ts`, `merge.ts`, `prompt.ts`, `remediator.ts`.

## 6. Invariants (carried forward)

- Every entity write gates on a human Approve; one pending proposal at a time;
  a failed save keeps the card up.
- Projects are read-only and projected over the tool surface.
- Marker on the base ref is truth; a merged PR is not proof; a readiness worktree
  is recoverable work.
- Tracer remains the sole SQLite writer — Smith writes no SQLite.
- `~/.pi` is never touched; all pi paths pinned under the support dir.
- Renderer stays unprivileged; everything through the typed IPC seam.
- Unknown tools fail closed in the policy hook.

## 7. Risks / watch items

- **Provider requirement**: Smith now needs a signed-in provider (runs already do;
  onboarding copy should point at Settings → Providers when Smith is opened cold).
- **Model switch mid-session**: pi states model at create; switching needs a
  successor-session or equivalent — verify against `references/` during
  implementation, not live docs.
- **Runtime sharing**: Smith shares the model runtime with active runs (one-shots
  already do). Watch rate limits.
- **Two agents, one transcript**: the remediator's sub-session needs a clear
  visual seam so it is obvious who is talking.
- **Full tool set + interactive**: Smith's bash/edit in the operator's checkout is
  powerful. The operator is present and git is the undo; no boundary diff applies.
  This is a deliberate, documented departure from run policy.

## 8. Delivery breakdown (maps to Linear tickets)

1. **Main: SmithChatSession + persistence** — session holder, model resolution,
   persisted history, New chat, cancel.
2. **Main: entity tools** — `smith_list` / `smith_show` / `smith_propose` over the
   stores + `ProposalQueue`; port `dispatch()` validation tests to the tool layer.
3. **Main: Smith system prompt** — distill SKILL.md persona + schemas into the
   harness; per-turn screen-context injection.
4. **Main: readiness tools** — `readiness_check`, `readiness_remediate`,
   `readiness_pr_status` wrapping the existing machinery; sub-session streaming
   into the chat transcript.
5. **IPC + preload + api.ts** — new invokes/push channel, mockFoundry parity.
6. **Renderer: dedicated Smith screen** — transcript, input, header (scope, model
   picker with catalog rows, ⊕), inline proposal card, readiness blocks.
7. **Renderer: mini chat bubble** — floating launcher, popover, badges, expand,
   shared-session wiring.
8. **Settings** — Settings → Smith (default model); remove terminal/coding-agent
   settings.
9. **Deletions** — everything in §5, including electron-builder/vite entries and
   dead tests; knip clean.
10. **Docs + tests** — AGENTS.md updates (root, `src/main/smith/`, `readiness/`),
    executor-style tests for the new session/tooling, e2e smoke for the chat
    screen and bubble.

## 9. Capability parity amendment — 2026-08-22

This amendment supersedes the project-list-only and operator-only restrictions
in §§4 and 6. Smith now has functional parity with the meaningful operations in
`FoundryApi` without gaining silent autonomy:

- Smith has one persistent conversation per project plus an **All projects**
  conversation. Project scope retains direct checkout tools; global scope has a
  private support workspace and requires explicit project IDs.
- Read-only domain operations execute immediately. Persistent, destructive,
  credential-bearing, shell/process, Git/PR, run-lifecycle, network, maintenance,
  and app-lifecycle operations block on the inline approval card.
- Main collects the existing IPC routers into a main-only invoker. Domain tools
  map fixed operation enums to fixed existing channels; neither the model nor
  the renderer receives a generic channel dispatcher.
- Projects are fully inspectable. Agents, pipelines, and envelopes support the
  same rename/duplicate/reset/remove actions as their operator UI, and Smith can
  manage settings, projects, runs, PRs, interrupts, providers, Companion,
  diagnostics, maintenance, and updates.
- API key values exist only in the approval card's masked field and the approved
  main-process executor call. Companion pairing payloads exist only in a private
  card result. Neither enters a proposal, transcript, `chat-state.json`, log, or
  model-visible tool result.
- One proposal remains pending globally. Entity specs still validate before a
  card is raised; ordinary action failures clear the proposal so Smith can
  correct and retry. The parity manifest test makes every future invoke channel
  choose a Smith classification or the sole renderer-only plumbing exclusion.

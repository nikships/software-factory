/**
 * Readiness tools for Smith's chat session.
 *
 * Three factories wrap the existing readiness machinery so the chat can answer
 * "how ready is this repo", run "Make it ready", and confirm the readiness PR —
 * without owning any of the state. The invariants keep their code:
 *
 * - The marker committed on the base ref is the only readiness truth
 *   (`readMarkerAtBaseRef`); a merged PR is not proof, so `readiness_pr_status`
 *   finalizes by re-reading that ref after the fast-forward.
 * - Remediation runs on the isolated `foundry-ready/<id>` worktree, never in
 *   the operator's checkout, and a half-done onboarding parks on
 *   `needs_continue` with its branch intact.
 * - `needs_continue` state lives on the `ReadinessSession` the deps hand in —
 *   outside the chat session — so "New chat" never loses a paused onboarding.
 *
 * These are factories with explicit deps so the chat session that registers
 * them owns the wiring; nothing here reaches for `AppContext` or a registry
 * import. Tool typing crosses the pi seam through `pi/tool-definition.ts`,
 * same as the entity tools.
 */

import type { ReadinessEntry, ReadinessPhase, ReadinessState } from '@shared/types.js';
import { IPC } from '@shared/ipc-contract.js';
import { defineTool, type ToolDefinition } from '../pi/tool-definition.js';
import { evaluateRepo } from '../readiness/evaluate.js';
import { readMarkerAtBaseRef } from '../readiness/marker.js';
import type { MainInvoker } from '../ipc/shared.js';
import type { ProposalQueue } from './proposals.js';
import {
  field,
  immediate,
  json,
  objectField,
  parseOperation,
  proposeAction,
  resolveProjectId,
  type SmithActionToolDeps,
} from './tool-helpers.js';

export const READINESS_TOOL_NAMES = [
  'readiness_check',
  'readiness_remediate',
  'readiness_pr_status',
  'readiness_manage',
] as const;

export const READINESS_MANAGE_OPERATIONS = [
  'inspect',
  'evaluate',
  'state',
  'cancel',
  'skip',
  'retry',
  'confirm_merge',
  'dismiss',
] as const;

/**
 * Structured progress the chat renders as a distinct sub-agent seam. `entry`
 * events carry new transcript rows; `entry_update` re-carries a row whose text
 * or tool status was patched in place; `phase` marks state-machine movement.
 */
export type ReadinessProgressEvent =
  | { type: 'phase'; phase: ReadinessPhase; detail: string }
  | { type: 'entry'; entry: ReadinessEntry }
  | { type: 'entry_update'; entry: ReadinessEntry };

/**
 * The slice of `ReadinessSession` the tools drive. Kept structural so tests
 * can hand in the real session or a scripted stand-in without inheritance.
 */
export interface ReadinessSessionSurface {
  snapshot(): ReadinessState;
  makeReady(): Promise<ReadinessState>;
  confirmMerge(): Promise<ReadinessState>;
}

/**
 * Hands out the readiness session that owns `needs_continue` — the registry's
 * session, not the chat's. `observe` receives every state change for as long
 * as the session runs; the provider must hold it in a single slot (installing
 * a new observer replaces the previous one), so repeated tool calls in one
 * conversation do not stack listeners.
 */
export type ReadinessSessionProvider = (
  observe: (state: ReadinessState) => void,
) => ReadinessSessionSurface;

/** Everything the factories close over. The chat session owns all three. */
export interface ReadinessToolDeps {
  /** The project the chat is scoped to. Read per call; never captured. */
  project: () => { path: string; baseRef: string };
  session: ReadinessSessionProvider;
  onProgress: (event: ReadinessProgressEvent) => void;
  queue: ProposalQueue;
  projectId: () => string;
  /** Main-only handler path used by `readiness_manage`. */
  invoke?: MainInvoker;
}

const NO_PARAMS: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

/** Make-it-ready work in flight; a second start would collide with it. */
const LIVE_PHASES: ReadonlySet<ReadinessPhase> = new Set([
  'remediating',
  'verifying',
  'pr_ready',
  'confirming_merge',
  'finalizing',
]);

/**
 * Folds cloned state snapshots into progress events: each transcript row once,
 * an update when a row was patched in place, and every phase transition. Seen
 * ids are tracked per forwarder, so one tool call never re-emits history.
 */
function createProgressForwarder(
  onProgress: (event: ReadinessProgressEvent) => void,
): (state: ReadinessState) => void {
  const seen = new Set<string>();
  let lastEmitted: Pick<ReadinessEntry, 'id' | 'text' | 'done' | 'failed'> | null = null;
  let lastPhase: ReadinessPhase | null = null;
  let lastDetail: string | null = null;
  return (state) => {
    for (const entry of state.entries) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        onProgress({ type: 'entry', entry });
        lastEmitted = { id: entry.id, text: entry.text, done: entry.done, failed: entry.failed };
      } else if (
        lastEmitted &&
        entry.id === lastEmitted.id &&
        (entry.text !== lastEmitted.text ||
          entry.done !== lastEmitted.done ||
          entry.failed !== lastEmitted.failed)
      ) {
        onProgress({ type: 'entry_update', entry });
        lastEmitted = { id: entry.id, text: entry.text, done: entry.done, failed: entry.failed };
      }
    }
    if (state.phase !== lastPhase || state.detail !== lastDetail) {
      lastPhase = state.phase;
      lastDetail = state.detail;
      onProgress({ type: 'phase', phase: state.phase, detail: state.detail });
    }
  };
}

/** What `readiness_remediate` and `readiness_pr_status` answer with. */
function outcome(state: ReadinessState): Record<string, unknown> {
  return {
    phase: state.phase,
    detail: state.detail,
    needsContinue: state.phase === 'needs_continue',
    markerValid: state.markerValid,
    markerDetail: state.markerDetail,
    pr: state.pr,
    checklist: state.evaluation
      ? {
          ready: state.evaluation.ready,
          summary: state.evaluation.summary,
          failing: state.evaluation.criteria.filter((c) => c.status === 'fail').map((c) => c.id),
        }
      : null,
  };
}

/**
 * "How ready is this repo and why": the static checklist plus the marker as
 * committed on the base ref. Read-only; touches no session state.
 */
export function readinessCheckTool(deps: Pick<ReadinessToolDeps, 'project'>): ToolDefinition {
  return defineTool({
    name: 'readiness_check',
    label: 'Readiness check',
    description:
      'Evaluate how agent-ready this repository is: the static readiness checklist plus the ' +
      '.agents/agent-ready.json marker as committed on the base ref. The committed marker on ' +
      'the base ref is the only readiness truth — a marker in the working tree proves nothing. ' +
      'Read-only.',
    parameters: NO_PARAMS,
    execute: async () => {
      const project = deps.project();
      const evaluation = evaluateRepo(project.path);
      const read = await readMarkerAtBaseRef(project.path, project.baseRef);
      return json({
        ready: read.ok,
        authority:
          'Readiness is decided by the marker committed on the base ref; the checklist explains what remediation would fix.',
        marker: {
          ok: read.ok,
          detail: read.detail,
          source: read.source,
          ref: read.ref,
          summary: read.marker?.summary,
        },
        checklist: {
          ready: evaluation.ready,
          summary: evaluation.summary,
          stack: evaluation.stack,
          criteria: evaluation.criteria.map((c) => ({
            id: c.id,
            status: c.status,
            notes: c.notes,
          })),
        },
      });
    },
  });
}

/**
 * "Make it ready": runs (or continues) the write-capable remediator on the
 * isolated `foundry-ready/<id>` worktree via the injected session, streaming
 * its transcript as progress events. A miss parks on `needs_continue` with the
 * branch intact; calling again continues on that same branch.
 */
export function readinessRemediateTool(
  deps: Pick<ReadinessToolDeps, 'session' | 'onProgress' | 'queue' | 'projectId'>,
): ToolDefinition {
  return defineTool({
    name: 'readiness_remediate',
    label: 'Make it ready',
    description:
      'Start (or continue) making this repository agent-ready. A write-capable remediation ' +
      'agent runs on an isolated foundry-ready/<id> worktree — never in the checkout — then the ' +
      'checklist is re-verified, the marker is committed last, and a pull request is opened. ' +
      'A paused or partly-done onboarding keeps its branch; calling this again continues it.',
    parameters: NO_PARAMS,
    execute: async () => {
      const session = deps.session(createProgressForwarder(deps.onProgress));
      const before = session.snapshot();
      if (LIVE_PHASES.has(before.phase)) {
        return json({
          inProgress: true,
          phase: before.phase,
          detail: before.detail,
        });
      }
      return proposeAction(deps, {
        operation: 'remediate',
        title: 'Make project agent-ready',
        summary: 'Run the readiness remediator in its isolated readiness worktree.',
        args: { projectId: deps.projectId() },
        risk: 'git',
        projectId: deps.projectId(),
        execute: async () => ({ ok: true, result: outcome(await session.makeReady()) }),
      });
    },
  });
}

/**
 * Merge confirmation plus finalize. Verifies the PR actually merged through
 * the operator's gh, then re-reads the marker at the base ref after the
 * fast-forward — a merged PR on its own is not proof.
 */
export function readinessPrStatusTool(
  deps: Pick<ReadinessToolDeps, 'session' | 'onProgress' | 'queue' | 'projectId'>,
): ToolDefinition {
  return defineTool({
    name: 'readiness_pr_status',
    label: 'Readiness PR status',
    description:
      'Check whether the readiness pull request has merged and, when it has, finalize: ' +
      'fast-forward the base branch and re-read the committed marker there. A merged PR alone ' +
      'is not proof — readiness completes only when the marker is valid on the base ref.',
    parameters: NO_PARAMS,
    execute: async () => {
      const session = deps.session(createProgressForwarder(deps.onProgress));
      const before = session.snapshot();
      if (!before.pr) {
        return json({
          phase: before.phase,
          detail: 'There is no readiness pull request to check. Run readiness_remediate first.',
          prMerged: false,
          ready: false,
          markerValid: before.markerValid,
          markerDetail: before.markerDetail,
        });
      }
      return proposeAction(deps, {
        operation: 'confirm_merge',
        title: 'Confirm readiness merge',
        summary: 'Check the readiness PR, fast-forward the base, and verify its marker.',
        args: { projectId: deps.projectId(), pr: before.pr },
        risk: 'git',
        projectId: deps.projectId(),
        execute: async () => {
          const state = await session.confirmMerge();
          return {
            ok: true,
            result: {
              ...outcome(state),
              prMerged: !!state.pr?.merged,
              mergeDetail: state.mergeDetail,
              ready: state.phase === 'complete' && state.markerValid,
            },
          };
        },
      });
    },
  });
}

/** All three readiness tools, in the order the chat session registers them. */
export function readinessToolsFor(deps: ReadinessToolDeps): ToolDefinition[] {
  return [
    readinessCheckTool(deps),
    readinessRemediateTool(deps),
    readinessPrStatusTool(deps),
    readinessManageTool({
      queue: deps.queue,
      projectId: deps.projectId,
      invoke:
        deps.invoke ?? (() => Promise.reject(new Error('readiness main invoker is not attached'))),
    }),
  ];
}

export function readinessManageTool(deps: SmithActionToolDeps): ToolDefinition {
  return defineTool({
    name: 'readiness_manage',
    label: 'Readiness management',
    description: 'Inspect or manage project readiness. Mutating operations require approval.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...READINESS_MANAGE_OPERATIONS] },
        projectId: { type: 'string' },
        options: { type: 'object' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    execute: async (_id, params) => {
      const operation = parseOperation(params, READINESS_MANAGE_OPERATIONS);
      if (!operation) return json({ ok: false, error: 'unknown operation' });
      const scope = resolveProjectId(field(params, 'projectId'), deps.projectId(), true);
      if (!scope.ok) return json(scope);
      const projectId = scope.projectId as string;
      if (operation === 'inspect') return immediate(deps, IPC.readinessInspect, projectId);
      if (operation === 'state') return immediate(deps, IPC.readinessGet, projectId);
      const channel = {
        evaluate: IPC.readinessEvaluate,
        cancel: IPC.readinessCancel,
        skip: IPC.readinessSkip,
        retry: IPC.readinessRetry,
        confirm_merge: IPC.readinessConfirmMerge,
        dismiss: IPC.readinessDismiss,
      }[operation as Exclude<typeof operation, 'inspect' | 'state'>];
      const options = operation === 'evaluate' ? objectField(params, 'options') : null;
      return proposeAction(deps, {
        operation,
        title: `${operation.replaceAll('_', ' ')} readiness`,
        summary: `${operation.replaceAll('_', ' ')} readiness for project ${projectId}.`,
        args: { projectId, ...(options ? { options } : {}) },
        risk: operation === 'confirm_merge' ? 'git' : 'write',
        projectId,
        execute: () => deps.invoke(channel, projectId, ...(options ? [options] : [])),
      });
    },
  });
}

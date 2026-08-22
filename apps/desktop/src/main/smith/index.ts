/**
 * The Smith service: the proposal queue and the native chat sessions, wired
 * together and owned by `AppContext`. One instance per app.
 *
 * Smith is Foundry's entity-smith, running as an in-process chat on the
 * bundled pi runtime. The service validates what that agent proposes and
 * holds every write behind a human's Approve.
 */

import type { SmithEntityProposal } from '@shared/types.js';
import type { MainInvoker } from '../ipc/shared.js';
import type { SmithChatSession } from './chat-session.js';
import { ProposalQueue, type ProposalInput } from './proposals.js';

/**
 * Optional JSON `ProposalInput` the Electron UI smoke harness sets so a
 * pending card can render without a model. Production launches leave it unset.
 */
export const SMITH_E2E_PROPOSAL_ENV = 'FOUNDRY_E2E_SMITH_PROPOSAL';

/** Parse a fixture-seeded proposal. Malformed JSON is ignored, not thrown. */
export function readSmithProposalSeed(env: NodeJS.ProcessEnv = process.env): ProposalInput | null {
  const raw = env[SMITH_E2E_PROPOSAL_ENV];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProposalInput>;
    if (
      parsed.type === 'entity' &&
      (parsed.kind === 'agent' || parsed.kind === 'pipeline' || parsed.kind === 'envelope') &&
      (parsed.mode === 'create' || parsed.mode === 'edit') &&
      typeof parsed.name === 'string' &&
      parsed.name &&
      parsed.spec != null &&
      typeof parsed.spec === 'object'
    ) {
      return {
        type: 'entity',
        kind: parsed.kind,
        mode: parsed.mode,
        name: parsed.name,
        spec: parsed.spec,
        validation: Array.isArray(parsed.validation) ? parsed.validation : [],
        overwrites: parsed.overwrites === true,
        ...(typeof parsed.projectId === 'string' ? { projectId: parsed.projectId } : {}),
      };
    }
    if (
      parsed.type === 'action' &&
      typeof parsed.operation === 'string' &&
      parsed.operation &&
      typeof parsed.title === 'string' &&
      typeof parsed.summary === 'string' &&
      parsed.args != null &&
      typeof parsed.args === 'object' &&
      typeof parsed.risk === 'string'
    ) {
      return {
        type: 'action',
        operation: parsed.operation,
        title: parsed.title,
        summary: parsed.summary,
        args: parsed.args as Record<string, unknown>,
        risk: parsed.risk,
        ...(typeof parsed.projectId === 'string' ? { projectId: parsed.projectId } : {}),
        ...(parsed.secretRequest ? { secretRequest: parsed.secretRequest } : {}),
      };
    }
  } catch {
    // A bad fixture must not take the app down.
  }
  return null;
}

/** Everything the Smith service needs from the wider app, kept to a narrow seam. */
export interface SmithServiceDeps {
  /** Broadcasts a channel + payload to every window. */
  broadcast: (channel: string, payload?: unknown) => void;
  /** Channel name, passed in so this module does not import the contract twice. */
  channels: { proposalsChanged: string };
  /** Persists an approved proposal; supplied by the IPC layer (store access). */
  save: (
    proposal: SmithEntityProposal,
  ) => { ok: true; entity: unknown } | { ok: false; error: string };
  /** Opens one native chat lazily for a project scope or the global scope. */
  createChat: (projectId: string | undefined, proposals: ProposalQueue) => SmithChatSession | null;
  /** Optional pending proposal to enqueue at construction (tests / e2e). */
  seedProposal?: ProposalInput;
}

export class SmithService {
  readonly proposals: ProposalQueue;
  private readonly chats = new Map<string, SmithChatSession>();
  private invoker: MainInvoker | null = null;

  constructor(private readonly deps: SmithServiceDeps) {
    this.proposals = new ProposalQueue(
      () => deps.broadcast(deps.channels.proposalsChanged),
      // The queue awaits the save so an approve that fails the store keeps the
      // card up. The store call itself is synchronous; wrap it in a resolved
      // promise to satisfy the async handler contract.
      (proposal) => Promise.resolve(deps.save(proposal)),
    );
    const seed = deps.seedProposal ?? readSmithProposalSeed();
    if (seed) {
      void this.proposals.propose(
        seed,
        seed.type === 'action'
          ? () => ({ ok: true, modelResult: { ok: true, seeded: true } })
          : undefined,
      );
    }
  }

  /** Attach the collected main-process handlers before any window can use Smith. */
  attachInvoker(invoker: MainInvoker): void {
    this.invoker = invoker;
  }

  /** Narrow callback passed to fixed Smith tools; no renderer can reach it. */
  readonly invoke: MainInvoker = (channel, ...args) => {
    if (!this.invoker) return Promise.reject(new Error('Smith main invoker is not attached'));
    return this.invoker(channel, ...args);
  };

  /** One persistent native conversation per project/global scope, opened lazily. */
  chat(projectId?: string): SmithChatSession | null {
    const key = projectId ?? 'global';
    const existing = this.chats.get(key);
    if (existing) return existing;
    const chat = this.deps.createChat(projectId, this.proposals);
    if (chat) this.chats.set(key, chat);
    return chat;
  }

  dispose(): void {
    for (const chat of this.chats.values()) void chat.dispose();
    this.chats.clear();
    this.proposals.cancelAll();
  }
}

/**
 * Smith's one-slot approval queue. Public proposals are clone-safe data; the
 * pending entry may additionally retain one main-process executor closure.
 * Secrets flow from the card straight to that closure and are never copied
 * into the proposal, transcript, model result, or persisted chat state.
 */

import { randomUUID } from 'node:crypto';
import type {
  SmithActionProposal,
  SmithEntityProposal,
  SmithProposal,
  SmithProposalAnswer,
  SmithProposalAnswerResult,
  SmithProposalExecutionResult,
} from '@shared/types.js';

export type EntityProposalInput = Omit<SmithEntityProposal, 'id' | 'createdAt'>;
export type ActionProposalInput = Omit<SmithActionProposal, 'id' | 'createdAt'>;
export type ProposalInput = EntityProposalInput | ActionProposalInput;

/** The outcome returned only to the blocked model tool call. */
export type ProposalOutcome =
  { approved: true; result: unknown } | { approved: false; note?: string };

/** Main-only executor retained beside a public action proposal. */
export type ProposalExecutor = (
  answer: SmithProposalAnswer,
) => Promise<SmithProposalExecutionResult> | SmithProposalExecutionResult;

/** Entity persistence remains the queue's default, retryable executor. */
export type SaveHandler = (
  proposal: SmithEntityProposal,
) => Promise<{ ok: true; entity: unknown } | { ok: false; error: string }>;

interface PendingEntry {
  proposal: SmithProposal;
  executor: ProposalExecutor;
  resolve: (outcome: ProposalOutcome) => void;
  executing: boolean;
}

export class ProposalQueue {
  private pending: PendingEntry | null = null;

  constructor(
    private readonly onChanged: () => void,
    private readonly save: SaveHandler,
  ) {}

  list(): SmithProposal[] {
    return this.pending ? [this.pending.proposal] : [];
  }

  propose(input: ProposalInput, executor?: ProposalExecutor): Promise<ProposalOutcome> {
    if (this.pending) return Promise.reject(new Error('proposal_pending'));

    const proposal = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    } as SmithProposal;
    const run = executor ?? this.entityExecutor(proposal);

    return new Promise<ProposalOutcome>((resolve) => {
      this.pending = { proposal, executor: run, resolve, executing: false };
      this.onChanged();
    });
  }

  async answer(id: string, answer: SmithProposalAnswer): Promise<SmithProposalAnswerResult> {
    const entry = this.pending;
    if (!entry || entry.proposal.id !== id) {
      return { ok: false, error: 'proposal not found' };
    }
    if (entry.executing) return { ok: false, error: 'proposal is already executing' };

    if (!answer.approved) {
      this.clear(entry);
      entry.resolve({ approved: false, note: answer.note });
      return { ok: true };
    }

    if (
      answer.secret !== undefined &&
      (entry.proposal.type !== 'action' || !entry.proposal.secretRequest)
    ) {
      return { ok: false, error: 'this proposal does not accept a secret' };
    }
    if (
      entry.proposal.type === 'action' &&
      entry.proposal.secretRequest &&
      !answer.secret?.trim()
    ) {
      return { ok: false, error: `${entry.proposal.secretRequest.label} is required` };
    }

    entry.executing = true;
    let executed: SmithProposalExecutionResult;
    try {
      executed = await entry.executor(answer);
    } catch (error) {
      executed = { ok: false, error: message(error), retryable: entry.proposal.type === 'entity' };
    }

    if (!executed.ok) {
      if (executed.retryable) {
        entry.executing = false;
        return { ok: false, error: executed.error };
      }
      this.clear(entry);
      entry.resolve({ approved: true, result: { ok: false, error: executed.error } });
      return { ok: false, error: executed.error };
    }

    this.clear(entry);
    entry.resolve({ approved: true, result: executed.modelResult });
    return executed.privateDisplay
      ? { ok: true, privateDisplay: executed.privateDisplay }
      : { ok: true };
  }

  cancelAll(): void {
    const entry = this.pending;
    if (!entry) return;
    this.clear(entry);
    entry.resolve({ approved: false, note: 'Foundry is shutting down' });
  }

  private entityExecutor(proposal: SmithProposal): ProposalExecutor {
    if (proposal.type !== 'entity') {
      throw new Error('action proposals require an executor');
    }
    return async () => {
      const saved = await this.save(proposal);
      return saved.ok
        ? { ok: true, modelResult: { ok: true, entity: saved.entity } }
        : { ok: false, error: saved.error, retryable: true };
    };
  }

  private clear(entry: PendingEntry): void {
    if (this.pending !== entry) return;
    this.pending = null;
    this.onChanged();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

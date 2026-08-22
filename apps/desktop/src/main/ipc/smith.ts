/**
 * The Smith IPC slice: native chat lifecycle and the approval gate. Chat sends
 * return immediately after marking a turn live; cloned transcript snapshots
 * continue over `smith-progress`.
 */

import type {
  AgentDef,
  EnvelopeDef,
  PipelineDef,
  SmithEntityProposal,
  SmithProposalAnswer,
} from '@shared/types.js';
import { IPC, type SmithChatState, type SmithScreenContext } from '@shared/ipc-contract.js';
import type { AppContext } from '../context.js';
import type { Handle } from './shared.js';
import { notifySettings } from './shared.js';

type Ctx = Pick<AppContext, 'smith' | 'broadcast'>;

export function register(ctx: Ctx, handle: Handle): void {
  handle(
    IPC.smithSend,
    (
      projectId: string | undefined,
      text: string,
      screen: SmithScreenContext,
    ): SmithChatState | null => {
      const chat = ctx.smith.chat(projectId);
      if (!chat) return null;
      if (!text.trim()) return chat.snapshot();
      // The invoke acknowledges the turn; transcript progress and completion
      // are pushed. SmithChatSession records failures in its own state before
      // rejecting, so the detached promise cannot hide an error from the UI.
      void chat.send(text, { screen }).catch(() => undefined);
      return chat.snapshot();
    },
  );

  handle(IPC.smithCancel, async (projectId?: string): Promise<SmithChatState | null> => {
    const chat = ctx.smith.chat(projectId);
    if (!chat) return null;
    await chat.cancel();
    return chat.snapshot();
  });

  handle(IPC.smithNewChat, async (projectId?: string): Promise<SmithChatState | null> => {
    const chat = ctx.smith.chat(projectId);
    if (!chat) return null;
    await chat.newChat();
    return chat.snapshot();
  });

  handle(
    IPC.smithState,
    (projectId?: string): SmithChatState | null => ctx.smith.chat(projectId)?.snapshot() ?? null,
  );

  handle(
    IPC.smithSetModel,
    async (projectId: string | undefined, model: string): Promise<SmithChatState | null> => {
      const chat = ctx.smith.chat(projectId);
      if (!chat) return null;
      if (!model.trim()) throw new Error('model is required');
      await chat.setModel(model);
      return chat.snapshot();
    },
  );

  handle(IPC.smithProposalsList, () => ctx.smith.proposals.list());
  handle(IPC.smithAnswerProposal, (id: string, answer: SmithProposalAnswer) =>
    ctx.smith.proposals.answer(id, answer),
  );
}

/**
 * Persists an approved proposal through the existing store layer, scope-aware,
 * and broadcasts the same settings-changed event a form save would. Returns the
 * saved entity for the CLI, or an error the proposal card can show. Wired into
 * the queue from `context.ts` so the queue never imports a store.
 */
export function saveProposal(
  ctx: Pick<
    AppContext,
    | 'roster'
    | 'pipelines'
    | 'envelopes'
    | 'rosterScope'
    | 'pipelineScope'
    | 'rosterFor'
    | 'commandNames'
    | 'broadcast'
  >,
  proposal: SmithEntityProposal,
): { ok: true; entity: unknown } | { ok: false; error: string } {
  const projectId = proposal.targetProjectId ?? proposal.projectId;
  const knownEnvelopes = ctx.envelopes.list().map((e) => e.name);

  if (proposal.kind === 'agent') {
    const agent = proposal.spec as AgentDef;
    const result = ctx.roster.save(agent, ctx.rosterScope(projectId), knownEnvelopes);
    if (!result.ok) return { ok: false, error: issueText(result.issues) };
    notifySettings(ctx);
    return { ok: true, entity: agent };
  }

  if (proposal.kind === 'pipeline') {
    const pipeline = proposal.spec as PipelineDef;
    const result = ctx.pipelines.save(
      pipeline,
      ctx.rosterFor(projectId),
      ctx.commandNames(projectId),
      ctx.pipelineScope(projectId),
      knownEnvelopes,
    );
    if (!result.ok) return { ok: false, error: issueText(result.issues) };
    notifySettings(ctx);
    return { ok: true, entity: pipeline };
  }

  const envelope = proposal.spec as EnvelopeDef;
  const result = ctx.envelopes.save(envelope);
  if (!result.ok) return { ok: false, error: issueText(result.issues) };
  notifySettings(ctx);
  return { ok: true, entity: envelope };
}

function issueText(issues: { where: string; message: string }[]): string {
  return issues.map((i) => `${i.where}: ${i.message}`).join('; ') || 'save failed';
}

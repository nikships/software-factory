/**
 * Smith's native chat router is deliberately a thin acknowledgement layer:
 * one turn continues in main while cloned state crosses IPC immediately and
 * then over smith-progress. These tests pin that lifecycle and the exact
 * screen descriptor forwarded with the user message.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SmithChatState, SmithScreenContext } from '../../../src/shared/ipc-contract.js';
import { IPC } from '../../../src/shared/ipc-contract.js';
import { register } from '../../../src/main/ipc/smith.js';
import type { Handle } from '../../../src/main/ipc/shared.js';

type Handler = (...args: never[]) => unknown;

function state(over: Partial<SmithChatState> = {}): SmithChatState {
  return {
    projectId: 'proj_1',
    model: 'inherit',
    activeModel: 'provider/model',
    running: false,
    error: null,
    transcript: [],
    ...over,
  };
}

function harness(chatPresent = true) {
  let current = state();
  let finishTurn: (() => void) | null = null;
  const parked = new Promise<void>((resolve) => {
    finishTurn = resolve;
  });
  const chat = {
    snapshot: vi.fn((): SmithChatState => ({
      ...current,
      transcript: current.transcript.map((entry) => ({ ...entry })),
    })),
    send: vi.fn((text: string, input: { screen?: SmithScreenContext }) => {
      current = {
        ...current,
        running: true,
        transcript: [
          ...current.transcript,
          { id: 'user-1', kind: 'text', text, source: 'operator', at: 1 },
        ],
      };
      void input;
      return parked;
    }),
    cancel: vi.fn(async () => {
      current = { ...current, running: false };
    }),
    newChat: vi.fn(async () => {
      current = { ...current, transcript: [] };
    }),
    setModel: vi.fn(async (model: string) => {
      current = { ...current, model, activeModel: model };
    }),
  };
  const answer = vi.fn(async () => ({ ok: true as const }));
  const handlers = new Map<string, Handler>();
  const handle: Handle = (channel, fn) => handlers.set(channel, fn);
  register(
    {
      smith: {
        chat: () => (chatPresent ? chat : null),
        proposals: { list: () => [], answer },
      },
      broadcast: vi.fn(),
    } as never,
    handle,
  );
  return { handlers, chat, answer, finishTurn: () => finishTurn?.() };
}

describe('Smith chat IPC router', () => {
  it('registers the native lifecycle and existing proposal channels', () => {
    const { handlers } = harness();
    expect([...handlers.keys()]).toEqual([
      IPC.smithSend,
      IPC.smithCancel,
      IPC.smithNewChat,
      IPC.smithState,
      IPC.smithSetModel,
      IPC.smithProposalsList,
      IPC.smithAnswerProposal,
    ]);
  });

  it('acknowledges send before the turn settles and forwards screen context', () => {
    const { handlers, chat, finishTurn } = harness();
    const screen: SmithScreenContext = {
      route: 'runs',
      entity: { kind: 'run', id: 'run_42' },
    };
    const send = handlers.get(IPC.smithSend) as (
      projectId: string,
      text: string,
      screen: SmithScreenContext,
    ) => SmithChatState;

    const acknowledged = send('proj_1', 'Why did this fail?', screen);
    expect(acknowledged.running).toBe(true);
    expect(chat.send).toHaveBeenCalledWith('Why did this fail?', { screen });
    expect(() => structuredClone(acknowledged)).not.toThrow();
    finishTurn();
  });

  it('delegates cancel, new chat, state, and model switching', async () => {
    const { handlers, chat } = harness();
    const cancel = handlers.get(IPC.smithCancel) as (projectId: string) => Promise<SmithChatState>;
    const newChat = handlers.get(IPC.smithNewChat) as (
      projectId: string,
    ) => Promise<SmithChatState>;
    const read = handlers.get(IPC.smithState) as (projectId: string) => SmithChatState;
    const setModel = handlers.get(IPC.smithSetModel) as (
      projectId: string,
      model: string,
    ) => Promise<SmithChatState>;

    expect((await cancel('proj_1')).running).toBe(false);
    expect((await newChat('proj_1')).transcript).toEqual([]);
    expect(read('proj_1').projectId).toBe('proj_1');
    expect((await setModel('proj_1', 'provider/next')).model).toBe('provider/next');
    expect(chat.cancel).toHaveBeenCalledOnce();
    expect(chat.newChat).toHaveBeenCalledOnce();
    expect(chat.setModel).toHaveBeenCalledWith('provider/next');
  });

  it('answers null when the requested project has no chat', async () => {
    const { handlers } = harness(false);
    const read = handlers.get(IPC.smithState) as (projectId: string) => SmithChatState | null;
    const cancel = handlers.get(IPC.smithCancel) as (
      projectId: string,
    ) => Promise<SmithChatState | null>;
    expect(read('missing')).toBeNull();
    await expect(cancel('missing')).resolves.toBeNull();
  });

  it('returns the structured proposal answer from the shared queue', async () => {
    const { handlers, answer } = harness();
    const answerProposal = handlers.get(IPC.smithAnswerProposal) as (
      id: string,
      response: { approved: boolean },
    ) => Promise<{ ok: true }>;
    await expect(answerProposal('proposal-1', { approved: true })).resolves.toEqual({ ok: true });
    expect(answer).toHaveBeenCalledWith('proposal-1', { approved: true });
  });
});

/**
 * The Smith mini chat: a Fin-style floating launcher stuck to the bottom-right
 * of every screen, opening a compact popover over the same conversation the
 * dedicated Smith screen shows — one shared session, two views.
 *
 * Always visible by design (not configurable). The launcher badges when a
 * proposal is waiting on the operator, and when a turn finishes while the
 * popover is closed — the "long task done" signal, cleared on open. Full
 * capabilities: approvals and readiness render in the popover through the same
 * transcript and card components as the screen, just compact.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SmithScreenContext } from '@shared/ipc-contract.js';
import { api } from '../../api.js';
import { useApp } from '../../stores/app.js';
import { useSmithChat } from '../../hooks/useSmithChat.js';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';
import SmithProposalCard, { type SmithNavTarget } from './SmithProposalCard.js';
import SmithScopePicker from './SmithScopePicker.js';
import SmithTranscript from './SmithTranscript.js';
import { Button } from '../ui/Button.js';
import { SmithEmblem } from '../layout/SidebarEmblems.js';
import styles from './SmithBubble.module.css';

export default function SmithBubble({
  screenContext,
  onExpand,
  onCompleted,
}: {
  /** What the operator is looking at right now, sent with each message. */
  screenContext: SmithScreenContext;
  /** Opens the dedicated Smith screen — same session, so the point carries. */
  onExpand: () => void;
  /** Navigates to the saved entity's editor after an approved proposal saves. */
  onCompleted: (target?: SmithNavTarget) => void | Promise<void>;
}): React.JSX.Element {
  const { projects, smithProjectId } = useApp();
  const smithProject = projects.find((project) => project.id === smithProjectId) ?? null;
  const scopeId = smithProjectId ?? undefined;
  const { state, send, cancel, newChat } = useSmithChat(scopeId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [proposalPending, setProposalPending] = useState(false);
  /** A turn settled while the popover was closed; cleared on open. */
  const [finishedWhileClosed, setFinishedWhileClosed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const wasRunningRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  const running = state?.running ?? false;
  const transcript = useMemo(() => state?.transcript ?? [], [state?.transcript]);

  useEffect(() => {
    const refresh = async (): Promise<void> => {
      const list = await api.smith.proposalsList();
      setProposalPending(list.length > 0);
    };
    void refresh();
    return api.on('smith-proposals-changed', () => void refresh());
  }, []);

  // A project switch resets the chat state to null (running=false), which
  // would read as a finished turn from the previous project's running=true.
  useEffect(() => {
    wasRunningRef.current = false;
    setFinishedWhileClosed(false);
  }, [scopeId]);

  // The "long task finished" badge: a running→settled edge observed while the
  // popover is closed. Reading `open` through a ref keeps the edge detector
  // from re-arming (and mis-firing) every time the popover toggles.
  useEffect(() => {
    if (wasRunningRef.current && !running && !openRef.current) {
      setFinishedWhileClosed(true);
    }
    wasRunningRef.current = running;
  }, [running]);

  const openPopover = useCallback((): void => {
    setOpen(true);
    setFinishedWhileClosed(false);
  }, []);

  const close = useCallback((): void => setOpen(false), []);
  useEscapeToClose(close, open);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = (): void => {
    const text = draft.trim();
    if (!text || running) return;
    setDraft('');
    void send(text, screenContext);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const badge = proposalPending || finishedWhileClosed;

  return (
    <div className={styles.anchor}>
      {open && (
        <div
          className={styles.popover}
          role="dialog"
          aria-label="Smith chat"
          data-testid="smith-popover"
        >
          <header className={styles.popoverHead}>
            <span className={styles.identity}>
              <SmithEmblem size={15} className={styles.identityMark} />
              Smith
            </span>
            <SmithScopePicker running={running} />
            <span className={styles.headSpacer} />
            <button
              type="button"
              className={styles.headAction}
              onClick={() => void newChat()}
              title="New chat — wipes the conversation and starts fresh"
              aria-label="New chat"
              data-testid="smith-bubble-new-chat"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M8 5.2v5.6M5.2 8h5.6"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className={styles.headAction}
              onClick={() => {
                close();
                onExpand();
              }}
              title="Open the full Smith screen"
              aria-label="Expand to the Smith screen"
              data-testid="smith-bubble-expand"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className={styles.headAction}
              onClick={close}
              title="Close"
              aria-label="Close Smith chat"
              data-testid="smith-bubble-close"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          <SmithTranscript
            entries={transcript}
            running={running}
            compact
            emptyState={
              <div className={styles.empty}>
                {smithProject ? (
                  <p>Ask Smith anything about {smithProject.name} — entities, readiness, runs.</p>
                ) : (
                  <p>Ask Smith to inspect and manage Foundry across all projects.</p>
                )}
              </div>
            }
            tail={
              <div className={styles.cardSlot}>
                <SmithProposalCard projectId={scopeId} onCompleted={onCompleted} />
              </div>
            }
          />

          {state?.error && (
            <div className={styles.errorBanner} role="alert">
              {state.error}
            </div>
          )}

          <footer className={styles.composer}>
            <textarea
              ref={inputRef}
              className={`textarea ${styles.input}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={smithProject ? 'Message Smith…' : 'Message Smith across all projects…'}
              rows={1}
              aria-label="Message Smith"
              data-testid="smith-bubble-input"
            />
            {running ? (
              <Button size="sm" onClick={() => void cancel()} data-testid="smith-bubble-cancel">
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={!draft.trim()}
                onClick={submit}
                data-testid="smith-bubble-send"
              >
                Send
              </Button>
            )}
          </footer>
        </div>
      )}

      <button
        type="button"
        className={styles.launcher}
        onClick={() => (open ? close() : openPopover())}
        title="Smith"
        aria-label={open ? 'Close Smith chat' : 'Open Smith chat'}
        aria-expanded={open}
        data-testid="smith-bubble"
      >
        <SmithEmblem size={22} className={styles.launcherMark} />
        {badge && (
          <span
            className={`${styles.badge} ${proposalPending ? styles.badgeProposal : ''}`}
            aria-hidden
            data-testid="smith-bubble-badge"
          />
        )}
      </button>
    </div>
  );
}

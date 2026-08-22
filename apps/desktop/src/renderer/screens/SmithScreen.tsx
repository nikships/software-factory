/**
 * The dedicated Smith screen: one full-page view of the project's persistent
 * chat with Foundry's entity-smith, running on the bundled pi runtime.
 *
 * The transcript arrives pre-folded from main (`smith-progress` pushes cloned
 * snapshots), so this screen only groups consecutive same-source rows and
 * renders them: operator turns as chat bubbles, Smith's work as inspector-style
 * tool rows, and readiness sub-agent turns as a visually distinct block — the
 * same seam the Inspector draws around run phases. The pending proposal card
 * renders inline at the transcript's tail, where the conversation produced it.
 */

import { useMemo, useRef, useState } from 'react';
import type { SmithScreenContext } from '@shared/ipc-contract.js';
import { useApp } from '../stores/app.js';
import { useAgentModels } from '../hooks/useAgentModels.js';
import { useSmithChat } from '../hooks/useSmithChat.js';
import { SMITH_NO_PROVIDER_COPY } from '../view-models/smith-copy.js';
import ModelPicker from '../components/common/ModelPicker.js';
import SmithProposalCard, { type SmithNavTarget } from '../components/smith/SmithProposalCard.js';
import SmithScopePicker from '../components/smith/SmithScopePicker.js';
import SmithTranscript from '../components/smith/SmithTranscript.js';
import { Button } from '../components/ui/Button.js';
import styles from './SmithScreen.module.css';

export default function SmithScreen({
  screenContext,
  onCompleted,
}: {
  /** What the operator was looking at before opening Smith, sent with each message. */
  screenContext: SmithScreenContext;
  /** Navigates to the saved entity's editor after an approved proposal saves. */
  onCompleted: (target?: SmithNavTarget) => void | Promise<void>;
}): React.JSX.Element {
  const { projects, smithProjectId } = useApp();
  const smithProject = projects.find((project) => project.id === smithProjectId) ?? null;
  const scopeId = smithProjectId ?? undefined;
  const { state, send, cancel, newChat, setModel } = useSmithChat(scopeId);
  const { models, refresh: refreshModels } = useAgentModels();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const running = state?.running ?? false;
  const transcript = useMemo(() => state?.transcript ?? [], [state?.transcript]);

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

  return (
    <div className={styles.smith}>
      <header className={styles.head}>
        <p className="eyebrow">
          <span className="index">07</span>Smith
        </p>
        <SmithScopePicker running={running} />
        <div className={styles.headControls}>
          <div className={styles.modelPicker} data-testid="smith-model">
            <ModelPicker
              value={state?.model ?? 'inherit'}
              models={models}
              allowInherit
              inheritLabel="Default (Settings → Smith)"
              emptyHint={SMITH_NO_PROVIDER_COPY}
              onChange={(v) => void setModel(v)}
              onRefresh={() => void refreshModels()}
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void newChat()}
            title="New chat — wipes the conversation and starts fresh"
            aria-label="New chat"
            data-testid="smith-new-chat"
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
            New chat
          </Button>
        </div>
      </header>

      <SmithTranscript
        entries={transcript}
        running={running}
        emptyState={
          <div className={styles.emptyState}>
            <h2 className={styles.emptyTitle}>Smith</h2>
            <p>
              {smithProject
                ? `Ask Smith to inspect or operate ${smithProject.name}, including its checkout, entities, readiness, runs, and pull requests.`
                : 'Ask Smith to inspect or manage Foundry across all projects. Project-specific actions use explicit project IDs.'}{' '}
              Every privileged action waits on your approval here in the chat.
            </p>
            {models.length === 0 && <p className={styles.emptyHint}>{SMITH_NO_PROVIDER_COPY}</p>}
          </div>
        }
        tail={<SmithProposalCard projectId={scopeId} onCompleted={onCompleted} />}
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
          placeholder={
            smithProject
              ? `Ask Smith anything about ${smithProject.name}…`
              : 'Ask Smith to manage Foundry across all projects…'
          }
          rows={2}
          aria-label="Message Smith"
          data-testid="smith-input"
        />
        <div className={styles.composerActions}>
          {running ? (
            <Button onClick={() => void cancel()} data-testid="smith-cancel">
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!draft.trim()}
              onClick={submit}
              data-testid="smith-send"
            >
              Send
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

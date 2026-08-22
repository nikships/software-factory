/** Inline approval card for entity saves and fixed privileged Smith actions. */

import { useCallback, useEffect, useState } from 'react';
import type { SmithEntityProposal, SmithPrivateDisplay, SmithProposal } from '@shared/types.js';
import { api } from '../../api.js';
import QrCode from '../media/QrCode.js';
import { Button } from '../ui/Button.js';
import styles from './SmithProposalCard.module.css';

export interface SmithNavTarget {
  kind: SmithEntityProposal['kind'];
  name: string;
}

const KIND_LABEL: Record<SmithEntityProposal['kind'], string> = {
  agent: 'agent',
  pipeline: 'pipeline',
  envelope: 'report',
};

export default function SmithProposalCard({
  projectId,
  onCompleted,
}: {
  /** Conversation scope; absent means All projects. */
  projectId?: string;
  /** Refreshes app state; entity saves additionally provide a Design target. */
  onCompleted: (target?: SmithNavTarget) => void | Promise<void>;
}): React.JSX.Element | null {
  const [proposal, setProposal] = useState<SmithProposal | null>(null);
  const [privateDisplay, setPrivateDisplay] = useState<SmithPrivateDisplay | null>(null);
  const [secret, setSecret] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    const pending = (await api.smith.proposalsList())[0];
    setProposal(pending?.projectId === projectId ? pending : null);
  }, [projectId]);

  useEffect(() => {
    void refresh();
    return api.on('smith-proposals-changed', () => void refresh());
  }, [refresh]);

  const proposalId = proposal?.id ?? '';
  useEffect(() => {
    setError('');
    setSending(false);
    setSecret('');
    if (proposalId) setPrivateDisplay(null);
  }, [proposalId]);

  useEffect(() => {
    setError('');
    setSending(false);
    setSecret('');
    setPrivateDisplay(null);
  }, [projectId]);

  if (!proposal && !privateDisplay) return null;

  const answer = async (approved: boolean): Promise<void> => {
    if (!proposal || sending) return;
    setSending(true);
    setError('');
    try {
      const result = await api.smith.answerProposal(proposal.id, {
        approved,
        ...(approved && proposal.type === 'action' && proposal.secretRequest ? { secret } : {}),
      });
      setSecret('');
      if (!result.ok) {
        setError(result.error);
        setSending(false);
        return;
      }
      if (result.privateDisplay) setPrivateDisplay(result.privateDisplay);
      if (approved) {
        await onCompleted(
          proposal.type === 'entity' ? { kind: proposal.kind, name: proposal.name } : undefined,
        );
      }
      await refresh();
      setSending(false);
    } catch (caught) {
      setSecret('');
      setError(caught instanceof Error ? caught.message : 'Could not send that answer.');
      setSending(false);
    }
  };

  if (!proposal && privateDisplay) {
    const encoded = JSON.stringify(privateDisplay.payload);
    return (
      <section className={styles.card} data-testid="smith-private-display">
        <header className={styles.header}>
          <span className={styles.kind}>private</span>
          <h2 className={styles.title}>Companion pairing</h2>
        </header>
        <p className={styles.summary}>Scan this QR on the device you want to pair.</p>
        <div className={styles.qr}>
          <QrCode value={encoded} size={200} title="Companion pairing QR code" />
        </div>
        <footer className={styles.footer}>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(encoded);
            }}
          >
            Copy pairing code
          </Button>
          <Button
            onClick={() => {
              void api.companion.pairingPayload({ refresh: true }).then((payload) => {
                if (payload) setPrivateDisplay({ kind: 'companion-pairing', payload });
              });
            }}
          >
            Refresh
          </Button>
          <span className={styles.spacer} />
          <Button onClick={() => setPrivateDisplay(null)}>Dismiss</Button>
        </footer>
      </section>
    );
  }

  if (!proposal) return null;
  return proposal.type === 'entity' ? (
    <EntityCard
      proposal={proposal}
      sending={sending}
      error={error}
      onAnswer={(approved) => void answer(approved)}
    />
  ) : (
    <section
      className={styles.card}
      aria-labelledby="smith-proposal-title"
      data-testid="smith-proposal-card"
    >
      <header className={styles.header}>
        <span className={styles.kind}>action</span>
        <span className={`${styles.mode} ${styles.risk}`}>{proposal.risk}</span>
        <h2 className={styles.title} id="smith-proposal-title">
          {proposal.title}
        </h2>
      </header>
      <p className={styles.summary}>{proposal.summary}</p>
      <p className={styles.scopeNote}>
        Scope: {proposal.projectId ? `project ${proposal.projectId}` : 'All projects'} · Operation:{' '}
        <code>{proposal.operation}</code>
      </p>
      <pre className={`${styles.spec} selectable`}>{JSON.stringify(proposal.args, null, 2)}</pre>
      {proposal.secretRequest && (
        <label className={styles.secretField}>
          <span>{proposal.secretRequest.label}</span>
          <input
            type="password"
            autoComplete="off"
            value={secret}
            placeholder={proposal.secretRequest.placeholder}
            onChange={(event) => setSecret(event.currentTarget.value)}
            data-testid="smith-proposal-secret"
          />
        </label>
      )}
      <CardFooter
        sending={sending}
        error={error}
        approveDisabled={!!proposal.secretRequest && !secret.trim()}
        approveLabel={
          proposal.risk === 'destructive' ? 'Approve destructive action' : 'Approve action'
        }
        onAnswer={(approved) => void answer(approved)}
      />
    </section>
  );
}

function EntityCard({
  proposal,
  sending,
  error,
  onAnswer,
}: {
  proposal: SmithEntityProposal;
  sending: boolean;
  error: string;
  onAnswer: (approved: boolean) => void;
}): React.JSX.Element {
  return (
    <section className={styles.card} data-testid="smith-proposal-card">
      <header className={styles.header}>
        <span className={styles.kind}>{KIND_LABEL[proposal.kind]}</span>
        <span className={`${styles.mode} ${proposal.overwrites ? styles.modeOverwrite : ''}`}>
          {proposal.overwrites ? 'overwrite' : 'create'}
        </span>
        <h2 className={styles.title}>
          Smith wants to {proposal.overwrites ? 'overwrite' : 'create'}{' '}
          <span className={styles.name}>{proposal.name}</span>
        </h2>
      </header>
      {proposal.overwrites && (
        <p className={styles.overwriteNote}>
          A {KIND_LABEL[proposal.kind]} named <strong>{proposal.name}</strong> already exists.
          Approving replaces its current definition.
        </p>
      )}
      <pre className={`${styles.spec} selectable`}>{JSON.stringify(proposal.spec, null, 2)}</pre>
      {proposal.validation.length > 0 && (
        <div className={styles.warnings}>
          {proposal.validation.map((issue, index) => (
            <span key={`${issue.where}-${index}`} className={styles.warning}>
              <span className={styles.warningWhere}>{issue.where}</span>
              {issue.message}
            </span>
          ))}
        </div>
      )}
      <CardFooter
        sending={sending}
        error={error}
        approveDisabled={false}
        approveLabel="Approve"
        onAnswer={onAnswer}
      />
    </section>
  );
}

function CardFooter({
  sending,
  error,
  approveDisabled,
  approveLabel,
  onAnswer,
}: {
  sending: boolean;
  error: string;
  approveDisabled: boolean;
  approveLabel: string;
  onAnswer: (approved: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <footer className={styles.footer}>
        <Button
          disabled={sending}
          onClick={() => onAnswer(false)}
          data-testid="smith-proposal-reject"
        >
          {sending ? 'Sending…' : 'Reject'}
        </Button>
        <span className={styles.spacer} />
        <Button
          variant="primary"
          disabled={sending || approveDisabled}
          onClick={() => onAnswer(true)}
          data-testid="smith-proposal-approve"
        >
          {sending ? 'Running…' : approveLabel}
        </Button>
      </footer>
    </>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useApp } from '../../stores/app.js';
import styles from './SmithScopePicker.module.css';

const ALL = '__all__';

export default function SmithScopePicker({ running }: { running: boolean }): React.JSX.Element {
  const { projects, smithProjectId, selectSmithProject } = useApp();
  const [proposalPending, setProposalPending] = useState(false);

  useEffect(() => {
    const refresh = async (): Promise<void> => {
      const proposal = (await api.smith.proposalsList())[0];
      setProposalPending(!!proposal && proposal.projectId === (smithProjectId ?? undefined));
    };
    void refresh();
    return api.on('smith-proposals-changed', () => void refresh());
  }, [smithProjectId]);

  return (
    <label className={styles.scope}>
      <span className={styles.label}>Scope</span>
      <select
        className={styles.select}
        value={smithProjectId ?? ALL}
        disabled={running || proposalPending}
        onChange={(event) =>
          selectSmithProject(event.currentTarget.value === ALL ? null : event.currentTarget.value)
        }
        aria-label="Smith scope"
        data-testid="smith-scope"
      >
        <option value={ALL}>All projects</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id} title={project.path}>
            {project.name} — {project.path}
          </option>
        ))}
      </select>
    </label>
  );
}

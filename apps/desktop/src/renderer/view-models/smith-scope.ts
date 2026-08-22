import type { ProjectDef } from '@shared/types.js';

/** Resolve Smith's persisted/global scope after the project registry changes. */
export function resolveSmithProjectId(
  projects: Pick<ProjectDef, 'id'>[],
  selectedProjectId: string,
  current: string | null,
  hasSavedPreference: boolean,
): string | null {
  const fallback = projects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : (projects[0]?.id ?? null);
  if (!hasSavedPreference) return fallback;
  if (current === null) return null;
  return projects.some((project) => project.id === current) ? current : fallback;
}

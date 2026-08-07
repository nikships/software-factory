/**
 * Pipelines are data. This store owns the documents and the validation rail the
 * Designer draws from: the rules that used to fire at construction time inside
 * a Python script now fire at edit time, where a human can still fix them.
 */

import { join } from 'node:path';
import { z } from 'zod';
import type { AgentDef, PipelineDef, ValidationIssue } from '@shared/types.js';
import { JsonStore } from './json-store.js';
import { BUILTIN_PIPELINES } from './builtin-pipelines.js';
import { GATES } from '../engine/gates.js';

const commandSchema = z.union([
  z.object({ ref: z.string().min(1) }),
  z.object({
    builtin: z.enum(['git_commit', 'git_status', 'noop']),
    messageFrom: z.string().optional(),
  }),
  z.object({ argv: z.array(z.string().min(1)).min(1) }),
]);

const phaseSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase snake_case phase name'),
  kind: z.enum(['agent', 'code', 'engineer']),
  description: z.string().min(1, 'one sentence on what this phase does and why'),
  agent: z.string().optional(),
  envelope: z.enum(['generic', 'plan', 'build', 'scout', 'review', 'document']).optional(),
  gates: z
    .array(
      z.union([
        z.string(),
        z.object({ gate: z.string(), config: z.record(z.string(), z.unknown()).optional() }),
      ]),
    )
    .optional(),
  prompt: z.object({ template: z.string(), inputs: z.array(z.string()) }).optional(),
  command: commandSchema.optional(),
  retries: z.number().int().min(0).max(5).optional(),
  feedbackTo: z.string().optional(),
  feedbackRetries: z.number().int().min(0).max(5).optional(),
  question: z.string().optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  optional: z.boolean().optional(),
});

export const pipelineSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase kebab-case id'),
  name: z.string().min(1),
  description: z.string().min(1),
  acceptance: z.union([
    z.object({
      kind: z.literal('phase_flag'),
      phase: z.string(),
      flag: z.enum(['passed', 'approved']),
    }),
    z.object({ kind: z.literal('all_phases_pass') }),
    z.object({ kind: z.literal('last_phase_pass') }),
    z.object({ kind: z.literal('envelope_status'), phase: z.string() }),
  ]),
  phases: z.array(phaseSchema).min(1, 'a pipeline needs at least one phase'),
  isolation: z.boolean().optional(),
  builtin: z.boolean().optional(),
});

export class PipelineStore {
  private readonly appStore: JsonStore<PipelineDef[]>;
  private readonly projectStores = new Map<string, JsonStore<PipelineDef[]>>();

  constructor(private readonly appSupportDir: string) {
    this.appStore = new JsonStore<PipelineDef[]>(
      join(appSupportDir, 'pipelines.json'),
      () => BUILTIN_PIPELINES.map((p) => ({ ...p })),
      (raw) => {
        const list = Array.isArray(raw) ? (raw as PipelineDef[]) : [];
        const byId = new Map(list.map((p) => [p.id, p]));
        for (const builtin of BUILTIN_PIPELINES) {
          if (!byId.has(builtin.id)) byId.set(builtin.id, { ...builtin });
        }
        return [...byId.values()];
      },
    );
  }

  private projectStore(projectId: string): JsonStore<PipelineDef[]> {
    let store = this.projectStores.get(projectId);
    if (!store) {
      store = new JsonStore<PipelineDef[]>(
        join(this.appSupportDir, 'project-overrides', projectId, 'pipelines.json'),
        () => this.appStore.read().map((p) => ({ ...p })),
      );
      this.projectStores.set(projectId, store);
    }
    return store;
  }

  private storeFor(
    opts: { projectId?: string; ownPipelines?: boolean } = {},
  ): JsonStore<PipelineDef[]> {
    return opts.projectId && opts.ownPipelines ? this.projectStore(opts.projectId) : this.appStore;
  }

  list(opts: { projectId?: string; ownPipelines?: boolean } = {}): PipelineDef[] {
    return this.storeFor(opts).read();
  }

  get(id: string, opts: { projectId?: string; ownPipelines?: boolean } = {}): PipelineDef | null {
    return this.list(opts).find((p) => p.id === id) ?? null;
  }

  save(
    pipeline: PipelineDef,
    agents: AgentDef[],
    commandNames: string[],
    opts: { projectId?: string; ownPipelines?: boolean } = {},
  ): { ok: true; pipelines: PipelineDef[] } | { ok: false; issues: ValidationIssue[] } {
    const issues = validate(pipeline, agents, commandNames);
    if (issues.some((i) => i.level === 'error')) return { ok: false, issues };
    const next = this.storeFor(opts).update((current) =>
      upsertBy(current, (p) => p.id === pipeline.id, pipeline),
    );
    return { ok: true, pipelines: next };
  }

  remove(id: string, opts: { projectId?: string; ownPipelines?: boolean } = {}): PipelineDef[] {
    return this.storeFor(opts).update((current) => current.filter((p) => p.id !== id));
  }

  duplicate(
    id: string,
    opts: { projectId?: string; ownPipelines?: boolean } = {},
  ): PipelineDef | null {
    const source = this.get(id, opts);
    if (!source) return null;
    const existing = new Set(this.list(opts).map((p) => p.id));
    const copy: PipelineDef = {
      ...source,
      id: uniqueCopyId(id, existing),
      name: `${source.name} (copy)`,
      builtin: false,
    };
    this.storeFor(opts).update((current) => [...current, copy]);
    return copy;
  }

  resetToBuiltins(): PipelineDef[] {
    return this.appStore.write(BUILTIN_PIPELINES.map((p) => ({ ...p })));
  }
}

function upsertBy<T>(list: T[], match: (item: T) => boolean, value: T): T[] {
  const index = list.findIndex(match);
  if (index < 0) return [...list, value];
  const copy = [...list];
  copy[index] = value;
  return copy;
}

function uniqueCopyId(base: string, existing: Set<string>): string {
  let candidate = `${base}-copy`;
  let n = 2;
  while (existing.has(candidate)) candidate = `${base}-copy-${n++}`;
  return candidate;
}

/**
 * The validation rail. Errors block a save; warnings are shown and allowed,
 * because a project command that does not exist yet is a real intermediate
 * state while someone builds a pipeline.
 */
export function validate(
  pipeline: PipelineDef,
  agents: AgentDef[],
  commandNames: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parsed = pipelineSchema.safeParse(pipeline);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({ level: 'error', where: i.path.join('.') || pipeline.id, message: i.message });
    }
    return issues;
  }

  const agentNames = new Set(agents.map((a) => a.name));
  const seen = new Set<string>();
  pipeline.phases.forEach((phase, index) => {
    const where = `phases[${index}] ${phase.name}`;
    if (seen.has(phase.name)) {
      issues.push({ level: 'error', where, message: `duplicate phase name "${phase.name}"` });
    }
    seen.add(phase.name);

    // A description that only restates the name tells a reader nothing they
    // could not already see, so it is rejected the same way a blank one is.
    const flat = phase.description.trim().replace(/\.$/, '').toLowerCase();
    if (flat === phase.name.replace(/_/g, ' ').toLowerCase()) {
      issues.push({
        level: 'error',
        where,
        message: `description only restates the phase name — say what it does and why`,
      });
    }

    if (phase.kind === 'agent')
      validateAgentPhase(phase, index, where, agentNames, pipeline, issues);
    if (phase.kind === 'code')
      validateCodePhase(phase, index, where, commandNames, pipeline, issues);
    if (phase.kind === 'engineer' && !phase.question) {
      issues.push({
        level: 'warning',
        where,
        message: 'an engineer phase with no question shows an empty sheet',
      });
    }
  });

  const acceptance = pipeline.acceptance;
  if (acceptance.kind === 'phase_flag' || acceptance.kind === 'envelope_status') {
    const target = pipeline.phases.find((p) => p.name === acceptance.phase);
    if (!target) {
      issues.push({
        level: 'error',
        where: 'acceptance',
        message: `acceptance names phase "${acceptance.phase}", which does not exist`,
      });
    } else if (
      acceptance.kind === 'phase_flag' &&
      acceptance.flag === 'approved' &&
      target.envelope !== 'review'
    ) {
      issues.push({
        level: 'warning',
        where: 'acceptance',
        message: `"approved" comes from a review envelope; "${target.name}" declares ${target.envelope ?? 'none'}`,
      });
    }
  }
  return issues;
}

function validateAgentPhase(
  phase: PipelineDef['phases'][number],
  index: number,
  where: string,
  agentNames: Set<string>,
  pipeline: PipelineDef,
  issues: ValidationIssue[],
): void {
  if (!phase.agent) {
    issues.push({ level: 'error', where, message: 'an agent phase needs an agent' });
  } else if (!agentNames.has(phase.agent)) {
    issues.push({
      level: 'error',
      where,
      message: `no agent named "${phase.agent}" in the roster`,
    });
  }
  if (!phase.prompt) {
    issues.push({ level: 'error', where, message: 'an agent phase needs a prompt spec' });
  }
  for (const raw of phase.gates ?? []) {
    const gate = typeof raw === 'string' ? raw : raw.gate;
    if (!GATES[gate]) {
      issues.push({ level: 'error', where, message: `unknown gate "${gate}"` });
    }
    if (gate === 'command_passes') {
      const argv = typeof raw === 'string' ? undefined : (raw.config?.argv as string[] | undefined);
      if (!argv?.length) {
        issues.push({
          level: 'error',
          where,
          message: 'command_passes needs a configured command',
        });
      }
    }
  }
  for (const input of phase.prompt?.inputs ?? []) {
    if (!input.startsWith('envelope:')) continue;
    const target = input.slice('envelope:'.length).split('.')[0]!;
    const earlier = pipeline.phases.slice(0, index).some((p) => p.name === target);
    if (!earlier) {
      issues.push({
        level: 'error',
        where,
        message: `input "${input}" names a phase that does not run before this one`,
      });
    }
  }
}

function validateCodePhase(
  phase: PipelineDef['phases'][number],
  index: number,
  where: string,
  commandNames: string[],
  pipeline: PipelineDef,
  issues: ValidationIssue[],
): void {
  if (!phase.command) {
    issues.push({ level: 'error', where, message: 'a code phase needs a command' });
  } else if ('ref' in phase.command && !commandNames.includes(phase.command.ref)) {
    issues.push({
      level: 'warning',
      where,
      message: `project command "${phase.command.ref}" is not configured for this project yet`,
    });
  }
  if (!phase.feedbackTo) return;
  const targetIndex = pipeline.phases.findIndex((p) => p.name === phase.feedbackTo);
  if (targetIndex < 0) {
    issues.push({
      level: 'error',
      where,
      message: `feedback_to names "${phase.feedbackTo}", which is not a phase in this pipeline`,
    });
  } else if (targetIndex >= index) {
    issues.push({
      level: 'error',
      where,
      message: `feedback_to must point at an earlier phase; "${phase.feedbackTo}" runs later`,
    });
  } else if (pipeline.phases[targetIndex]!.kind !== 'agent') {
    issues.push({
      level: 'error',
      where,
      message: `feedback_to must point at an agent phase; "${phase.feedbackTo}" is a ${pipeline.phases[targetIndex]!.kind} phase`,
    });
  }
}

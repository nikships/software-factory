/**
 * Browser mock for window.foundry — lets `vite --config vite.web.config.ts`
 * run the renderer without Electron. No Node, no git, no disk — just enough
 * fixture data to explore the UI.
 *
 * Activated by `api.ts` when `window.foundry` is absent (i.e. in a browser).
 */
import type {
  AgentDef,
  AppSettings,
  DoctorCheck,
  EnvelopeDef,
  ModelInfo,
  PipelineDef,
  ProjectDef,
  RunRow,
  EventRow,
  PhaseRow,
  UpdateStatus,
  PendingInterrupt,
  ReadinessInspectResult,
  ReadinessState,
  BaseSyncStatus,
} from '@shared/types.js';
import type {
  EventPage,
  FoundryApi,
  RunDetail,
  SaveResult,
  SmithChatState,
} from '@shared/ipc-contract.js';
import { withoutHiddenModels } from '@shared/model-visibility.js';
import { BUILTIN_AGENTS } from '../main/store/builtin-agents.js';
import { BUILTIN_PIPELINES } from '../main/store/builtin-pipelines.js';

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const MOCK_PROJECTS: ProjectDef[] = [
  {
    id: 'demo-project',
    name: 'Demo project (web preview)',
    path: '/tmp/foundry-demo',
    baseRef: 'main',
    isolation: true,
    mergePolicy: 'ask',
    commands: [{ name: 'test', argv: ['npm', 'test'] }],
    protectedPaths: [],
    ownRoster: false,
    ownPipelines: false,
    addedAt: nowIso(-86_400_000),
  },
];

const MOCK_RUNS: RunRow[] = [
  {
    runId: 'run_demo_1',
    projectId: 'demo-project',
    pipelineId: 'build-pr',
    pipelineName: 'Plan → Build → Test → PR',
    request: 'Add a web preview mode so the UI can be explored without Electron (demo fixture).',
    status: 'accepted',
    engineer: 'web-preview',
    worktreePath: null,
    branch: 'foundry/run_demo_1',
    baseRef: 'main',
    branchPointSha: null,
    outcomeDetail: 'Accepted: all phases passed',
    prNumber: 12,
    prUrl: 'https://github.com/foundry-demo/demo/pull/12',
    issueNumber: null,
    issueUrl: null,
    merged: false,
    archived: false,
    mode: 'pi',
    startedAt: nowIso(-3_600_000),
    endedAt: nowIso(-300_000),
    totalTokens: 41280,
    phaseSummary: [
      { name: 'plan', status: 'success', kind: 'agent' },
      { name: 'commit_plan', status: 'success', kind: 'code' },
      { name: 'build', status: 'success', kind: 'agent' },
      { name: 'test', status: 'success', kind: 'code' },
      { name: 'commit_build', status: 'success', kind: 'code' },
    ],
  },
  {
    runId: 'run_demo_2',
    projectId: 'demo-project',
    pipelineId: 'fix-pr',
    pipelineName: 'Diagnose → Fix → PR',
    request: 'SettingsScreen shows the wrong brand after a theme switch',
    status: 'running',
    engineer: 'web-preview',
    worktreePath: null,
    branch: 'foundry/run_demo_2',
    baseRef: 'main',
    branchPointSha: null,
    outcomeDetail: null,
    prNumber: null,
    prUrl: null,
    issueNumber: null,
    issueUrl: null,
    merged: false,
    archived: false,
    mode: 'pi',
    startedAt: nowIso(-120_000),
    endedAt: null,
    totalTokens: 1800,
    phaseSummary: [{ name: 'diagnose', status: 'running', kind: 'agent' }],
  },
];

const MOCK_PHASES: Record<string, PhaseRow[]> = {
  run_demo_1: [
    {
      phaseId: 'ph_plan_1',
      runId: 'run_demo_1',
      seq: 0,
      name: 'plan',
      kind: 'agent',
      owner: 'planner',
      description: 'Turn the request into a plan',
      status: 'success',
      attempt: 1,
      error: null,
      startedAt: nowIso(-3_500_000),
      endedAt: nowIso(-3_000_000),
    },
    {
      phaseId: 'ph_build_1',
      runId: 'run_demo_1',
      seq: 2,
      name: 'build',
      kind: 'agent',
      owner: 'builder',
      description: 'Implement the plan',
      status: 'success',
      attempt: 1,
      error: null,
      startedAt: nowIso(-2_900_000),
      endedAt: nowIso(-800_000),
    },
  ],
  run_demo_2: [
    {
      phaseId: 'ph_diagnose_2',
      runId: 'run_demo_2',
      seq: 0,
      name: 'diagnose',
      kind: 'agent',
      owner: 'scout',
      description: 'Locate the fault with evidence before anything changes',
      status: 'running',
      attempt: 1,
      error: null,
      startedAt: nowIso(-110_000),
      endedAt: null,
    },
  ],
};

function defaultMockSettings(): AppSettings {
  return {
    helperModel: 'inherit',
    helperReasoningEffort: 'high',
    engineerName: 'web-preview',
    prAgent: 'pr_writer',
    defaultModel: 'inherit',
    defaultReasoningEffort: 'medium',
    smithModel: 'inherit',
    compactionThreshold: 0.8,
    notifications: { accepted: true, rejected: true, failed: true, needsInput: true },
    dockBadge: true,
    retentionDays: null,
    onboarded: true,
    hiddenModelIds: [],
  };
}

let mockSettings = defaultMockSettings();
let onboardingDone = true;
let mockAgents: AgentDef[] = BUILTIN_AGENTS.map((a) => ({ ...a }));
let mockPipelines: PipelineDef[] = BUILTIN_PIPELINES.map((p) => ({ ...p }));

export function createMockFoundryApi(): FoundryApi {
  const listeners = new Map<string, Set<(data?: unknown) => void>>();
  const smithStates = new Map<string, SmithChatState>();

  function on(channel: string, handler: (data?: unknown) => void): () => void {
    const set = listeners.get(channel) ?? new Set();
    set.add(handler);
    listeners.set(channel, set);
    return () => set.delete(handler);
  }

  const smithKey = (projectId?: string): string => projectId ?? 'global';
  const smithSnapshot = (projectId?: string): SmithChatState => {
    const key = smithKey(projectId);
    const state =
      smithStates.get(key) ??
      ({
        ...(projectId ? { projectId } : {}),
        model: mockSettings.smithModel,
        activeModel: mockSettings.smithModel,
        running: false,
        error: null,
        transcript: [],
      } satisfies SmithChatState);
    smithStates.set(key, state);
    return { ...state, transcript: state.transcript.map((entry) => ({ ...entry })) };
  };

  const emitSmith = (projectId?: string): void => {
    const state = smithSnapshot(projectId);
    listeners.get('smith-progress')?.forEach((handler) => handler(state));
  };

  const api: FoundryApi = {
    settings: {
      get: async () => ({ ...mockSettings, onboarded: onboardingDone }),
      patch: async (patch): Promise<SaveResult<AppSettings>> => {
        mockSettings = { ...mockSettings, ...patch };
        if (patch.onboarded !== undefined) onboardingDone = !!patch.onboarded;
        // Notify listeners (app.tsx refreshAll)
        listeners.get('settings-changed')?.forEach((h) => h(undefined));
        return { ok: true, issues: [], value: { ...mockSettings, onboarded: onboardingDone } };
      },
    },
    projects: {
      list: async () => [...MOCK_PROJECTS],
      add: async () => null,
      githubAccount: async () => ({
        available: false,
        detail: 'creating a repository needs the gh CLI, which the web preview cannot reach',
      }),
      chooseParentDir: async () => null,
      createGithub: async () => ({ ok: false, detail: 'Not available in web preview.' }),
      save: async (project): Promise<SaveResult<ProjectDef[]>> => {
        const idx = MOCK_PROJECTS.findIndex((p) => p.id === project.id);
        if (idx >= 0) MOCK_PROJECTS[idx] = project;
        return { ok: true, issues: [], value: [...MOCK_PROJECTS] };
      },
      remove: async () => [...MOCK_PROJECTS],
      export: async () => null,
      tryCommand: async () => ({
        exitCode: 0,
        passed: true,
        outputTail: '(web preview)',
        durationMs: 42,
      }),
      sniffCommands: async () => ({ commands: [], via: 'none', detail: '(web preview)' }),
      askAgentCommands: async () => ({ error: 'no agent CLI in the web preview' }),
      cancelDetection: async () => false,
      detection: async () => null,
      setupScriptGet: async () => '',
      setupScriptSave: async () => ({ ok: true, issues: [], value: [...MOCK_PROJECTS] }),
      setupScriptSniff: async () => ({ script: '', detail: '(web preview)', sources: [] }),
      setupScriptTry: async () => ({
        exitCode: 0,
        passed: true,
        outputTail: '(web preview)',
        durationMs: 0,
      }),
      setupScriptAskAgent: async () => ({ error: 'no agent CLI in the web preview' }),
      setupProgress: async () => null,
      setupCancel: async () => false,
      check: async (): Promise<DoctorCheck[]> => [
        {
          id: 'project:git',
          label: 'Git repo',
          ok: true,
          detail: MOCK_PROJECTS[0]?.path ?? '/tmp',
        },
      ],
      reveal: async () => {},
      scopeCopies: async () => ({ roster: false, pipelines: false }),
      baseSyncInspect: async (id): Promise<BaseSyncStatus | null> => ({
        projectId: id,
        baseRef: MOCK_PROJECTS[0]?.baseRef ?? 'main',
        remote: 'origin',
        localSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        remoteSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ahead: 0,
        behind: 0,
        state: 'current',
        fetched: true,
        detail: 'main matches origin/main',
      }),
      baseSync: async (id) => ({
        ok: true,
        status: {
          projectId: id,
          baseRef: MOCK_PROJECTS[0]?.baseRef ?? 'main',
          remote: 'origin',
          localSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          remoteSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          ahead: 0,
          behind: 0,
          state: 'current' as const,
          fetched: true,
          detail: 'main matches origin/main',
        },
      }),
    },
    readiness: {
      inspect: async (projectId): Promise<ReadinessInspectResult | null> => ({
        projectId,
        markerValid: true,
        marker: {
          schemaVersion: 1,
          generatedAt: nowIso(-86_400_000),
          commit: 'abc1234',
          agent: { harness: 'pi', model: 'inherit', reasoningEffort: 'high' },
          verdict: 'ready',
          summary: 'Demo project is already agent-ready.',
          stack: { languages: ['typescript'], monorepo: false, packages: [] },
          criteria: [],
        },
        markerDetail: 'valid agent-ready marker',
        skipped: false,
        validatedCache: true,
        ready: true,
      }),
      evaluate: async () => ({ error: 'no agent CLI in the web preview' }),
      makeReady: async () => ({ error: 'no agent CLI in the web preview' }),
      cancel: async () => false,
      get: async (): Promise<ReadinessState | null> => null,
      skip: async () => null,
      retry: async () => ({ error: 'no agent CLI in the web preview' }),
      confirmMerge: async () => null,
      dismiss: async () => false,
    },
    roster: {
      list: async () => [...mockAgents],
      staleBuiltins: async () => [],
      save: async (agent, _projectId): Promise<SaveResult<AgentDef[]>> => {
        const idx = mockAgents.findIndex((a) => a.name === agent.name);
        if (idx >= 0) mockAgents[idx] = agent;
        else mockAgents.push(agent);
        return { ok: true, issues: [], value: [...mockAgents] };
      },
      rename: async (from, to) => {
        mockAgents = mockAgents.map((a) => (a.name === from ? { ...a, name: to } : a));
        return { ok: true, issues: [], agents: [...mockAgents], forked: false };
      },
      remove: async (name) => {
        mockAgents = mockAgents.filter((a) => a.name !== name);
        return [...mockAgents];
      },
      duplicate: async (name) => {
        const found = mockAgents.find((a) => a.name === name) ?? null;
        if (!found) return null;
        const copy = { ...found, name: `${found.name}-copy` };
        mockAgents.push(copy);
        return copy;
      },
      validate: async () => [],
      preview: async (agent) =>
        JSON.stringify(
          {
            status: 'success',
            summary: 'one sentence on what you did',
            artifacts: ['relative/path/you/created.md'],
            notes_for_next_agent: 'what the next phase needs to know',
            ...Object.fromEntries(
              (agent.customFields ?? []).map((f) => [f.name, f.description || 'value']),
            ),
          },
          null,
          2,
        ),
      reset: async (name) => {
        const shipped = BUILTIN_AGENTS.find((agent) => agent.name === name);
        if (shipped) {
          mockAgents = mockAgents.map((agent) =>
            agent.name === name ? structuredClone(shipped) : agent,
          );
        }
        return [...mockAgents];
      },
      uploadMark: async (bytesB64, mime) => {
        if (!mime.startsWith('image/')) {
          return { ok: false, error: 'Use a PNG, JPEG, WebP, GIF, or SVG image.' };
        }
        return {
          ok: true,
          emblem: `image:preview-${bytesB64.length}.${mime.split('/')[1] ?? 'png'}`,
        };
      },
      removeMark: async () => true,
    },
    envelopes: {
      list: async (): Promise<EnvelopeDef[]> => [],
      save: async (def): Promise<SaveResult<EnvelopeDef[]>> => ({
        ok: true,
        issues: [],
        value: [def],
      }),
      remove: async () => [],
      duplicate: async (name) => ({
        name: `${name}-copy`,
        description: '',
        fields: [],
      }),
      usage: async () => ({ agents: [], phases: [] }),
      validate: async () => ({
        issues: [],
        example: JSON.stringify(
          {
            status: 'success',
            summary: 'one sentence on what you did',
            artifacts: ['relative/path/you/created.md'],
            notes_for_next_agent: 'what the next phase needs to know',
          },
          null,
          2,
        ),
      }),
      preview: async () =>
        JSON.stringify(
          {
            status: 'success',
            summary: 'one sentence on what you did',
            artifacts: ['relative/path/you/created.md'],
            notes_for_next_agent: 'what the next phase needs to know',
          },
          null,
          2,
        ),
    },
    pipelines: {
      list: async (): Promise<PipelineDef[]> => [...mockPipelines],
      staleBuiltins: async () => [],
      save: async (pipeline): Promise<SaveResult<PipelineDef[]>> => {
        const idx = mockPipelines.findIndex((p) => p.id === pipeline.id);
        if (idx >= 0) mockPipelines[idx] = pipeline;
        else mockPipelines.push(pipeline);
        return { ok: true, issues: [], value: [...mockPipelines] };
      },
      remove: async (id) => {
        mockPipelines = mockPipelines.filter((p) => p.id !== id);
        return [...mockPipelines];
      },
      duplicate: async (id) => {
        const p = mockPipelines.find((x) => x.id === id) ?? null;
        if (!p) return null;
        const copy: PipelineDef = {
          ...p,
          id: `${p.id}-copy`,
          name: `${p.name} (copy)`,
          builtin: false,
        };
        mockPipelines.push(copy);
        return copy;
      },
      validate: async () => [],
      dryRun: async () => [],
      reset: async (id) => {
        const shipped = BUILTIN_PIPELINES.find((pipeline) => pipeline.id === id);
        if (shipped) {
          mockPipelines = mockPipelines.map((pipeline) =>
            pipeline.id === id ? structuredClone(shipped) : pipeline,
          );
        }
        return [...mockPipelines];
      },
    },
    catalog: {
      gates: async () => [
        { id: 'artifacts_exist', description: 'Every declared artifact exists.' },
        { id: 'files_non_empty', description: 'Artifacts have content.' },
      ],
      templateVariables: async () => [
        { token: '{{request}}', description: 'The original request.' },
        { token: '{{run_id}}', description: 'Run id.' },
      ],
      agentModels: async (): Promise<ModelInfo[]> =>
        withoutHiddenModels(
          [
            {
              id: 'bridge-claude/claude-opus-5',
              displayName: 'Claude Opus 5',
              provider: 'claude',
              supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
              defaultReasoningEffort: 'medium',
              isCustom: true,
              deprecated: false,
              contextWindow: 1_000_000,
            },
          ],
          mockSettings.hiddenModelIds,
        ),
    },
    bridge: {
      // The web preview has no child process, so the Bridge reads as installed
      // and connected: the pane is explorable without pretending a login worked.
      state: async () => ({
        running: true,
        port: 37_717,
        pid: 4242,
        baseUrl: 'http://127.0.0.1:37717',
        providers: [
          {
            id: 'claude',
            label: 'Claude',
            icon: 'claude',
            authenticated: true,
            loginInFlight: false,
            accounts: [
              {
                id: 'claude-demo.json',
                provider: 'claude',
                label: 'demo@example.com',
                expired: false,
                disabled: false,
              },
            ],
          },
          {
            id: 'codex',
            label: 'ChatGPT (Codex)',
            icon: 'openai',
            authenticated: false,
            loginInFlight: false,
            accounts: [],
          },
        ],
      }),
      connect: async () => ({ ok: false, detail: 'Web preview cannot open a login.' }),
      disconnect: async () => ({ ok: false, detail: 'Web preview' }),
      cancelLogin: async () => false,
      setApiKey: async () => ({ ok: false, detail: 'Web preview' }),
      clearApiKey: async () => ({ ok: false, detail: 'Web preview' }),
      storedKeys: async () => [{ providerId: 'anthropic', type: 'api_key' }],
    },
    runs: {
      start: async () => ({
        ok: false as const,
        issues: [
          {
            level: 'error' as const,
            where: 'web-preview',
            message: 'Runs cannot be started in web preview. Use the Electron app (npm run dev).',
          },
        ],
      }),
      resume: async () => ({ ok: false, detail: 'Not available in web preview.' }),
      list: async () => [...MOCK_RUNS],
      detail: async (_projectId, runId): Promise<RunDetail> => {
        const run = MOCK_RUNS.find((r) => r.runId === runId) ?? null;
        return {
          run,
          phases: run ? (MOCK_PHASES[run.runId] ?? []) : [],
          envelopes: [],
          gates: [],
          sessions: [],
          live: run?.status === 'running',
        };
      },
      events: async (_projectId, _runId, _after): Promise<EventPage> => {
        const events: EventRow[] = [
          {
            rowid: 1,
            changeId: 1,
            eventId: 'evt_web_1',
            runId: _runId,
            phaseId: MOCK_PHASES[_runId]?.[0]?.phaseId ?? null,
            parentId: null,
            type: 'log',
            name: 'web preview',
            payload: {
              line: 'This is a fixture event. Live traces stream from the Electron backend.',
            },
            tokens: 0,
            startedAt: nowIso(-60_000),
            endedAt: nowIso(-60_000),
          },
        ];
        return { events: _after < 1 ? events : [], cursor: 1 };
      },
      liveTail: async () => '(web preview — no live process)',
      contextBreakdown: async () => ({ breakdown: null, reason: 'not_live' as const }),
      promptFor: async () => '(web preview)',
      kill: async () => false,
      archive: async () => {},
      mergeWorktree: async () => ({ ok: false, detail: 'Not available in web preview.' }),
      fixMerge: async () => ({ ok: false, detail: 'Not available in web preview.' }),
      discardWorktree: async () => ({ ok: false, detail: 'Not available in web preview.' }),
      openWorktree: async () => {},
      revealFiles: async () => {},
    },
    prs: {
      status: async () => ({
        available: true,
        detail: 'web preview — fixture data',
        repo: 'foundry-demo/demo',
      }),
      list: async () => ({
        ok: true,
        detail: '2 open',
        prs: [
          {
            number: 12,
            title: 'Add a web preview mode so the UI can be explored without Electron',
            url: 'https://github.com/foundry-demo/demo/pull/12',
            author: 'foundry-bot',
            headRefName: 'foundry/run_demo_1',
            baseRefName: 'main',
            createdAt: nowIso(-1_800_000),
            additions: 412,
            deletions: 37,
            isDraft: false,
            checks: 'passing' as const,
            mergeable: 'mergeable' as const,
            reviewDecision: 'APPROVED',
          },
          {
            number: 9,
            title: 'Sketch: retention sweeps for orphaned worktrees',
            url: 'https://github.com/foundry-demo/demo/pull/9',
            author: 'nikships',
            headRefName: 'retention-sweeps',
            baseRefName: 'main',
            createdAt: nowIso(-86_400_000 * 2),
            additions: 128,
            deletions: 12,
            isDraft: true,
            checks: 'pending' as const,
            mergeable: 'unknown' as const,
            reviewDecision: '',
          },
        ],
      }),
      create: async () => ({ ok: false, detail: 'Not available in web preview.' }),
      merge: async () => ({ ok: false, detail: 'Not available in web preview.' }),
      fixConflicts: async () => ({ ok: false, detail: 'Not available in web preview.' }),
    },
    interrupts: {
      list: async (): Promise<PendingInterrupt[]> => [],
      answer: async () => true,
    },
    smith: {
      send: async (projectId, text) => {
        if (projectId && !MOCK_PROJECTS.some((project) => project.id === projectId)) return null;
        const currentSmithState = smithSnapshot(projectId);
        let smithState: SmithChatState = {
          ...currentSmithState,
          running: true,
          error: null,
          transcript: [
            ...currentSmithState.transcript,
            {
              id: `operator-${Date.now()}`,
              kind: 'text',
              text,
              source: 'operator',
              at: Date.now(),
            },
          ],
        };
        smithStates.set(smithKey(projectId), smithState);
        emitSmith(projectId);
        // A canned turn that exercises the chat's visual language: a folded
        // tool row, a readiness sub-agent block, and a text answer.
        smithState = {
          ...smithState,
          running: false,
          transcript: [
            ...smithState.transcript,
            {
              id: `smith-tool-${Date.now()}`,
              kind: 'tool',
              text: 'read AGENTS.md',
              toolKind: 'read',
              done: true,
              source: 'smith',
              at: Date.now(),
            },
            {
              id: `readiness-${Date.now()}`,
              kind: 'note',
              text: 'Readiness agent: checklist evaluated, 9 of 11 criteria pass.',
              source: 'readiness',
              at: Date.now(),
            },
            {
              id: `smith-${Date.now()}`,
              kind: 'text',
              text: 'Web preview: Smith is ready to help with this project.',
              source: 'smith',
              at: Date.now(),
            },
          ],
        };
        smithStates.set(smithKey(projectId), smithState);
        emitSmith(projectId);
        return smithSnapshot(projectId);
      },
      cancel: async (projectId) => {
        const state = { ...smithSnapshot(projectId), running: false };
        smithStates.set(smithKey(projectId), state);
        emitSmith(projectId);
        return smithSnapshot(projectId);
      },
      newChat: async (projectId) => {
        if (projectId && !MOCK_PROJECTS.some((project) => project.id === projectId)) return null;
        const state = { ...smithSnapshot(projectId), running: false, error: null, transcript: [] };
        smithStates.set(smithKey(projectId), state);
        emitSmith(projectId);
        return smithSnapshot(projectId);
      },
      state: async (projectId) =>
        !projectId || MOCK_PROJECTS.some((project) => project.id === projectId)
          ? smithSnapshot(projectId)
          : null,
      setModel: async (projectId, model) => {
        if (projectId && !MOCK_PROJECTS.some((project) => project.id === projectId)) return null;
        const state = { ...smithSnapshot(projectId), model, activeModel: model };
        smithStates.set(smithKey(projectId), state);
        emitSmith(projectId);
        return smithSnapshot(projectId);
      },
      proposalsList: async () => [],
      answerProposal: async () => ({ ok: false, error: 'proposal not found' }),
    },
    companion: {
      // The web preview has no network host to bind; the pane renders "off".
      state: async () => ({
        running: false,
        origin: null,
        protocolVersion: 1,
        devices: [],
        detail: 'Not available in web preview.',
      }),
      start: async () => ({
        running: false,
        origin: null,
        protocolVersion: 1,
        devices: [],
        detail: 'Not available in web preview.',
      }),
      stop: async () => ({ running: false, origin: null, protocolVersion: 1, devices: [] }),
      pairingPayload: async () => null,
      unpair: async () => false,
    },
    doctor: {
      run: async (): Promise<DoctorCheck[]> => [
        {
          id: 'bridge',
          label: 'Provider bridge',
          ok: true,
          detail: 'serving on http://127.0.0.1:37717',
        },
        {
          id: 'agent-models',
          label: 'Usable models',
          ok: true,
          detail: '1 model available, including Claude Opus 5',
          blocking: true,
        },
        {
          id: 'provider:claude',
          label: 'Claude account',
          ok: true,
          detail: 'signed in',
        },
        {
          id: 'toolchain-path',
          label: 'Toolchain PATH',
          ok: true,
          detail:
            'resolved from your login shell; found node, npm, pnpm, bun, cargo, go, uv, swift',
        },
        {
          id: 'git',
          label: 'git',
          ok: true,
          detail: 'git version 2.55.0',
          blocking: true,
        },
        {
          id: 'gh',
          label: 'GitHub CLI',
          ok: true,
          detail: 'gh version 2.97.0 (2025-07-31)',
        },
        {
          id: 'gh:auth',
          label: 'GitHub CLI authentication',
          ok: true,
          detail: 'signed in',
        },
        {
          id: 'macos',
          label: 'macOS 26 or newer',
          ok: true,
          detail: 'darwin 27.0.0',
        },
      ],
    },
    maintenance: {
      orphanWorktrees: async () => [],
      removeWorktree: async () => ({ ok: false, detail: 'Web preview' }),
      applyRetention: async () => ({ runsDeleted: 0, bytesReclaimed: 0, worktreesRemoved: 0 }),
      compact: async () => {},
    },
    app: {
      openExternal: async () => {},
      assetUrl: async (relPath) => {
        const p = relPath.replace(/^\/+/, '');
        // In web, Vite serves from /assets if present; fall back to string so img can 404 visibly.
        return `/assets/${p}`;
      },
      version: async () => '0.1.1-web',
      quit: async () => {},
      relaunch: async () => {},
    },
    updater: {
      check: async (): Promise<UpdateStatus> => ({ stage: 'idle' }),
      download: async (): Promise<UpdateStatus> => ({ stage: 'idle' }),
      quitAndInstall: async () => {},
      getStatus: async (): Promise<UpdateStatus> => ({ stage: 'idle' }),
    },
    on: on as FoundryApi['on'],
  };

  return api;
}

export function installMockFoundryIfNeeded(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.foundry || w.__foundryWebMockInstalled) return;
  w.__foundryWebMockInstalled = true;
  // Import-time side effects in mockFoundry must not synchronously import api.ts
  // again. This function is called from api.ts; keep the install synchronous.
  const mock = createMockFoundryApi();
  w.foundry = mock as unknown as never;
  if (!w.foundryMenu) {
    w.foundryMenu = {
      on() {
        return () => {};
      },
    } as never;
  }
  if (!document.title.includes('web')) document.title = `${document.title} — web preview`;
  // eslint-disable-next-line no-console
  console.info('[web] renderer running with mocked foundry API');
}

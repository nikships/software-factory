/**
 * The IPC channel names and their payload types, imported by both sides so a
 * renaming cannot silently break a call. The renderer never touches disk, git,
 * or the agent runtime: everything it can do is in this list.
 */

import type {
  AgentDef,
  AgentSessionRow,
  AppSettings,
  BaseSyncResult,
  BaseSyncStatus,
  ContextBreakdown,
  DoctorCheck,
  DryRunPrompt,
  EnvelopeDef,
  EnvelopeRow,
  EventRow,
  GateResultRow,
  GhStatus,
  GithubAccount,
  InterruptAnswer,
  MaintenanceReport,
  ModelInfo,
  OrphanWorktree,
  PendingInterrupt,
  PhaseRow,
  PipelineDef,
  PrMergeMethod,
  ProjectDef,
  PullRequest,
  ReadinessInspectResult,
  ReadinessState,
  ReasoningEffort,
  RunRow,
  SmithProposal,
  SmithProposalAnswer,
  SmithProposalAnswerResult,
  StartRunInput,
  PanelEntry,
  PanelStateCore,
  UpdateStatus,
  ValidationIssue,
} from './types.js';
import type { CompanionHostState, CompanionPairingPayload } from './companion.js';

export interface SaveResult<T> {
  ok: boolean;
  issues: ValidationIssue[];
  value?: T;
}

/**
 * Renaming a shipped agent forks rather than renames: the roster restores any
 * absent built-in on read, so an in-place rename would resurrect the old name
 * on the next launch. `forked` tells the caller which of the two happened.
 */
export interface RenameResult {
  ok: boolean;
  issues: ValidationIssue[];
  agents?: AgentDef[];
  forked?: boolean;
}

/**
 * Result of persisting a user-uploaded agent mark. On success, `emblem` is the
 * `image:<file>` pointer to store on `AgentDef.emblem`.
 */
export interface AgentMarkUploadResult {
  ok: boolean;
  emblem?: string;
  error?: string;
}

export interface RunDetail {
  run: RunRow | null;
  phases: PhaseRow[];
  envelopes: EnvelopeRow[];
  gates: GateResultRow[];
  sessions: AgentSessionRow[];
  live: boolean;
}

export interface EventPage {
  events: EventRow[];
  /** Walks EventRow.changeId, so updated rows are re-served, not just new ones. */
  cursor: number;
}

/**
 * Why an agent has no context breakdown to show. A breakdown comes off the
 * agent's own session, so absence is normal in specific ways — the reason
 * travels rather than the copy, so the renderer says it in its own words
 * instead of expanding onto an empty panel.
 */
export type ContextBreakdownReason =
  'not_live' | 'not_started' | 'no_session_context' | 'unanswered';

export interface ContextBreakdownResult {
  breakdown: ContextBreakdown | null;
  /** Absent exactly when `breakdown` is present. */
  reason?: ContextBreakdownReason;
  /** Read from the live session rather than the snapshot a turn left behind. */
  live?: boolean;
  /** When that snapshot was taken. Absent for a live read. */
  capturedAt?: string;
}

export interface TryCommandResult {
  exitCode: number | null;
  passed: boolean;
  outputTail: string;
  durationMs: number;
}

/**
 * A detected command is a proposal, never a write. `verified` carries the
 * result of actually running it, so the human confirms evidence rather than a
 * guess.
 */
export interface DetectedCommand {
  name: string;
  argv: string[];
  source: string;
  verified: boolean;
  exitCode: number | null;
  outputTail: string;
  durationMs: number;
}

export interface DetectCommandsResult {
  commands: DetectedCommand[];
  /** Which path answered, so the UI can say why nothing came back. */
  via: 'manifest' | 'agent' | 'none';
  detail: string;
}

/** One line of an agent detection's live transcript. */
export type DetectionEntry = PanelEntry;

/**
 * A command the agent proposed. Verification is streamed, so `verify` moves
 * `pending → running → pass|fail` while the panel is open.
 */
export interface DetectionProposal {
  name: string;
  argv: string[];
  source: string;
  verify: 'pending' | 'running' | 'pass' | 'fail';
  exitCode?: number | null;
  outputTail?: string;
  durationMs?: number;
  /** The binary was not found, which is a PATH problem, not a failing command. */
  notFound?: boolean;
}

export interface DetectionState extends PanelStateCore {
  detectionId: string;
  projectId: string;
  status: 'running' | 'verifying' | 'done' | 'cancelled' | 'failed';
  proposals: DetectionProposal[];
  /** Proposals that were not usable, each with the reason it was dropped. */
  rejected: { raw: unknown; reason: string }[];
  /** The agent's reply verbatim, so an unparseable answer stays diagnosable. */
  rawReply: string;
}

/** One line of the setup-script generation transcript. Reuses the same union. */
export type SetupEntry = PanelEntry;

export interface SetupState extends PanelStateCore {
  setupId: string;
  projectId: string;
  status: 'running' | 'done' | 'cancelled' | 'failed';
  script: string;
  rawReply: string;
}

/**
 * What the operator is looking at when a Smith message arrives. This stays a
 * compact descriptor rather than carrying screen data across the privileged
 * seam; main resolves anything Smith needs through its normal tools.
 */
export interface SmithScreenContext {
  route: string;
  entity?: {
    kind: 'run' | 'pipeline' | 'agent' | 'envelope' | 'project' | 'settings';
    id: string;
  };
}

/** One cloned transcript row shared by Smith's full and compact chat views. */
export interface SmithTranscriptEntry extends PanelEntry {
  source: 'operator' | 'smith' | 'readiness';
}

/**
 * The complete renderer-facing state for one project's chat. Every read and
 * push receives a fresh transcript array, never the session's live one.
 */
export interface SmithChatState {
  /** Absent for the global “All projects” conversation. */
  projectId?: string;
  model: string;
  activeModel: string;
  running: boolean;
  error: string | null;
  transcript: SmithTranscriptEntry[];
}

export interface SetupSniffResult {
  script: string;
  detail: string;
  sources: string[];
}

export interface WorktreeAction {
  ok: boolean;
  detail: string;
}

/**
 * Everything creating a repository needs and nothing else. Owner is optional
 * because the signed-in login is the answer for most people, and a question
 * whose answer is already known is not worth a step.
 */
export interface NewRepoInput {
  /** Repo name only; the owner travels separately so it can be defaulted. */
  name: string;
  owner?: string;
  visibility: 'private' | 'public';
  description?: string;
  /** Where the clone lands: the new repo becomes `${parentDir}/${name}`. */
  parentDir: string;
}

export interface NewRepoResult {
  ok: boolean;
  /** gh's own words when it refused, so the reason is diagnosable. */
  detail: string;
  /** Present only on success: the project is already registered. */
  project?: ProjectDef;
  url?: string;
  nameWithOwner?: string;
  path?: string;
}

/** The outcome of a gh action, with the PR's coordinates when one exists. */
export interface PrAction {
  ok: boolean;
  detail: string;
  number?: number;
  url?: string;
}

/** The outcome of `gh issue create`, with the issue's coordinates on success. */
export interface IssueAction {
  ok: boolean;
  detail: string;
  number?: number;
  url?: string;
}

export interface PrList {
  ok: boolean;
  detail: string;
  prs: PullRequest[];
}

/**
 * One account the Bridge holds for a provider. Deliberately metadata only: the
 * auth files behind it carry refresh and access tokens, and nothing that could
 * reconstruct one crosses this seam.
 */
export interface BridgeAccountInfo {
  id: string;
  provider: string;
  /** The provider's own name for the account: an email, a login, or the id. */
  label: string;
  expiresAt?: string;
  expired: boolean;
  disabled: boolean;
}

export interface BridgeProviderInfo {
  id: string;
  label: string;
  /** Icon key, matching the picker's provider marks. */
  icon: string;
  authenticated: boolean;
  accounts: BridgeAccountInfo[];
  loginInFlight: boolean;
}

/** Why the Bridge is not serving, when it is not. */
export type BridgeUnavailable =
  'binary_missing' | 'spawn_failed' | 'port_exhausted' | 'health_timeout';

/**
 * The reason in the operator's terms, for `${copy}: ${state.detail}`.
 *
 * Shared rather than owned by either side because the doctor, the Providers
 * pane, and the onboarding step all report the same failure. A `detail` that
 * had to read well on its own would restate the reason, which is the doubled
 * sentence this split exists to avoid.
 */
export const BRIDGE_UNAVAILABLE_COPY: Record<BridgeUnavailable, string> = {
  binary_missing: 'the vendored Bridge binary is not installed',
  spawn_failed: 'the Bridge binary would not launch',
  port_exhausted: 'no port in the Bridge\u2019s range was free',
  health_timeout: 'the Bridge started but never answered on its port',
};

export interface BridgeState {
  running: boolean;
  port: number | null;
  pid: number | null;
  /** Present only when the last start attempt failed. */
  reason?: BridgeUnavailable;
  detail?: string;
  baseUrl: string | null;
  providers: BridgeProviderInfo[];
}

export interface BridgeActionResult {
  ok: boolean;
  detail: string;
}

/**
 * One direct API key pi holds, as metadata. Deliberately no value and no
 * masked prefix: the renderer needs to know a key exists so it can offer to
 * replace or clear it, and anything more would put a secret on this seam.
 */
export interface StoredProviderKey {
  providerId: string;
  /** pi's own credential kind, e.g. `api_key` or `oauth`. */
  type: string;
}

export interface FoundryApi {
  settings: {
    get(): Promise<AppSettings>;
    patch(patch: Partial<AppSettings>): Promise<SaveResult<AppSettings>>;
  };
  projects: {
    list(): Promise<ProjectDef[]>;
    add(): Promise<ProjectDef | null>;
    /** Who gh is signed in as, so the create flow can name the owner up front. */
    githubAccount(): Promise<GithubAccount>;
    /** Folder picker for where a new repo should be cloned. Null when cancelled. */
    chooseParentDir(): Promise<string | null>;
    /**
     * Creates the repo on GitHub through the operator's own gh, clones it, and
     * registers the clone as a project. Foundry holds no GitHub token.
     */
    createGithub(input: NewRepoInput): Promise<NewRepoResult>;
    save(project: ProjectDef): Promise<SaveResult<ProjectDef[]>>;
    remove(id: string): Promise<ProjectDef[]>;
    export(id: string): Promise<string | null>;
    tryCommand(id: string, argv: string[]): Promise<TryCommandResult>;
    /** Manifest sniffing only: free, no model, no process. */
    sniffCommands(id: string): Promise<DetectCommandsResult>;
    /**
     * Always spawns an agent. Returns as soon as the session exists; progress
     * arrives on `detection-progress` and the final state is in `detection`.
     */
    askAgentCommands(id: string): Promise<{ detectionId: string } | { error: string }>;
    cancelDetection(detectionId: string): Promise<boolean>;
    /** The current state of a detection, for a panel reopened mid-run. */
    detection(detectionId: string): Promise<DetectionState | null>;
    /** Shell script for the worktree bootstrap, lives in app data per project. */
    setupScriptGet(id: string): Promise<string>;
    setupScriptSave(id: string, script: string): Promise<SaveResult<ProjectDef[]>>;
    setupScriptSniff(id: string): Promise<SetupSniffResult>;
    setupScriptTry(id: string, script: string): Promise<TryCommandResult>;
    setupScriptAskAgent(id: string): Promise<{ setupId: string } | { error: string }>;
    setupProgress(setupId: string): Promise<SetupState | null>;
    setupCancel(setupId: string): Promise<boolean>;
    check(id: string): Promise<DoctorCheck[]>;
    reveal(path: string): Promise<void>;
    /**
     * Whether this project already has its own roster/pipelines file on disk.
     * Turning a scope flag off leaves the copy in place, so re-enabling
     * restores that older copy rather than re-seeding from the current global
     * set — the scope control has to say which is about to happen.
     */
    scopeCopies(id: string): Promise<{ roster: boolean; pipelines: boolean }>;
    /**
     * Fetches the remote-tracking base ref and compares it to local.
     * Never moves a local branch. Null when the project is gone.
     */
    baseSyncInspect(id: string): Promise<BaseSyncStatus | null>;
    /**
     * Fast-forwards the local base ref to the remote. Refuses to merge or
     * reset a diverged branch. Null when the project is gone.
     */
    baseSync(id: string): Promise<BaseSyncResult | null>;
  };
  readiness: {
    /** Marker-file status. Cache never wins over the file. */
    inspect(projectId: string): Promise<ReadinessInspectResult | null>;
    /**
     * Starts the dedicated evaluation. Returns as soon as the session exists;
     * Smith's readiness tools stream the progress into the chat.
     */
    evaluate(
      projectId: string,
      opts?: { model?: string; reasoningEffort?: ReasoningEffort; saveAsDefault?: boolean },
    ): Promise<{ sessionId: string } | { error: string }>;
    makeReady(projectId: string): Promise<{ sessionId: string } | { error: string }>;
    cancel(projectId: string): Promise<boolean>;
    get(projectId: string): Promise<ReadinessState | null>;
    skip(projectId: string): Promise<ReadinessState | null>;
    retry(projectId: string): Promise<{ sessionId: string } | { error: string }>;
    confirmMerge(projectId: string): Promise<ReadinessState | null>;
    dismiss(projectId: string): Promise<boolean>;
  };
  roster: {
    list(projectId?: string): Promise<AgentDef[]>;
    staleBuiltins(projectId?: string): Promise<string[]>;
    save(agent: AgentDef, projectId?: string): Promise<SaveResult<AgentDef[]>>;
    /**
     * A name change is its own operation, not a save under a new key: `save`
     * upserts by name, so renaming through it appends rather than renames.
     */
    rename(from: string, to: string, projectId?: string): Promise<RenameResult>;
    remove(name: string, projectId?: string): Promise<AgentDef[]>;
    duplicate(name: string, projectId?: string): Promise<AgentDef | null>;
    validate(agent: AgentDef): Promise<ValidationIssue[]>;
    /**
     * The JSON envelope this agent must return: its selected envelope extended
     * with its own `customFields`, from the same schema path a run parses
     * against. The agent's extra fields only exist on the effective shape, so
     * the renderer cannot derive this from the def alone.
     */
    preview(agent: AgentDef): Promise<string>;
    reset(name: string, projectId?: string): Promise<AgentDef[]>;
    /**
     * Persist a user-uploaded mark. Returns `image:<file>` to store on
     * `AgentDef.emblem`. The bytes live under the support dir, not the roster.
     */
    uploadMark(bytesB64: string, mime: string): Promise<AgentMarkUploadResult>;
    /** Best-effort delete of a previously uploaded mark. */
    removeMark(emblem: string): Promise<boolean>;
  };
  envelopes: {
    list(): Promise<EnvelopeDef[]>;
    save(def: EnvelopeDef): Promise<SaveResult<EnvelopeDef[]>>;
    remove(name: string): Promise<EnvelopeDef[]>;
    duplicate(name: string): Promise<EnvelopeDef | null>;
    /** Who still names this envelope, so a delete confirm can warn precisely. */
    usage(name: string): Promise<{
      agents: string[];
      phases: { pipeline: string; phase: string }[];
    }>;
    /** Issues plus the live JSON example the agent will be shown. */
    validate(def: EnvelopeDef): Promise<{ issues: ValidationIssue[]; example: string }>;
    /**
     * JSON example for a built-in kind or custom name — same path the agent sees.
     * Used by the Settings inspect pane for built-ins.
     */
    preview(name: string): Promise<string>;
  };
  pipelines: {
    list(projectId?: string): Promise<PipelineDef[]>;
    staleBuiltins(projectId?: string): Promise<string[]>;
    save(pipeline: PipelineDef, projectId?: string): Promise<SaveResult<PipelineDef[]>>;
    remove(id: string, projectId?: string): Promise<PipelineDef[]>;
    duplicate(id: string, projectId?: string): Promise<PipelineDef | null>;
    validate(pipeline: PipelineDef, projectId?: string): Promise<ValidationIssue[]>;
    /** Renders the exact prompts a run would send, spending nothing. */
    dryRun(pipelineId: string, projectId: string, request: string): Promise<DryRunPrompt[]>;
    reset(id: string, projectId?: string): Promise<PipelineDef[]>;
  };
  catalog: {
    gates(): Promise<{ id: string; description: string }[]>;
    templateVariables(): Promise<{ token: string; description: string }[]>;
    /**
     * Models the agent transport can actually reach: pi's built-ins with a
     * credential plus everything the Bridge has generated. Every model picker
     * in the app reads this one list.
     */
    agentModels(): Promise<ModelInfo[]>;
  };
  bridge: {
    /** Bridge status plus every provider and its accounts. Starts nothing. */
    state(): Promise<BridgeState>;
    /**
     * Begins a provider's OAuth flow in the operator's browser. Returns as soon
     * as the browser is open; the account lands asynchronously and the state
     * call reports it.
     */
    connect(provider: string): Promise<BridgeActionResult>;
    /** Removes a provider's accounts and drops its models from the catalog. */
    disconnect(provider: string): Promise<BridgeActionResult>;
    /** SIGTERMs an in-flight login the operator abandoned. */
    cancelLogin(provider: string): Promise<boolean>;
    /**
     * Stores a direct provider API key in pi's credential store — the path for
     * an operator who has a key rather than a subscription. The key is written
     * by pi and never held, logged, or echoed back.
     */
    setApiKey(providerId: string, apiKey: string): Promise<BridgeActionResult>;
    /** Removes a stored direct key. */
    clearApiKey(providerId: string): Promise<BridgeActionResult>;
    /**
     * Which providers pi holds a credential for, as metadata. The values never
     * leave the main process, so a key row can say "set" without the renderer
     * ever having held one.
     */
    storedKeys(): Promise<StoredProviderKey[]>;
  };
  runs: {
    start(
      input: StartRunInput,
    ): Promise<{ ok: boolean; runId?: string; issues: ValidationIssue[] }>;
    /** Reattempts the first failed phase in this run's existing worktree. */
    resume(projectId: string, runId: string): Promise<WorktreeAction>;
    list(projectId: string, includeArchived: boolean): Promise<RunRow[]>;
    detail(projectId: string, runId: string): Promise<RunDetail>;
    events(projectId: string, runId: string, afterChangeId: number): Promise<EventPage>;
    liveTail(phaseId: string): Promise<string>;
    /**
     * What is filling an agent's context: read off the live session, or the
     * snapshot its last turn left behind once the run has finished. Always
     * answers — an absent breakdown carries the reason instead of throwing.
     */
    contextBreakdown(
      projectId: string,
      runId: string,
      agent: string,
    ): Promise<ContextBreakdownResult>;
    /** The prompt as sent, read from the run's files rather than the event stream. */
    promptFor(projectId: string, phaseId: string): Promise<string>;
    kill(projectId: string, runId: string): Promise<boolean>;
    archive(projectId: string, runId: string, archived: boolean): Promise<void>;
    mergeWorktree(projectId: string, runId: string): Promise<WorktreeAction>;
    /**
     * When the base moved or the merge conflicts, an agent rebases the run
     * branch inside its worktree; code verifies the result and merges. One
     * click from a refused merge to a landed one.
     */
    fixMerge(projectId: string, runId: string): Promise<WorktreeAction>;
    discardWorktree(projectId: string, runId: string): Promise<WorktreeAction>;
    openWorktree(projectId: string, runId: string): Promise<void>;
    /** Opens the run's folder of raw records (prompts, stream.jsonl, logs). */
    revealFiles(projectId: string, runId: string): Promise<void>;
  };
  prs: {
    /** Cheap enough to gate the UI on: gh presence, auth, and remote resolve. */
    status(projectId: string): Promise<GhStatus>;
    list(projectId: string): Promise<PrList>;
    /** Pushes the run's branch and opens a PR against the run's base ref. */
    create(projectId: string, runId: string, title: string, body: string): Promise<PrAction>;
    /**
     * Merges on GitHub, then settles locally: a foundry run branch has its
     * worktree removed and its run marked merged, and the base ref is
     * fast-forwarded to match the remote.
     */
    merge(projectId: string, prNumber: number, method: PrMergeMethod): Promise<PrAction>;
    /**
     * A conflicting PR whose head is a foundry run branch still has its
     * worktree: an agent rebases it onto the freshly fetched base there, and
     * code force-with-lease pushes the result so the PR becomes mergeable.
     */
    fixConflicts(projectId: string, prNumber: number): Promise<PrAction>;
  };
  interrupts: {
    list(): Promise<PendingInterrupt[]>;
    answer(answer: InterruptAnswer): Promise<boolean>;
  };
  smith: {
    /** Starts one turn and returns immediately; progress arrives on `smith-progress`. */
    send(
      projectId: string | undefined,
      text: string,
      screen: SmithScreenContext,
    ): Promise<SmithChatState | null>;
    cancel(projectId: string | undefined): Promise<SmithChatState | null>;
    newChat(projectId: string | undefined): Promise<SmithChatState | null>;
    state(projectId: string | undefined): Promise<SmithChatState | null>;
    setModel(projectId: string | undefined, model: string): Promise<SmithChatState | null>;
    /** The one pending proposal, or an empty list. Only ever one at a time. */
    proposalsList(): Promise<SmithProposal[]>;
    /** Approve or reject the pending proposal, unblocking Smith's tool call. */
    answerProposal(id: string, answer: SmithProposalAnswer): Promise<SmithProposalAnswerResult>;
  };
  companion: {
    /** Host status plus the paired devices. Starts nothing. */
    state(): Promise<CompanionHostState>;
    /** Binds the LAN host. Idempotent; the state says whether it worked. */
    start(): Promise<CompanionHostState>;
    /** Unbinds the host and voids outstanding pairing secrets. Tokens survive. */
    stop(): Promise<CompanionHostState>;
    /**
     * The in-flight pairing secret wrapped in the QR payload. Re-reading
     * returns the same secret; pass `{ refresh: true }` to mint a replacement.
     * Null while the host is stopped. The secret never appears in `state()`.
     */
    pairingPayload(opts?: { refresh?: boolean }): Promise<CompanionPairingPayload | null>;
    /** Revokes one device's token by deleting the device. */
    unpair(deviceId: string): Promise<boolean>;
  };
  doctor: {
    run(): Promise<DoctorCheck[]>;
  };
  maintenance: {
    orphanWorktrees(): Promise<OrphanWorktree[]>;
    removeWorktree(projectId: string, path: string): Promise<WorktreeAction>;
    applyRetention(): Promise<MaintenanceReport>;
    compact(): Promise<void>;
  };
  app: {
    openExternal(url: string): Promise<void>;
    assetUrl(relPath: string): Promise<string>;
    version(): Promise<string>;
    quit(): Promise<void>;
    relaunch(): Promise<void>;
  };
  updater: {
    check(): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus>;
    quitAndInstall(): Promise<void>;
    getStatus(): Promise<UpdateStatus>;
  };
  /**
   * Push channels are deliberately few: everything else is polled.
   *
   * `detection-progress` is pushed rather than polled because a detection is
   * not a run: it has no trace rows and therefore no `change_id` cursor to walk.
   * `setup-progress` is the same shape for the worktree bootstrap generator.
   */
  on(
    channel:
      | 'runs-changed'
      | 'interrupts-changed'
      | 'settings-changed'
      | 'updater-status'
      | 'detection-progress'
      | 'setup-progress'
      | 'smith-proposals-changed'
      | 'smith-progress'
      // A login completes in a browser, minutes after the call that started it
      // returned. Nothing polls the auth directory, so this is how a Settings
      // pane learns the account landed.
      | 'bridge-changed'
      // A phone pairs minutes after the QR appeared, over HTTP rather than any
      // renderer action. Nothing polls the device list, so this is how the
      // Settings pane learns a device arrived or the host state moved.
      | 'companion-changed',
    handler: (data?: unknown) => void,
  ): () => void;
}

export const IPC = {
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsGithubAccount: 'projects:githubAccount',
  projectsChooseParentDir: 'projects:chooseParentDir',
  projectsCreateGithub: 'projects:createGithub',
  projectsSave: 'projects:save',
  projectsRemove: 'projects:remove',
  projectsExport: 'projects:export',
  projectsTryCommand: 'projects:tryCommand',
  projectsSniffCommands: 'projects:sniffCommands',
  projectsAskAgentCommands: 'projects:askAgentCommands',
  projectsCancelDetection: 'projects:cancelDetection',
  projectsDetection: 'projects:detection',
  projectsSetupScriptGet: 'projects:setupScriptGet',
  projectsSetupScriptSave: 'projects:setupScriptSave',
  projectsSetupScriptSniff: 'projects:setupScriptSniff',
  projectsSetupScriptTry: 'projects:setupScriptTry',
  projectsSetupScriptAskAgent: 'projects:setupScriptAskAgent',
  projectsSetupProgress: 'projects:setupProgress',
  projectsSetupCancel: 'projects:setupCancel',
  projectsCheck: 'projects:check',
  projectsReveal: 'projects:reveal',
  projectsScopeCopies: 'projects:scopeCopies',
  projectsBaseSyncInspect: 'projects:baseSyncInspect',
  projectsBaseSync: 'projects:baseSync',
  readinessInspect: 'readiness:inspect',
  readinessEvaluate: 'readiness:evaluate',
  readinessMakeReady: 'readiness:makeReady',
  readinessCancel: 'readiness:cancel',
  readinessGet: 'readiness:get',
  readinessSkip: 'readiness:skip',
  readinessRetry: 'readiness:retry',
  readinessConfirmMerge: 'readiness:confirmMerge',
  readinessDismiss: 'readiness:dismiss',
  rosterList: 'roster:list',
  rosterStaleBuiltins: 'roster:staleBuiltins',
  rosterSave: 'roster:save',
  rosterRename: 'roster:rename',
  rosterRemove: 'roster:remove',
  rosterDuplicate: 'roster:duplicate',
  rosterValidate: 'roster:validate',
  rosterPreview: 'roster:preview',
  rosterReset: 'roster:reset',
  rosterUploadMark: 'roster:uploadMark',
  rosterRemoveMark: 'roster:removeMark',
  envelopesList: 'envelopes:list',
  envelopesSave: 'envelopes:save',
  envelopesRemove: 'envelopes:remove',
  envelopesDuplicate: 'envelopes:duplicate',
  envelopesUsage: 'envelopes:usage',
  envelopesValidate: 'envelopes:validate',
  envelopesPreview: 'envelopes:preview',
  pipelinesList: 'pipelines:list',
  pipelinesStaleBuiltins: 'pipelines:staleBuiltins',
  pipelinesSave: 'pipelines:save',
  pipelinesRemove: 'pipelines:remove',
  pipelinesDuplicate: 'pipelines:duplicate',
  pipelinesValidate: 'pipelines:validate',
  pipelinesDryRun: 'pipelines:dryRun',
  pipelinesReset: 'pipelines:reset',
  catalogGates: 'catalog:gates',
  catalogTemplateVariables: 'catalog:templateVariables',
  catalogAgentModels: 'catalog:agentModels',
  bridgeState: 'bridge:state',
  bridgeConnect: 'bridge:connect',
  bridgeDisconnect: 'bridge:disconnect',
  bridgeCancelLogin: 'bridge:cancelLogin',
  bridgeSetApiKey: 'bridge:setApiKey',
  bridgeClearApiKey: 'bridge:clearApiKey',
  bridgeStoredKeys: 'bridge:storedKeys',
  runsStart: 'runs:start',
  runsResume: 'runs:resume',
  runsList: 'runs:list',
  runsDetail: 'runs:detail',
  runsEvents: 'runs:events',
  runsLiveTail: 'runs:liveTail',
  runsContextBreakdown: 'runs:contextBreakdown',
  runsPrompt: 'runs:prompt',
  runsKill: 'runs:kill',
  runsArchive: 'runs:archive',
  runsMergeWorktree: 'runs:mergeWorktree',
  runsFixMerge: 'runs:fixMerge',
  runsDiscardWorktree: 'runs:discardWorktree',
  runsOpenWorktree: 'runs:openWorktree',
  runsRevealFiles: 'runs:revealFiles',
  prsStatus: 'prs:status',
  prsList: 'prs:list',
  prsCreate: 'prs:create',
  prsMerge: 'prs:merge',
  prsFixConflicts: 'prs:fixConflicts',
  interruptsList: 'interrupts:list',
  interruptsAnswer: 'interrupts:answer',
  smithSend: 'smith:send',
  smithCancel: 'smith:cancel',
  smithNewChat: 'smith:newChat',
  smithState: 'smith:state',
  smithSetModel: 'smith:setModel',
  smithProposalsList: 'smith:proposalsList',
  smithAnswerProposal: 'smith:answerProposal',
  companionState: 'companion:state',
  companionStart: 'companion:start',
  companionStop: 'companion:stop',
  companionPairingPayload: 'companion:pairingPayload',
  companionUnpair: 'companion:unpair',
  doctorRun: 'doctor:run',
  maintenanceOrphans: 'maintenance:orphans',
  maintenanceRemoveWorktree: 'maintenance:removeWorktree',
  maintenanceRetention: 'maintenance:retention',
  maintenanceCompact: 'maintenance:compact',
  appOpenExternal: 'app:openExternal',
  appAssetUrl: 'app:assetUrl',
  appVersion: 'app:version',
  appQuit: 'app:quit',
  appRelaunch: 'app:relaunch',
  updaterCheck: 'updater:check',
  updaterDownload: 'updater:download',
  updaterQuitAndInstall: 'updater:quitAndInstall',
  updaterGetStatus: 'updater:getStatus',
  eventRunsChanged: 'event:runs-changed',
  eventInterruptsChanged: 'event:interrupts-changed',
  eventSettingsChanged: 'event:settings-changed',
  eventUpdaterStatus: 'event:updater-status',
  eventDetectionProgress: 'event:detection-progress',
  eventSetupProgress: 'event:setup-progress',
  eventSmithProposalsChanged: 'event:smith-proposals-changed',
  eventSmithProgress: 'event:smith-progress',
  eventBridgeChanged: 'event:bridge-changed',
  eventCompanionChanged: 'event:companion-changed',
} as const;

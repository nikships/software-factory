/**
 * What every IPC handler needs, assembled once. Scope resolution lives here so
 * "which roster does this project see" is answered in exactly one place: a
 * project either uses the global roster or its own copy, never a merge, because
 * a half-inherited roster makes a pipeline's agent reference ambiguous.
 */

import { app, BrowserWindow } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AGENT_MARKS_DIR } from './store/agent-marks.js';
import type { AgentDef, AppSettings, PipelineDef, ReadinessState, RunRow } from '@shared/types.js';
import { IPC, type DetectionState, type SetupState } from '@shared/ipc-contract.js';
import { SettingsStore } from './store/settings.js';
import { ProjectStore } from './store/projects.js';
import { RosterStore } from './store/roster.js';
import { PipelineStore } from './store/pipelines.js';
import { EnvelopeStore } from './store/envelopes.js';
import { RunRegistry } from './engine/registry.js';
import { createDetections, type DetectStart } from './engine/detect-session.js';
import { createSetups, type SetupStart } from './engine/setup-session.js';
import { ReadinessSessions } from './readiness/sessions.js';
import type { PanelRegistry } from './session/index.js';
import { piOneShots } from './pi/pi-oneshot.js';
import type { OneShotFactory } from './pi/oneshot.js';
import { SmithPiTransport } from './pi/smith-transport.js';
import { UpdaterService } from './updater.js';
import { SmithService } from './smith/index.js';
import { SmithChatSession, type SmithToolFactory } from './smith/chat-session.js';
import { smithListTool, smithProposeTool, smithShowTool } from './smith/entity-tools.js';
import { smithEntitiesTool } from './smith/entity-action-tools.js';
import { smithSettingsTool } from './smith/settings-tools.js';
import { smithProjectsTool } from './smith/project-tools.js';
import { smithRunsTool } from './smith/run-tools.js';
import { smithPrsTool } from './smith/pr-tools.js';
import { smithInterruptsTool } from './smith/interrupt-tools.js';
import { smithProvidersTool } from './smith/provider-tools.js';
import { smithCompanionTool } from './smith/companion-tools.js';
import { smithSystemTool } from './smith/system-tools.js';
import { readinessManageTool, readinessToolsFor } from './smith/readiness-tools.js';
import { CompanionHost } from './companion/host.js';
import { saveProposal } from './ipc/smith.js';
import { notifyNeedsInput, notifyOutcome, setDockBadge } from './system/notify.js';
import { getBridgeService, shutdownBridgeService, type BridgeService } from './bridge/service.js';
import { DEFAULT_BRIDGE_PORT } from './bridge/manager.js';

export interface Scope {
  projectId?: string;
  ownRoster?: boolean;
  ownPipelines?: boolean;
}

export class AppContext {
  readonly settings: SettingsStore;
  readonly projects: ProjectStore;
  readonly roster: RosterStore;
  readonly pipelines: PipelineStore;
  readonly envelopes: EnvelopeStore;
  readonly registry: RunRegistry;
  readonly detections: PanelRegistry<DetectStart, DetectionState>;
  readonly setups: PanelRegistry<SetupStart, SetupState>;
  readonly readiness: ReadinessSessions;
  readonly updater: UpdaterService;
  readonly smith: SmithService;
  readonly companion: CompanionHost;
  readonly bridge: BridgeService;
  readonly version: string;
  /**
   * How every non-run agent turn is opened — repository context, detection,
   * setup, the run-start command fill, rebase repair, and the readiness fix.
   * One factory rather than six constructions, so a call site states what it needs (a directory, an
   * access level) and never where the runtime keeps its state.
   */
  readonly oneShot: OneShotFactory;

  constructor(
    readonly supportDir: string,
    private readonly assetsRoot: string,
  ) {
    this.settings = new SettingsStore(supportDir);
    this.projects = new ProjectStore(supportDir);
    this.roster = new RosterStore(supportDir);
    this.pipelines = new PipelineStore(supportDir);
    this.envelopes = new EnvelopeStore(supportDir);
    this.version = app.getVersion();
    // Main starts this after reclaiming any crash-orphaned Bridge and before it
    // opens the first window. Construction stays side-effect free so startup
    // preserves that ordering.
    this.bridge = getBridgeService({
      supportDir,
      port: DEFAULT_BRIDGE_PORT,
      onModelsChanged: () => this.broadcast(IPC.eventBridgeChanged),
      // Resolved per call rather than captured: the registry is built further
      // down this constructor, and the app trace it owns opens on first use.
      trace: () => this.registry.bridgeTrace(),
    });
    this.updater = new UpdaterService((channel, payload) => this.broadcast(channel, payload));
    this.oneShot = piOneShots(supportDir);
    this.detections = createDetections(this.oneShot, (state) =>
      this.broadcast(IPC.eventDetectionProgress, state),
    );
    this.setups = createSetups(this.oneShot, (state) =>
      this.broadcast(IPC.eventSetupProgress, state),
    );
    const smithReadinessObservers = new Map<string, (state: ReadinessState) => void>();
    this.readiness = new ReadinessSessions(this.oneShot, (state) => {
      smithReadinessObservers.get(state.projectId)?.(state);
    });

    this.registry = new RunRegistry({
      appSupportDir: supportDir,
      settings: () => this.settings.get(),
      engineerName: this.settings.get().engineerName,
      onRunFinished: (run: RunRow) => this.onRunFinished(run),
      onInterruptsChanged: () => this.broadcast(IPC.eventInterruptsChanged),
      onRunsChanged: () => {
        setDockBadge(this.registry.liveRunCount(), this.settings.get());
        this.broadcast(IPC.eventRunsChanged);
      },
      projectById: (id) => this.projects.get(id),
      saveProject: (next) => this.projects.save(next),
      notifySettings: () => this.broadcast(IPC.eventSettingsChanged),
    });

    this.registry.on('needs-input', (interrupt: { title: string; body: string }) => {
      notifyNeedsInput(interrupt.title, interrupt.body, this.settings.get());
    });

    // Constructed here; main restores it only when the operator previously
    // enabled it, so a desktop that never pairs a phone never opens a port.
    this.companion = new CompanionHost({
      supportDir,
      projects: () => this.projects.list(),
      projectById: (id) => this.projects.get(id),
      pipelinesFor: (projectId) => this.pipelinesFor(projectId),
      rosterFor: (projectId) => this.rosterFor(projectId),
      envelopeDefs: () => this.envelopes.list(),
      settings: () => this.settings.get(),
      saveProject: (next) => {
        const result = this.projects.save(next);
        if (!result.ok) return next;
        this.broadcast(IPC.eventSettingsChanged);
        return this.projects.get(next.id) ?? next;
      },
      oneShot: this.oneShot,
      registry: this.registry,
      appVersion: () => this.version,
      notifyRuns: () => this.broadcast(IPC.eventRunsChanged),
      onStateChanged: () => this.broadcast(IPC.eventCompanionChanged),
    });

    // Native chats open lazily per project and share one proposal queue, so
    // every path preserves the one-card-at-a-time approval invariant.
    this.smith = new SmithService({
      broadcast: (channel, payload) => this.broadcast(channel, payload),
      channels: { proposalsChanged: IPC.eventSmithProposalsChanged },
      // The queue awaits a save; store access lives in the IPC layer, so the
      // handler is threaded through here rather than importing a store into the
      // queue.
      save: (proposal) => saveProposal(this, proposal),
      createChat: (projectId, proposals) => {
        const project = projectId ? this.projects.get(projectId) : null;
        if (projectId && !project) return null;
        const scopeKey = projectId ?? 'global';
        const chatRoot = join(supportDir, 'pi', 'smith', scopeKey);
        const globalWorkspace = join(chatRoot, 'workspace');
        if (!project) mkdirSync(globalWorkspace, { recursive: true });
        let chat: SmithChatSession | null = null;
        const toolFactories: SmithToolFactory[] = [
          (toolCtx) => {
            const deps = {
              stores: this,
              queue: proposals,
              projectId: () => toolCtx.projectId,
            };
            return [smithListTool(deps), smithShowTool(deps), smithProposeTool(deps)];
          },
          (toolCtx) => {
            const deps = {
              invoke: this.smith.invoke,
              queue: proposals,
              projectId: () => toolCtx.projectId,
            };
            return [
              smithEntitiesTool(deps),
              smithSettingsTool(deps),
              smithProjectsTool(deps),
              smithRunsTool(deps),
              smithPrsTool(deps),
              smithInterruptsTool(deps),
              smithProvidersTool(deps),
              smithCompanionTool(deps),
              smithSystemTool(deps),
              ...(toolCtx.projectId ? [] : [readinessManageTool(deps)]),
            ];
          },
          (toolCtx) => {
            const id = toolCtx.projectId;
            if (!id) return [];
            return readinessToolsFor({
              project: () => {
                const current = this.projects.get(id);
                if (!current) throw new Error('project not found');
                return { path: current.path, baseRef: current.baseRef };
              },
              session: (observe) => {
                const current = this.projects.get(id);
                if (!current) throw new Error('project not found');
                smithReadinessObservers.set(id, observe);
                return this.readiness.open(current, this.settings.get(), (next) => {
                  const saved = this.projects.save(next);
                  if (saved.ok) this.broadcast(IPC.eventSettingsChanged);
                });
              },
              onProgress: (event) => chat?.absorbReadinessProgress(event),
              queue: proposals,
              projectId: () => id,
              invoke: this.smith.invoke,
            });
          },
        ];
        chat = new SmithChatSession({
          scope: project
            ? { kind: 'project', projectId: project.id, projectPath: project.path }
            : { kind: 'global', workspace: globalWorkspace },
          stateDir: chatRoot,
          smithModel: () => this.settings.get().smithModel,
          toolFactories,
          transport: (request) =>
            new SmithPiTransport({
              cwd: request.cwd,
              supportDir,
              sessionDir: join(chatRoot, 'sessions'),
              model: request.model,
              reasoningEffort: request.reasoningEffort,
              harness: request.harness,
              customTools: request.customTools,
              onPermission: request.onPermission,
              onEvent: request.onEvent,
              onModelWarning: request.onModelWarning,
            }),
          onChange: (state) => this.broadcast(IPC.eventSmithProgress, state),
        });
        return chat;
      },
    });
  }

  private onRunFinished(run: RunRow): void {
    notifyOutcome(run, this.settings.get());
    setDockBadge(this.registry.liveRunCount(), this.settings.get());
    this.broadcast(IPC.eventRunsChanged);
  }

  window(): BrowserWindow | null {
    return BrowserWindow.getAllWindows()[0] ?? null;
  }

  broadcast(channel: string, payload?: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    }
  }

  /**
   * Asset paths are resolved in main so a dev server and a packaged app agree
   * without the renderer knowing where the app lives on disk.
   */
  assetUrl(relPath: string): string {
    const cleaned = relPath.replace(/^\/+/, '');
    // User-uploaded marks live next to roster.json, not in the packaged tree.
    if (cleaned.startsWith(`${AGENT_MARKS_DIR}/`)) {
      const file = cleaned.slice(AGENT_MARKS_DIR.length + 1);
      if (file && file === basename(file) && !file.includes('..')) {
        const full = join(this.supportDir, AGENT_MARKS_DIR, file);
        if (existsSync(full)) return pathToFileURL(full).toString();
      }
      return '';
    }
    const full = join(this.assetsRoot, cleaned);
    if (existsSync(full)) return pathToFileURL(full).toString();
    // An empty string renders as a silently missing image, which looks like a
    // styling bug rather than a packaging one. Say where it looked.
    console.warn(`[assets] missing: ${full}`);
    return '';
  }

  rosterScope(projectId?: string): Scope {
    const project = projectId ? this.projects.get(projectId) : null;
    return { projectId, ownRoster: !!project?.ownRoster };
  }

  pipelineScope(projectId?: string): Scope {
    const project = projectId ? this.projects.get(projectId) : null;
    return { projectId, ownPipelines: !!project?.ownPipelines };
  }

  rosterFor(projectId?: string): AgentDef[] {
    return this.roster.list(this.rosterScope(projectId));
  }

  pipelinesFor(projectId?: string): PipelineDef[] {
    return this.pipelines.list(this.pipelineScope(projectId));
  }

  commandNames(projectId?: string): string[] {
    if (!projectId) return [];
    return this.projects.get(projectId)?.commands.map((c) => c.name) ?? [];
  }

  currentSettings(): AppSettings {
    return this.settings.get();
  }

  dispose(): void {
    this.registry.closeAll();
    this.detections.cancelAll();
    this.setups.cancelAll();
    this.readiness.cancelAll();
    this.smith.dispose();
    // Fire-and-forget: close() only unbinds a socket, and dispose stays sync.
    // Preserve the enabled choice so an update/relaunch restores the host.
    void this.companion.stop({ preserveEnabled: true });
    // Agent turns run in this process, so quitting ends them; the Bridge is the
    // one child left, and it has no parent-pid backstop of its own. This is the
    // only thing standing between a quit and an orphaned proxy holding the port.
    // Fire-and-forget so dispose stays sync for before-quit.
    void shutdownBridgeService();
  }
}

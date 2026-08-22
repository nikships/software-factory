/**
 * Documentation-only inventory of the renderer invoke surface and its Smith
 * equivalent. Runtime dispatch must continue to use the typed domain tools;
 * this map is deliberately not a channel router.
 */

import { IPC } from '@shared/ipc-contract.js';

export type SmithCapabilityMode = 'immediate' | 'approval' | 'secure' | 'renderer-only';

export interface SmithCapabilityCoverage {
  tool: string;
  operation: string;
  mode: SmithCapabilityMode;
}

const read = (tool: string, operation: string): SmithCapabilityCoverage => ({
  tool,
  operation,
  mode: 'immediate',
});
const approve = (tool: string, operation: string): SmithCapabilityCoverage => ({
  tool,
  operation,
  mode: 'approval',
});

export const SMITH_CAPABILITY_COVERAGE: Readonly<Record<string, SmithCapabilityCoverage>> = {
  [IPC.settingsGet]: read('smith_settings', 'get'),
  [IPC.settingsPatch]: approve('smith_settings', 'patch'),
  [IPC.projectsList]: read('smith_projects', 'list'),
  [IPC.projectsAdd]: approve('smith_projects', 'add'),
  [IPC.projectsGithubAccount]: read('smith_projects', 'github_account'),
  [IPC.projectsChooseParentDir]: approve('smith_projects', 'choose_parent'),
  [IPC.projectsCreateGithub]: approve('smith_projects', 'create_github'),
  [IPC.projectsSave]: approve('smith_projects', 'save'),
  [IPC.projectsRemove]: approve('smith_projects', 'remove'),
  [IPC.projectsExport]: approve('smith_projects', 'export'),
  [IPC.projectsTryCommand]: approve('smith_projects', 'try_command'),
  [IPC.projectsSniffCommands]: approve('smith_projects', 'sniff_commands'),
  [IPC.projectsAskAgentCommands]: approve('smith_projects', 'ask_commands'),
  [IPC.projectsCancelDetection]: approve('smith_projects', 'cancel_detection'),
  [IPC.projectsDetection]: read('smith_projects', 'detection'),
  [IPC.projectsSetupScriptGet]: read('smith_projects', 'setup_get'),
  [IPC.projectsSetupScriptSave]: approve('smith_projects', 'setup_save'),
  [IPC.projectsSetupScriptSniff]: read('smith_projects', 'setup_sniff'),
  [IPC.projectsSetupScriptTry]: approve('smith_projects', 'setup_try'),
  [IPC.projectsSetupScriptAskAgent]: approve('smith_projects', 'setup_ask'),
  [IPC.projectsSetupProgress]: read('smith_projects', 'setup_progress'),
  [IPC.projectsSetupCancel]: approve('smith_projects', 'setup_cancel'),
  [IPC.projectsCheck]: read('smith_projects', 'check'),
  [IPC.projectsReveal]: approve('smith_projects', 'reveal'),
  [IPC.projectsScopeCopies]: read('smith_projects', 'scope_copies'),
  [IPC.projectsBaseSyncInspect]: read('smith_projects', 'base_inspect'),
  [IPC.projectsBaseSync]: approve('smith_projects', 'base_sync'),
  [IPC.readinessInspect]: read('readiness_manage', 'inspect'),
  [IPC.readinessEvaluate]: approve('readiness_manage', 'evaluate'),
  [IPC.readinessMakeReady]: approve('readiness_remediate', 'remediate'),
  [IPC.readinessCancel]: approve('readiness_manage', 'cancel'),
  [IPC.readinessGet]: read('readiness_manage', 'state'),
  [IPC.readinessSkip]: approve('readiness_manage', 'skip'),
  [IPC.readinessRetry]: approve('readiness_manage', 'retry'),
  [IPC.readinessConfirmMerge]: approve('readiness_manage', 'confirm_merge'),
  [IPC.readinessDismiss]: approve('readiness_manage', 'dismiss'),
  [IPC.rosterList]: read('smith_list', 'agent'),
  [IPC.rosterStaleBuiltins]: read('smith_entities', 'agent_stale'),
  [IPC.rosterSave]: approve('smith_propose', 'agent'),
  [IPC.rosterRename]: approve('smith_entities', 'agent_rename'),
  [IPC.rosterRemove]: approve('smith_entities', 'agent_remove'),
  [IPC.rosterDuplicate]: approve('smith_entities', 'agent_duplicate'),
  [IPC.rosterValidate]: read('smith_entities', 'agent_validate'),
  [IPC.rosterPreview]: read('smith_entities', 'agent_preview'),
  [IPC.rosterReset]: approve('smith_entities', 'agent_reset'),
  [IPC.rosterUploadMark]: approve('smith_entities', 'agent_upload_mark'),
  [IPC.rosterRemoveMark]: approve('smith_entities', 'agent_remove_mark'),
  [IPC.envelopesList]: read('smith_list', 'envelope'),
  [IPC.envelopesSave]: approve('smith_propose', 'envelope'),
  [IPC.envelopesRemove]: approve('smith_entities', 'envelope_remove'),
  [IPC.envelopesDuplicate]: approve('smith_entities', 'envelope_duplicate'),
  [IPC.envelopesUsage]: read('smith_entities', 'envelope_usage'),
  [IPC.envelopesValidate]: read('smith_entities', 'envelope_validate'),
  [IPC.envelopesPreview]: read('smith_entities', 'envelope_preview'),
  [IPC.pipelinesList]: read('smith_list', 'pipeline'),
  [IPC.pipelinesStaleBuiltins]: read('smith_entities', 'pipeline_stale'),
  [IPC.pipelinesSave]: approve('smith_propose', 'pipeline'),
  [IPC.pipelinesRemove]: approve('smith_entities', 'pipeline_remove'),
  [IPC.pipelinesDuplicate]: approve('smith_entities', 'pipeline_duplicate'),
  [IPC.pipelinesValidate]: read('smith_entities', 'pipeline_validate'),
  [IPC.pipelinesDryRun]: read('smith_entities', 'pipeline_dry_run'),
  [IPC.pipelinesReset]: approve('smith_entities', 'pipeline_reset'),
  [IPC.catalogGates]: read('smith_settings', 'catalog_gates'),
  [IPC.catalogTemplateVariables]: read('smith_settings', 'catalog_template_variables'),
  [IPC.catalogAgentModels]: read('smith_settings', 'catalog_models'),
  [IPC.bridgeState]: read('smith_providers', 'state'),
  [IPC.bridgeConnect]: approve('smith_providers', 'connect'),
  [IPC.bridgeDisconnect]: approve('smith_providers', 'disconnect'),
  [IPC.bridgeCancelLogin]: approve('smith_providers', 'cancel_login'),
  [IPC.bridgeSetApiKey]: { tool: 'smith_providers', operation: 'set_api_key', mode: 'secure' },
  [IPC.bridgeClearApiKey]: approve('smith_providers', 'clear_api_key'),
  [IPC.bridgeStoredKeys]: read('smith_providers', 'stored_keys'),
  [IPC.runsStart]: approve('smith_runs', 'start'),
  [IPC.runsResume]: approve('smith_runs', 'resume'),
  [IPC.runsList]: read('smith_runs', 'list'),
  [IPC.runsDetail]: read('smith_runs', 'detail'),
  [IPC.runsEvents]: read('smith_runs', 'events'),
  [IPC.runsLiveTail]: read('smith_runs', 'live_tail'),
  [IPC.runsContextBreakdown]: read('smith_runs', 'context'),
  [IPC.runsPrompt]: read('smith_runs', 'prompt'),
  [IPC.runsKill]: approve('smith_runs', 'kill'),
  [IPC.runsArchive]: approve('smith_runs', 'archive'),
  [IPC.runsMergeWorktree]: approve('smith_runs', 'merge'),
  [IPC.runsFixMerge]: approve('smith_runs', 'fix_merge'),
  [IPC.runsDiscardWorktree]: approve('smith_runs', 'discard'),
  [IPC.runsOpenWorktree]: approve('smith_runs', 'open_worktree'),
  [IPC.runsRevealFiles]: approve('smith_runs', 'reveal_files'),
  [IPC.prsStatus]: read('smith_prs', 'status'),
  [IPC.prsList]: read('smith_prs', 'list'),
  [IPC.prsCreate]: approve('smith_prs', 'create'),
  [IPC.prsMerge]: approve('smith_prs', 'merge'),
  [IPC.prsFixConflicts]: approve('smith_prs', 'fix_conflicts'),
  [IPC.interruptsList]: read('smith_interrupts', 'list'),
  [IPC.interruptsAnswer]: approve('smith_interrupts', 'answer'),
  [IPC.companionState]: read('smith_companion', 'state'),
  [IPC.companionStart]: approve('smith_companion', 'start'),
  [IPC.companionStop]: approve('smith_companion', 'stop'),
  [IPC.companionPairingPayload]: {
    tool: 'smith_companion',
    operation: 'pairing',
    mode: 'secure',
  },
  [IPC.companionUnpair]: approve('smith_companion', 'unpair'),
  [IPC.doctorRun]: read('smith_system', 'doctor'),
  [IPC.maintenanceOrphans]: read('smith_system', 'orphans'),
  [IPC.maintenanceRemoveWorktree]: approve('smith_system', 'remove_orphan'),
  [IPC.maintenanceRetention]: approve('smith_system', 'apply_retention'),
  [IPC.maintenanceCompact]: approve('smith_system', 'compact'),
  [IPC.appOpenExternal]: approve('smith_system', 'open_external'),
  [IPC.appAssetUrl]: { tool: 'renderer', operation: 'asset_url', mode: 'renderer-only' },
  [IPC.appVersion]: read('smith_system', 'version'),
  [IPC.appQuit]: approve('smith_system', 'quit'),
  [IPC.appRelaunch]: approve('smith_system', 'relaunch'),
  [IPC.updaterCheck]: approve('smith_system', 'update_check'),
  [IPC.updaterDownload]: approve('smith_system', 'update_download'),
  [IPC.updaterQuitAndInstall]: approve('smith_system', 'update_install'),
  [IPC.updaterGetStatus]: read('smith_system', 'update_status'),
};

/** Event constants are subscriptions, not invokes, and Smith lifecycle invokes
 * are intentionally implemented by the chat seam rather than Smith tools. */
export function uncoveredSmithInvokeChannels(
  ipc: Readonly<Record<string, string>> = IPC,
  coverage: Readonly<Record<string, SmithCapabilityCoverage>> = SMITH_CAPABILITY_COVERAGE,
): string[] {
  return Object.values(ipc).filter(
    (channel) =>
      !channel.startsWith('event:') &&
      !channel.startsWith('smith:') &&
      coverage[channel] === undefined,
  );
}

/**
 * Smith's chat harness: the persona and entity schemas from the skill
 * survive; the CLI reference does not. The screen context renders as a
 * compact standing block, never a payload.
 */

import { describe, expect, it } from 'vitest';
import { SMITH_CHAT_HARNESS, screenContextBlock } from '../../../src/main/smith/system-prompt.js';

describe('SMITH_CHAT_HARNESS', () => {
  it('states the Smith identity and its place inside the app', () => {
    expect(SMITH_CHAT_HARNESS).toContain("You are Smith, Foundry's entity-smith");
    expect(SMITH_CHAT_HARNESS).toContain('inside the');
    expect(SMITH_CHAT_HARNESS).toContain('Foundry app');
  });

  it('keeps the Foundry vocabulary the skill taught', () => {
    for (const term of ['pipeline', 'agent', 'envelope', 'Gates', 'acceptance', 'worktree']) {
      expect(SMITH_CHAT_HARNESS).toContain(term);
    }
  });

  it('carries the entity schemas: fields, enums, and reserved names', () => {
    expect(SMITH_CHAT_HARNESS).toContain('`reasoningEffort` (required)');
    expect(SMITH_CHAT_HARNESS).toContain('`writes` (required)');
    expect(SMITH_CHAT_HARNESS).toContain('all_phases_pass');
    expect(SMITH_CHAT_HARNESS).toContain('envelope_status');
    // The reserved base fields a custom envelope may not redeclare.
    for (const field of ['status', 'summary', 'artifacts', 'notes_for_next_agent']) {
      expect(SMITH_CHAT_HARNESS).toContain(field);
    }
    // The built-in envelope kinds a custom name may not collide with.
    for (const kind of ['generic', 'brief', 'plan', 'build', 'scout', 'review']) {
      expect(SMITH_CHAT_HARNESS).toContain(kind);
    }
  });

  it('keeps the approval contract: one card, no note, never re-propose the same spec', () => {
    expect(SMITH_CHAT_HARNESS).toContain('One proposal may be pending at a time');
    expect(SMITH_CHAT_HARNESS).toContain('rejection carries no note');
    expect(SMITH_CHAT_HARNESS).toContain('Never re-propose the same spec');
    expect(SMITH_CHAT_HARNESS).toContain('`show` before `edit`');
  });

  it('documents parity approvals and private secret handling', () => {
    expect(SMITH_CHAT_HARNESS).toContain('Read-only application operations execute immediately');
    expect(SMITH_CHAT_HARNESS).toContain('API keys are never tool arguments');
    expect(SMITH_CHAT_HARNESS).toContain('private operator displays');
    expect(SMITH_CHAT_HARNESS).toContain('All projects scope');
  });

  it('drops the CLI reference — the tools carry that contract now', () => {
    for (const gone of [
      'foundry-cli',
      'FOUNDRY_SMITH_PROJECT',
      'FOUNDRY_SMITH_SOCKET',
      'unix socket',
      '--file',
      'exit 2',
      'Ghostty',
      '/opt/homebrew',
      'app.asar',
    ]) {
      expect(SMITH_CHAT_HARNESS).not.toContain(gone);
    }
  });
});

describe('screenContextBlock', () => {
  it('names the route and the entity the operator is looking at', () => {
    const block = screenContextBlock({ route: 'runs', entity: { kind: 'run', id: 'run_42' } });
    expect(block).toContain('## Operator screen context');
    expect(block).toContain('runs — run run_42');
    expect(block).toContain('"this run"');
  });

  it('renders a route with no entity without inventing one', () => {
    const block = screenContextBlock({ route: 'settings' });
    expect(block).toContain('viewing: settings.');
    expect(block).not.toContain('—');
  });

  it('names a settings pane when the operator is in Settings', () => {
    const block = screenContextBlock({
      route: 'settings',
      entity: { kind: 'settings', id: 'models' },
    });
    expect(block).toContain('settings — settings models');
  });

  it('stays compact: a descriptor, not a payload', () => {
    const block = screenContextBlock({
      route: 'pipelines',
      entity: { kind: 'pipeline', id: 'ship-it' },
    });
    expect(block.split('\n').length).toBeLessThan(10);
  });
});

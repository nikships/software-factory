import { describe, expect, it } from 'vitest';
import { resolveSmithProjectId } from '../../src/renderer/view-models/smith-scope.js';

const projects = [{ id: 'one' }, { id: 'two' }];

describe('Smith scope resolution', () => {
  it('defaults a first-time preference to the selected project', () => {
    expect(resolveSmithProjectId(projects, 'two', null, false)).toBe('two');
  });

  it('preserves an explicit All projects preference', () => {
    expect(resolveSmithProjectId(projects, 'two', null, true)).toBeNull();
  });

  it('preserves a valid Smith project independently of app selection', () => {
    expect(resolveSmithProjectId(projects, 'two', 'one', true)).toBe('one');
  });

  it('falls back when a saved project was removed, and global when none remain', () => {
    expect(resolveSmithProjectId(projects, 'two', 'gone', true)).toBe('two');
    expect(resolveSmithProjectId([], '', 'gone', true)).toBeNull();
  });
});

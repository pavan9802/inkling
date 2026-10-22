import { describe, it, expect } from 'bun:test';
import { getLanguageProfile } from '../src/language/profiles.js';

describe('getLanguageProfile', () => {
  it('returns the generic fallback for unknown language IDs', () => {
    const p = getLanguageProfile('unknown-lang');
    expect(p.id).toBe('generic');
    expect(p.lineComment).toBe('//');
    expect(p.maxMultilineLines).toBe(8);
  });

  it('returns the Java profile with maxMultilineLines 12', () => {
    const p = getLanguageProfile('java');
    expect(p.id).toBe('java');
    expect(p.lineComment).toBe('//');
    expect(p.maxMultilineLines).toBe(12);
    // Java does not have '=>' as a block opener (no arrow expressions)
    expect(p.blockOpeners).not.toContain('=>');
  });

  it('returns the Python profile with correct block openers and comment syntax', () => {
    const p = getLanguageProfile('python');
    expect(p.id).toBe('python');
    expect(p.lineComment).toBe('#');
    // ':' is the Python block opener (def, if, for, while, with, class all end with ':')
    expect(p.blockOpeners).toContain(':');
    expect(p.maxMultilineLines).toBe(12);
    expect(p.stopSequences).toEqual(['\n\n']);
  });

  it('returns the Go profile without \'=> \'', () => {
    const p = getLanguageProfile('go');
    expect(p.id).toBe('go');
    expect(p.lineComment).toBe('//');
    expect(p.blockOpeners).toContain('{');
    expect(p.blockOpeners).not.toContain('=>');
    expect(p.maxMultilineLines).toBe(10);
  });

  it('returns the Rust profile with \'=>\' for match arms', () => {
    const p = getLanguageProfile('rust');
    expect(p.id).toBe('rust');
    expect(p.lineComment).toBe('//');
    expect(p.blockOpeners).toContain('=>');
    expect(p.maxMultilineLines).toBe(10);
  });

  it('returns TypeScript and JavaScript profiles', () => {
    expect(getLanguageProfile('typescript').id).toBe('typescript');
    expect(getLanguageProfile('javascript').id).toBe('javascript');
    expect(getLanguageProfile('typescriptreact').id).toBe('typescriptreact');
    expect(getLanguageProfile('javascriptreact').id).toBe('javascriptreact');
  });
});

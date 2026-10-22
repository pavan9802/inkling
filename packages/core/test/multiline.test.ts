import { describe, expect, test } from 'bun:test';
import { resolveCompletionMode } from '../src/language/multiline.js';
import { getLanguageProfile } from '../src/language/profiles.js';

describe('resolveCompletionMode', () => {
  const ts = getLanguageProfile('typescript'); // blockOpeners: ['{', '(', '[', '=>']

  test('off mode always returns single-line regardless of prefix', () => {
    const mode = resolveCompletionMode('function foo() {', ts, 'off');
    expect(mode.multiline).toBe(false);
    expect(mode.maxLines).toBe(1);
    expect(mode.stopSequences).toContain('\n');
  });

  test('always mode returns multiline even without a block opener', () => {
    const mode = resolveCompletionMode('const x = ', ts, 'always');
    expect(mode.multiline).toBe(true);
    expect(mode.maxLines).toBe(ts.maxMultilineLines);
  });

  test('auto detects opening brace as block opener', () => {
    const mode = resolveCompletionMode('function foo() {', ts, 'auto');
    expect(mode.multiline).toBe(true);
  });

  test('auto detects arrow function as block opener', () => {
    const mode = resolveCompletionMode('const fn = =>', ts, 'auto');
    expect(mode.multiline).toBe(true);
  });

  test('auto returns single-line for a plain expression', () => {
    const mode = resolveCompletionMode('const x = foo', ts, 'auto');
    expect(mode.multiline).toBe(false);
    expect(mode.stopSequences).toContain('\n');
  });

  test('auto ignores trailing whitespace when checking opener', () => {
    const mode = resolveCompletionMode('function bar() {  \n', ts, 'auto');
    expect(mode.multiline).toBe(true);
  });
});

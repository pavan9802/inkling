import type { LanguageProfile } from './types.js';

const GENERIC: LanguageProfile = {
  id: 'generic',
  lineComment: '//',
  blockOpeners: ['{', '(', '['],
  stopSequences: ['\n\n'],
  maxMultilineLines: 8,
};

const cStyle = (id: string, extra: Partial<LanguageProfile> = {}): LanguageProfile => ({
  ...GENERIC,
  id,
  lineComment: '//',
  blockOpeners: ['{', '(', '[', '=>'],
  ...extra,
});

const PROFILES: Readonly<Record<string, LanguageProfile>> = {
  // Java: raise maxMultilineLines 8→12 because method bodies with try/catch, getters,
  // and type annotations regularly exceed 8 lines, truncating useful completions.
  java: cStyle('java', { blockOpeners: ['{', '(', '['], maxMultilineLines: 12 }),
  typescript: cStyle('typescript'),
  typescriptreact: cStyle('typescriptreact'),
  javascript: cStyle('javascript'),
  javascriptreact: cStyle('javascriptreact'),
  // Python: ':' is the block opener (def foo():, if x:, for i in ...:) and '#' is
  // the line comment. maxMultilineLines 12 because Python functions are longer on
  // average than C-style equivalents (no braces → more lines per logical block).
  python: {
    id: 'python',
    lineComment: '#',
    blockOpeners: [':', '(', '['],
    stopSequences: ['\n\n'],
    maxMultilineLines: 12,
  },
  // Go: '=>' not included — Go uses '{' for all block forms including closures.
  go: {
    id: 'go',
    lineComment: '//',
    blockOpeners: ['{', '(', '['],
    stopSequences: ['\n\n'],
    maxMultilineLines: 10,
  },
  // Rust: '=>' added for match arms (pattern => expr).
  rust: {
    id: 'rust',
    lineComment: '//',
    blockOpeners: ['{', '(', '[', '=>'],
    stopSequences: ['\n\n'],
    maxMultilineLines: 10,
  },
};

/** Return the profile for a language id, or the generic fallback. */
export function getLanguageProfile(languageId: string): LanguageProfile {
  return PROFILES[languageId] ?? GENERIC;
}

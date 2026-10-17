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
  java: cStyle('java', { blockOpeners: ['{', '(', '['] }),
  typescript: cStyle('typescript'),
  typescriptreact: cStyle('typescriptreact'),
  javascript: cStyle('javascript'),
  javascriptreact: cStyle('javascriptreact'),
};

/** Return the profile for a language id, or the generic fallback. */
export function getLanguageProfile(languageId: string): LanguageProfile {
  return PROFILES[languageId] ?? GENERIC;
}

import type { Profile, ResolvedConfig } from './types.js';

/** Settings shared by all profiles; a profile overrides a subset. */
const BASE: ResolvedConfig = {
  enabled: true,
  profile: 'fast',
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5-coder:3b',
  budgets: {
    prefixChars: 3000,
    suffixChars: 1000,
    contextChars: 0,
    maxOutputTokens: 96,
  },
  retrievers: { openTabs: false, lsp: false, index: false },
  multiline: 'auto',
  debounceMs: 200,
  deadlineMs: 80,
  temperature: 0.1,
  perLanguage: {},
};

/**
 * `fast` (default): single-file + open-tabs context only, tight budgets.
 * `quality`: larger budgets, more retrievers, more generous deadline.
 *
 * `custom` starts from `fast` and lets the adapter override any field.
 */
export function defaultConfigForProfile(profile: Profile): ResolvedConfig {
  switch (profile) {
    case 'quality':
      return {
        ...BASE,
        profile: 'quality',
        budgets: { prefixChars: 6000, suffixChars: 2000, contextChars: 4000, maxOutputTokens: 256 },
        retrievers: { openTabs: true, lsp: true, index: true },
        deadlineMs: 150,
      };
    case 'fast':
    case 'custom':
    default:
      return { ...BASE, profile, retrievers: { openTabs: true, lsp: false, index: false } };
  }
}

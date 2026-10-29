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
    // 64 tokens covers a full line of TypeScript comfortably (~10–30 tokens)
    // and keeps fast-profile inference time low. quality profile uses 256.
    maxOutputTokens: 64,
  },
  retrievers: { openTabs: false, lsp: false, index: false },
  routing: {
    budget: 'latency',
    complexityThreshold: 50,
    fastModel: 'qwen2.5-coder:3b',
    qualityModel: 'qwen2.5-coder:7b',
  },
  // 'always' is the right default: code positions are usually inside open blocks,
  // and the auto heuristic (last-char block opener check) misses them. Users who
  // want conservative single-line completions can set multiline to 'auto' or 'off'.
  multiline: 'always',
  // 75ms matches Copilot/Codeium. 200ms was too conservative and added a
  // noticeable delay before the request even started.
  debounceMs: 75,
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
        // quality profile routes every request to the quality model
        routing: { ...BASE.routing, budget: 'quality' },
      };
    case 'fast':
    case 'custom':
    default:
      return { ...BASE, profile, retrievers: { openTabs: true, lsp: false, index: false } };
  }
}

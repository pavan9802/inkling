import { describe, it, expect } from 'bun:test';
import { FixedRouter, RequestRouter } from '../src/routing/router.js';
import type { CompletionBackend } from '../src/backend/types.js';
import type { CompletionRequest } from '../src/context/types.js';
import type { ResolvedConfig } from '../src/config/types.js';
import { defaultConfigForProfile } from '../src/config/profiles.js';

function mockBackend(id: string): CompletionBackend {
  return {
    id,
    isAvailable: async () => true,
    complete: async () => ({ text: '', stoppedEarly: false }),
  };
}

const fastBackend = mockBackend('fast');
const qualityBackend = mockBackend('quality');

const fast = { model: 'qwen2.5-coder:3b', backend: fastBackend };
const quality = { model: 'qwen2.5-coder:7b', backend: qualityBackend };

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { ...defaultConfigForProfile('fast'), ...overrides };
}

const REQ: CompletionRequest = {
  uri: 'test.ts',
  languageId: 'typescript',
  prefix: 'function add() {\n',
  suffix: '}\n',
};

describe('FixedRouter', () => {
  it('always returns the same candidate regardless of request', () => {
    const router = new FixedRouter(fast);
    const a = router.selectCandidate(REQ, makeConfig(), { recentP50Ms: 0 });
    const b = router.selectCandidate(REQ, makeConfig(), { recentP50Ms: 9999 });
    expect(a).toBe(fast);
    expect(b).toBe(fast);
  });

  it('returns the quality candidate when constructed with quality', () => {
    const router = new FixedRouter(quality);
    const result = router.selectCandidate(REQ, makeConfig(), { recentP50Ms: 0 });
    expect(result.model).toBe('qwen2.5-coder:7b');
  });
});

describe('RequestRouter', () => {
  it('returns fast candidate when prefix is below complexity threshold', () => {
    const router = new RequestRouter(fast, quality);
    // Default complexityThreshold is 50; REQ has 2 lines.
    const result = router.selectCandidate(REQ, makeConfig(), { recentP50Ms: 0 });
    expect(result.model).toBe('qwen2.5-coder:3b');
  });

  it('returns quality candidate when prefix line count exceeds threshold', () => {
    const router = new RequestRouter(fast, quality);
    const longPrefix = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const req = { ...REQ, prefix: longPrefix };
    const result = router.selectCandidate(req, makeConfig(), { recentP50Ms: 0 });
    expect(result.model).toBe('qwen2.5-coder:7b');
  });

  it('latency guard: falls back to fast when p50 exceeds 1 500 ms', () => {
    const router = new RequestRouter(fast, quality);
    // Long prefix would normally pick quality, but latency guard overrides it.
    const longPrefix = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const req = { ...REQ, prefix: longPrefix };
    const result = router.selectCandidate(req, makeConfig(), { recentP50Ms: 1600 });
    expect(result.model).toBe('qwen2.5-coder:3b');
  });

  it('complexity threshold boundary: exactly at threshold (split length = 50) uses fast', () => {
    const router = new RequestRouter(fast, quality);
    // prefix.split('\n').length === 50 → 50 > 50 is false → fast
    // 50 elements joined by '\n' gives 49 internal newlines, split.length = 50.
    const prefix = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const req = { ...REQ, prefix };
    const result = router.selectCandidate(req, makeConfig(), { recentP50Ms: 0 });
    expect(result.model).toBe('qwen2.5-coder:3b');
  });

  it('complexity threshold boundary: split length = 51 picks quality', () => {
    const router = new RequestRouter(fast, quality);
    // 51 elements joined by '\n' gives split.length = 51 → 51 > 50 → quality
    const prefix = Array.from({ length: 51 }, (_, i) => `line ${i}`).join('\n');
    const req = { ...REQ, prefix };
    const result = router.selectCandidate(req, makeConfig(), { recentP50Ms: 0 });
    expect(result.model).toBe('qwen2.5-coder:7b');
  });
});

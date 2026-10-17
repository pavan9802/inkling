import { describe, expect, test } from 'bun:test';
import { detectFimFamily, fillFimTemplate } from '../src/prompt/fim-registry.js';

describe('FIM registry', () => {
  test('detects families from model tags', () => {
    expect(detectFimFamily('qwen2.5-coder:3b')).toBe('qwen');
    expect(detectFimFamily('starcoder2:7b')).toBe('starcoder2');
    expect(detectFimFamily('deepseek-coder:6.7b')).toBe('deepseek');
    expect(detectFimFamily('gemma:2b')).toBeUndefined();
  });

  test('qwen template places prefix, suffix, then middle sentinel', () => {
    const out = fillFimTemplate('qwen', { prefix: 'PRE', suffix: 'SUF' });
    expect(out).toBe('<|fim_prefix|>PRE<|fim_suffix|>SUF<|fim_middle|>');
  });

  test('deepseek uses its hole token between prefix and suffix', () => {
    const out = fillFimTemplate('deepseek', { prefix: 'PRE', suffix: 'SUF' });
    expect(out.startsWith('<｜fim▁begin｜>PRE<｜fim▁hole｜>SUF')).toBe(true);
  });
});

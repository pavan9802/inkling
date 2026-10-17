/**
 * FIM template registry (ADR-0002).
 *
 * Each code-model family uses different fill-in-the-middle sentinel tokens.
 * We build the raw prompt ourselves so we control context placement and stay
 * portable across backends.
 *
 * NOTE: token strings must be verified against each model's tokenizer at
 * implementation time — they can change across model versions.
 */

export type FimFamily = 'qwen' | 'starcoder2' | 'deepseek' | 'codellama';

export interface FimTokens {
  readonly family: FimFamily;
  readonly a: string; // prefix / begin sentinel
  readonly b: string; // suffix / hole sentinel
  readonly c: string; // middle / end sentinel
}

const TOKENS: Readonly<Record<FimFamily, FimTokens>> = {
  qwen: { family: 'qwen', a: '<|fim_prefix|>', b: '<|fim_suffix|>', c: '<|fim_middle|>' },
  starcoder2: { family: 'starcoder2', a: '<fim_prefix>', b: '<fim_suffix>', c: '<fim_middle>' },
  deepseek: { family: 'deepseek', a: '<｜fim▁begin｜>', b: '<｜fim▁hole｜>', c: '<｜fim▁end｜>' },
  codellama: { family: 'codellama', a: '<PRE>', b: '<SUF>', c: '<MID>' },
};

/** Map a model tag to its FIM family, or `undefined` if unknown (UI flags it). */
export function detectFimFamily(modelId: string): FimFamily | undefined {
  const id = modelId.toLowerCase();
  if (id.includes('qwen')) return 'qwen';
  if (id.includes('starcoder')) return 'starcoder2';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('codellama') || id.includes('code-llama')) return 'codellama';
  return undefined;
}

export function fimTokens(family: FimFamily): FimTokens {
  return TOKENS[family];
}

/** Assemble a raw FIM prompt. The model continues after the final sentinel. */
export function fillFimTemplate(family: FimFamily, parts: { prefix: string; suffix: string }): string {
  const t = TOKENS[family];
  switch (family) {
    case 'qwen':
    case 'starcoder2':
      // <A>{prefix}<B>{suffix}<C>
      return `${t.a}${parts.prefix}${t.b}${parts.suffix}${t.c}`;
    case 'deepseek':
      // <begin>{prefix}<hole>{suffix}<end>
      return `${t.a}${parts.prefix}${t.b}${parts.suffix}${t.c}`;
    case 'codellama':
      // whitespace-sensitive: <PRE> {prefix} <SUF>{suffix} <MID>
      return `${t.a} ${parts.prefix} ${t.b}${parts.suffix} ${t.c}`;
  }
}

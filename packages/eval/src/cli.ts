/**
 * Headless eval CLI (ADR-0005). Punches FIM holes in a fixture corpus, runs
 * them through the real core pipeline against a live Ollama, and reports the
 * quality + latency numbers the phase gates read.
 *
 * Usage: bun run src/cli.ts --corpus ./fixtures --model qwen2.5-coder:3b
 *        bun run src/cli.ts --corpus ./fixtures --model qwen2.5-coder:3b --endpoint http://localhost:11434
 */
import { OllamaBackend, defaultConfigForProfile, detectFimFamily, getLanguageProfile, buildCompletionPrompt, truncateAtStop, trimSuffixOverlap, isLowValue } from '@inkling/core';
import { loadCases, scoreCase, aggregate, type CaseResult } from './harness.js';

function langFromFile(file: string): string {
  if (file.endsWith('.tsx')) return 'typescriptreact';
  if (file.endsWith('.ts')) return 'typescript';
  if (file.endsWith('.jsx')) return 'javascriptreact';
  if (file.endsWith('.js')) return 'javascript';
  if (file.endsWith('.java')) return 'java';
  return 'generic';
}

interface Args {
  corpus: string;
  model: string;
  endpoint: string;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const corpus = get('--corpus');
  const model = get('--model');
  if (!corpus || !model) {
    console.error('Usage: inkling-eval --corpus <dir> --model <tag> [--endpoint <url>]');
    process.exit(1);
  }

  return {
    corpus,
    model,
    endpoint: get('--endpoint') ?? 'http://localhost:11434',
  };
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);

  // --- step 2: object graph ---
  const family = detectFimFamily(args.model);
  if (!family) {
    console.error(`Unknown FIM family for model "${args.model}". Supported: qwen, starcoder2, deepseek, codellama.`);
    process.exit(1);
  }

  const config = defaultConfigForProfile('fast');
  const backend = new OllamaBackend({ endpoint: args.endpoint, model: args.model, keepAlive: '30m' });

  if (!(await backend.isAvailable())) {
    console.error(`Model "${args.model}" not found at ${args.endpoint}. Is Ollama running?`);
    process.exit(1);
  }

  // --- step 3: load cases ---
  const cases = await loadCases(args.corpus);
  if (cases.length === 0) {
    console.error(`No fixture files found in "${args.corpus}". Add .json cases first.`);
    process.exit(1);
  }
  console.error(`Loaded ${cases.length} case(s) from ${args.corpus}`);

  // --- step 4: run each case ---
  const results: CaseResult[] = [];

  for (const c of cases) {
    const langProfile = getLanguageProfile(langFromFile(c.file));
    const prompt = buildCompletionPrompt({
      req: { uri: c.file, languageId: langProfile.id, prefix: c.prefix, suffix: c.suffix },
      snippets: [], // baseline: no cross-file context
      profile: langProfile,
      family,
    });

    const controller = new AbortController();
    const start = Date.now();
    let rawText: string;
    try {
      const result = await backend.complete({
        prompt,
        stop: langProfile.stopSequences,
        maxTokens: config.budgets.maxOutputTokens,
        temperature: config.temperature,
        signal: controller.signal,
      });
      rawText = result.text;
    } catch (err) {
      console.error(`  [skip] ${c.file}: ${err}`);
      continue;
    }
    const latencyMs = Date.now() - start;

    const produced = trimSuffixOverlap(
      truncateAtStop(rawText, langProfile.stopSequences),
      c.suffix,
    );

    if (isLowValue(produced)) {
      console.error(`  [skip] ${c.file}: low-value completion`);
      continue;
    }

    const result = scoreCase(c, produced, latencyMs);
    results.push(result);
    console.error(`  [${results.length}/${cases.length}] ${c.file} — ${(result.similarity * 100).toFixed(1)}% similarity`);
  }

  // --- step 5: aggregate ---
  const report = aggregate(results);

  // --- step 6: print ---
  console.log(JSON.stringify(report, null, 2));
}

main(process.argv.slice(2));

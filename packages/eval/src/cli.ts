/**
 * Headless eval CLI (ADR-0005). Punches FIM holes in a fixture corpus, runs
 * them through the real core pipeline against a live Ollama, and reports the
 * quality + latency numbers the phase gates read.
 *
 * Usage: bun run src/cli.ts --corpus ./fixtures --model qwen2.5-coder:3b
 *        bun run src/cli.ts --corpus ./fixtures --model qwen2.5-coder:3b --endpoint http://localhost:11434
 */
import {
  OllamaBackend,
  ContextAssembler,
  CompletionPipeline,
  defaultConfigForProfile,
  getLanguageProfile,
  type CompletionRequest,
} from '@inkling/core';
import { loadCases, scoreCase, aggregate, type CaseResult } from './harness.js';

function langFromFile(file: string): string {
  if (file.endsWith('.tsx')) return 'typescriptreact';
  if (file.endsWith('.ts')) return 'typescript';
  if (file.endsWith('.jsx')) return 'javascriptreact';
  if (file.endsWith('.js')) return 'javascript';
  if (file.endsWith('.java')) return 'java';
  if (file.endsWith('.py')) return 'python';
  if (file.endsWith('.go')) return 'go';
  if (file.endsWith('.rs')) return 'rust';
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

  const config = defaultConfigForProfile('fast');
  const backend = new OllamaBackend({ endpoint: args.endpoint, model: args.model, keepAlive: '30m' });

  if (!(await backend.isAvailable())) {
    console.error(`Model "${args.model}" not found at ${args.endpoint}. Is Ollama running?`);
    process.exit(1);
  }

  // No cross-file context for the baseline eval — empty retriever list.
  const assembler = new ContextAssembler([]);
  const pipeline = new CompletionPipeline(assembler, backend, () => ({ ...config, model: args.model }));

  const cases = await loadCases(args.corpus);
  if (cases.length === 0) {
    console.error(`No fixture files found in "${args.corpus}". Add .json cases first.`);
    process.exit(1);
  }
  console.error(`Loaded ${cases.length} case(s) from ${args.corpus}`);

  const results: CaseResult[] = [];

  for (const c of cases) {
    const langProfile = getLanguageProfile(langFromFile(c.file));
    const req: CompletionRequest = {
      uri: c.file,
      languageId: langProfile.id,
      prefix: c.prefix,
      suffix: c.suffix,
    };

    const controller = new AbortController();
    const start = Date.now();
    let produced: string;
    try {
      const result = await pipeline.run(req, controller.signal);
      if (!result) {
        console.error(`  [skip] ${c.file}: low-value completion`);
        continue;
      }
      produced = result.text;
    } catch (err) {
      console.error(`  [skip] ${c.file}: ${err}`);
      continue;
    }
    const latencyMs = Date.now() - start;

    const scored = scoreCase(c, produced, latencyMs);
    results.push(scored);
    console.error(`  [${results.length}/${cases.length}] ${c.file} — ${(scored.similarity * 100).toFixed(1)}% similarity`);
  }

  const report = aggregate(results);
  console.log(JSON.stringify(report, null, 2));
}

main(process.argv.slice(2));

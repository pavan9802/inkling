/**
 * Headless eval CLI (ADR-0005). Punches FIM holes in a fixture corpus, runs
 * them through the real core pipeline against a live Ollama, and reports the
 * quality + latency numbers the phase gates read.
 *
 * Phase 0: argument shape and reporting wiring are stubbed until the corpus and
 * a live backend call exist.
 *
 * Usage: bun run src/cli.ts --corpus ./fixtures --model qwen2.5-coder:3b
 */
import { notImplemented } from '@inkling/core';

function main(argv: readonly string[]): void {
  void argv;
  // TODO(phase-0): parse flags, loadCases(corpus), for each case
  //   build prompt -> backend.complete -> post-process -> scoreCase,
  //   then aggregate() and print the EvalReport as JSON.
  notImplemented('eval CLI');
}

main(process.argv.slice(2));

import * as vscode from 'vscode';
import { defaultConfigForProfile, type Profile, type ResolvedConfig } from '@inkling/core';

/**
 * Config adapter (ADR-0006): maps VS Code settings onto a `ResolvedConfig`.
 * This is one of only two places that PRODUCE a ResolvedConfig (the other is
 * eval). Adding a setting means reading one more field here.
 */
export function resolveConfigFromVsCode(): ResolvedConfig {
  const cfg = vscode.workspace.getConfiguration('inkling');
  const profile = cfg.get<Profile>('profile', 'fast');
  const base = defaultConfigForProfile(profile);

  return {
    ...base,
    enabled: cfg.get<boolean>('enabled', base.enabled),
    endpoint: cfg.get<string>('endpoint', base.endpoint),
    model: cfg.get<string>('model', base.model),
    debounceMs: cfg.get<number>('debounceMs', base.debounceMs),
    temperature: cfg.get<number>('temperature', base.temperature),
  };
}

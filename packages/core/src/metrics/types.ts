/**
 * Local-only metric event types (privacy: never transmitted). Used by the
 * extension to record latency/acceptance and by eval to report quality.
 */

export interface LatencySample {
  readonly requestedAt: number;
  readonly firstTokenMs?: number;
  readonly totalMs: number;
}

export interface CompletionEvent {
  readonly id: string;
  readonly languageId: string;
  readonly model: string;
  readonly latency: LatencySample;
  readonly shown: boolean;
  readonly accepted?: boolean;
}

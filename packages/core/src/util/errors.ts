/** Thrown by stubbed seams that are defined but not yet implemented. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented: ${what}`);
    this.name = 'NotImplementedError';
  }
}

/** Convenience for marking a stubbed implementation. */
export function notImplemented(what: string): never {
  throw new NotImplementedError(what);
}

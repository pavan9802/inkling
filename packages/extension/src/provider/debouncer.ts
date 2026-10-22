import * as vscode from 'vscode';

/**
 * Bridges VS Code's `CancellationToken` to the Fetch API's `AbortSignal` and
 * debounces rapid keystroke bursts into one backend request at a time.
 *
 * On each call to `debounce()` the in-flight request from the previous call is
 * aborted at the HTTP layer — preventing connection pile-ups on fast typists.
 */
export class Debouncer {
  // One controller per in-flight request. Replaced on every debounce() call.
  private controller: AbortController | undefined;

  /**
   * Abort the previous request, start a new `AbortController`, bridge the VS
   * Code cancellation token, then wait `debounceMs` before resolving with the
   * live signal. Rejects with an `AbortError` if cancelled during the wait.
   */
  debounce(debounceMs: number, token: vscode.CancellationToken): Promise<AbortSignal> {
    // Aborting the old controller cancels the previous fetch() at the network
    // layer — not just the JS promise. Without this, a burst of 10 keystrokes
    // would fire 10 concurrent HTTP connections to Ollama.
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    return new Promise<AbortSignal>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        disposable.dispose();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      // Two cancellation sources: VS Code moving the cursor (token) and the
      // next debounce() call replacing the controller (signal).
      const disposable = token.onCancellationRequested(abort);
      controller.signal.addEventListener('abort', abort, { once: true });

      const timer = setTimeout(() => {
        // Clean up listeners before resolving so they don't fire afterwards.
        disposable.dispose();
        controller.signal.removeEventListener('abort', abort);
        if (controller.signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
        } else {
          resolve(controller.signal);
        }
      }, debounceMs);
    });
  }

  dispose(): void {
    this.controller?.abort();
  }
}

import { AsyncLocalStorage } from "node:async_hooks";

const signals = new AsyncLocalStorage<AbortSignal>();

export class SyncCancelledError extends Error {
  constructor() { super("用户已取消同步"); this.name = "SyncCancelledError"; }
}

export const currentSyncSignal = () => signals.getStore();
export function throwIfSyncCancelled() { currentSyncSignal()?.throwIfAborted(); }
export function withSyncSignal<T>(signal: AbortSignal, fn: () => T): T { return signals.run(signal, fn); }
// Only the owning request may abort its I/O in Workers. Other requests set the
// D1 flag; the owning request polls it and aborts its own controller.
export function createSyncControl(isRequested: () => Promise<boolean>, pollMs = 500) {
  const controller = new AbortController();
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  async function poll() {
    try { if (await isRequested()) controller.abort(new SyncCancelledError()); }
    catch { /* Retry transient database read errors on the next poll. */ }
    if (!closed && !controller.signal.aborted) timer = setTimeout(poll, pollMs);
  }
  timer = setTimeout(poll, pollMs);
  return { signal: controller.signal, cancel() { controller.abort(new SyncCancelledError()); }, close() {
    closed = true; clearTimeout(timer);
  } };
}

export function syncDelay(ms: number): Promise<void> {
  const signal = currentSyncSignal();
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

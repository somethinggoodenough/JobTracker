export class DeadlineError extends Error {
  constructor(public label: string, public ms: number) {
    super(`${label}超过 ${ms / 1000} 秒`);
    this.name = "DeadlineError";
  }
}

export async function withDeadline<T>(
  label: string, ms: number, parent: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  let onAbort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  parent?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DeadlineError(label, ms)), ms);
  const operation = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return fn(controller.signal);
  });
  void operation.catch(() => {});
  try {
    const result = await Promise.race([operation, stopped]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
    parent?.removeEventListener("abort", onParentAbort);
  }
}

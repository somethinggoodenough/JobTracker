export async function probe(kind, ms, upstream) {
  const started = Date.now();
  const controller = new AbortController();
  let timer;
  try {
    if (kind === "D") void fetch(upstream + "/second", { signal: controller.signal }).catch(() => {});
    if (kind === "E") {
      await Promise.race([
        fetch(upstream, { signal: controller.signal }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error("explicit deadline");
            error.name = "DeadlineError";
            reject(error);
          }, ms);
        }),
      ]);
    } else {
      const signal = kind === "A" ? AbortSignal.timeout(ms) : kind === "C" ? controller.signal
        : AbortSignal.any([controller.signal, AbortSignal.timeout(ms)]);
      if (kind === "C") timer = setTimeout(() => controller.abort(), ms);
      await fetch(upstream, { signal });
    }
    return { elapsedMs: Date.now() - started, error: null, rejected: false };
  } catch (error) {
    return { elapsedMs: Date.now() - started, error: error?.name ?? String(error), rejected: true };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

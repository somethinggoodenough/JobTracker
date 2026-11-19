import { waitUntil } from "cloudflare:workers";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(request?: Request) {
  // Send JSON whitespace heartbeats so a large crawl does not hit a client's
  // five-minute response-header/idle timeout. response.json() remains compatible.
  const encoder = new TextEncoder();
  const owner = new AbortController();
  const incoming = request?.signal;
  let cancelled = false;
  let finished = false;
  let timer: ReturnType<typeof setInterval>;
  function disconnect() {
    if (finished || cancelled) return;
    cancelled = true;
    clearInterval(timer);
    owner.abort(new Error("同步连接已断开，剩余候选已保留"));
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: string) => {
        if (!cancelled) {
          try { controller.enqueue(encoder.encode(value)); }
          catch { disconnect(); }
        }
      };
      send("\n");
      incoming?.addEventListener("abort", disconnect, { once: true });
      if (incoming?.aborted) disconnect();
      if (!cancelled) timer = setInterval(() => send("\n"), 15000);
      const completion = runSync({ reviewOnly: !!request && new URL(request.url).searchParams.get("reviewOnly") === "1",
        signal: owner.signal }).then(result => {
        send(JSON.stringify(result));
      }).catch(error => {
        send(JSON.stringify({ error: error instanceof Error ? error.message : "同步失败" }));
      }).finally(() => {
        finished = true;
        clearInterval(timer);
        incoming?.removeEventListener("abort", disconnect);
        if (!cancelled) controller.close();
      });
      waitUntil(completion);
    },
    cancel: disconnect,
  });
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-transform", "Content-Encoding": "identity", "X-Accel-Buffering": "no" } });
}

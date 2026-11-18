import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(request?: Request) {
  // Send JSON whitespace heartbeats so a large crawl does not hit a client's
  // five-minute response-header/idle timeout. response.json() remains compatible.
  const encoder = new TextEncoder();
  let cancelled = false;
  let timer: ReturnType<typeof setInterval>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("\n"));
      timer = setInterval(() => { if (!cancelled) controller.enqueue(encoder.encode("\n")); }, 15000);
      runSync({ reviewOnly: !!request && new URL(request.url).searchParams.get("reviewOnly") === "1" }).then(result => {
        if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(result)));
      }).catch(error => {
        if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify({ error: error instanceof Error ? error.message : "同步失败" })));
      }).finally(() => { clearInterval(timer); if (!cancelled) controller.close(); });
    },
    cancel() { cancelled = true; clearInterval(timer); },
  });
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-transform", "Content-Encoding": "identity", "X-Accel-Buffering": "no" } });
}

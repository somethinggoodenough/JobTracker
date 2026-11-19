import { probe } from "./probe.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    const kind = url.searchParams.get("case");
    const ms = Number(url.searchParams.get("ms"));
    if (!["A", "B", "C", "D", "E"].includes(kind) || !Number.isInteger(ms) || ms < 1 || ms > 200_000) return new Response(null, { status: 400 });
    return Response.json(await probe(kind, ms, "http://127.0.0.1:" + env.FIXTURE_PORT));
  },
};

import { getD1 } from "@/lib/database";
import { plannerAiAvailability, plannerAiDraft } from "@/lib/planner-ai";
import { boundedInteger, plannerDate, PlannerError } from "@/lib/planner-rules";
import { deletePlannerRow, listPlannerRows, plannerCollection, plannerId, plannerObject, plannerSettings,
  putPlannerSettings, reorderPlannerTasks, reviewPlannerCard, savePlannerRow } from "@/lib/planner-store";
import { createSkillProject, fillPendingInterviews, plannerToday, plannerWeeklyReview, savePlannerReview, updatePlannerDay } from "@/lib/planner-workflow";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function handle(request: Request, context: Context) {
  try {
    const path = (await context.params).path;
    const [key, rawId, sub] = path;
    const method = request.method;
    const query = new URL(request.url).searchParams;
    const db = getD1();
    const input = ["POST", "PATCH"].includes(method) ? plannerObject(await request.json()) : {};
    if (path.length === 1) {
      if (key === "today" && method === "GET") return reply(await plannerToday(db,
        query.has("minutes") ? boundedInteger(Number(query.get("minutes")), 1, 1440) : null));
      if (key === "day" && method === "POST") return reply(await updatePlannerDay(db, input));
      if (key === "ai") {
        if (method === "GET") return reply(await plannerAiAvailability(db));
        if (method === "POST") return reply(await plannerAiDraft(db, input, request.signal));
      }
      if (key === "skills" && method === "POST") return reply(await createSkillProject(db, input.skill), 201);
      if (key === "settings") {
        if (method === "GET") return reply(await plannerSettings(db));
        if (method === "PATCH") return reply(await putPlannerSettings(db, input));
      }
      if (key === "review") {
        const week = plannerDate(query.get("week"));
        if (method === "GET") return reply(await plannerWeeklyReview(db, week));
        if (method === "POST") return reply(await savePlannerReview(db, input, week));
      }
    }
    if (key === "tasks" && rawId === "reorder" && path.length === 2 && method === "POST") return reply(await reorderPlannerTasks(db, input));
    const collection = plannerCollection(key);
    if (collection && path.length === 1) {
      if (method === "GET") return reply(await listPlannerRows(db, collection, query));
      if (method === "POST") {
        const row = await savePlannerRow(db, collection, input);
        if (collection === "projects" && input.title === "求职" && (!input.kind || input.kind === "project")) await fillPendingInterviews(db);
        return reply(row, 201);
      }
    }
    if (collection && rawId && /^\d+$/.test(rawId)) {
      const id = plannerId(Number(rawId))!;
      if (path.length === 2 && method === "PATCH") {
        const row = await savePlannerRow(db, collection, input, id);
        if (collection === "projects" && input.title === "求职") await fillPendingInterviews(db);
        return reply(row);
      }
      if (path.length === 2 && method === "DELETE") return reply(await deletePlannerRow(db, collection, id, Number(query.get("version"))));
      if (collection === "cards" && path.length === 3 && sub === "review" && method === "POST") return reply(await reviewPlannerCard(db, id, input));
    }
    return reply({ error: "记录不存在" }, 404);
  } catch (error) {
    if (error instanceof PlannerError) return reply({ error: error.message, ...error.details }, error.status);
    if (error instanceof SyntaxError) return reply({ error: "请求格式无效" }, 400);
    console.error("Planner request failed", error);
    return reply({ error: "计划操作失败，请重试" }, 500);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

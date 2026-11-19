import { normalizeTechnologies } from "./tech-aliases";
import { assertBlock, boundedInteger, cardReview, pick, plannerCardResults, plannerCauses, plannerDate, plannerDay, plannerEntryKinds,
  PlannerError, plannerProjectKinds, plannerProjectStates, plannerTaskStates, plannerText,
  type Card, type Entry, type Goal, type Metric, type Milestone, type PlannerCollection, type PlannerSettings, type PlannerState, type Project, type Task } from "./planner-rules";

const tables = { goals: "planner_goals", projects: "planner_projects", milestones: "planner_milestones", tasks: "planner_tasks",
  entries: "planner_entries", cards: "planner_cards" } as const;
type Value = string | number | null;
type Row = Record<string, Value> & { id: number; version: number };
type Input = Record<string, unknown>;
type SettingsField = "max_active_projects" | "max_doing_tasks";
const wip = { projects: { limit: "max_active_projects", live: "active", replace: "paused" },
  tasks: { limit: "max_doing_tasks", live: "doing", replace: "next" } } as const;

export function plannerObject(value: unknown): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlannerError("请求格式无效");
  return value as Input;
}
export const plannerId = (value: unknown, optional = false) => boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, optional);
export const plannerCollection = (kind: string) => Object.hasOwn(tables, kind) ? kind as PlannerCollection : null;

export async function plannerSettings(db: D1Database) {
  await db.prepare("INSERT OR IGNORE INTO planner_settings(id,updated_at) VALUES(1,?1)").bind(new Date().toISOString()).run();
  return (await db.prepare("SELECT max_active_projects,max_doing_tasks,version FROM planner_settings WHERE id=1").first<PlannerSettings>())!;
}
export async function putPlannerSettings(db: D1Database, input: Input, now = new Date()) {
  const current = await plannerSettings(db);
  const version = plannerId(input.version);
  const maxActive = input.max_active_projects === undefined ? current.max_active_projects : boundedInteger(input.max_active_projects, 1, 10, true);
  const maxDoing = input.max_doing_tasks === undefined ? current.max_doing_tasks : boundedInteger(input.max_doing_tasks, 1, 10, true);
  if (input.max_active_projects === "" || input.max_doing_tasks === "") throw new PlannerError("上限必须为 1–10 或不限");
  const row = await db.prepare(`UPDATE planner_settings SET max_active_projects=?1,max_doing_tasks=?2,updated_at=?3,version=version+1
    WHERE id=1 AND version=?4 RETURNING max_active_projects,max_doing_tasks,version`)
    .bind(maxActive, maxDoing, now.toISOString(), version).first<PlannerSettings>();
  if (!row) throw new PlannerError("记录已更新，请刷新后重试", 409);
  return row;
}

function parseMetric(raw: unknown): Metric | null {
  if (typeof raw === "string" && raw) { try { raw = JSON.parse(raw); } catch { throw new PlannerError("数据记录格式无效"); } }
  if (raw == null || raw === "") return null;
  const { name, after, before, unit } = plannerObject(raw);
  if (typeof after !== "number" || !Number.isFinite(after) || before !== undefined && before !== null &&
    (typeof before !== "number" || !Number.isFinite(before))) throw new PlannerError("数据记录格式无效");
  return { name: plannerText(name, 120, true), after, ...(typeof before === "number" ? { before } : {}), unit: plannerText(unit, 40) };
}
function strings(raw: unknown, max: number, length: number) {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { throw new PlannerError("列表格式无效"); } }
  if (!Array.isArray(raw) || raw.length > max) throw new PlannerError("列表格式无效");
  return [...new Set(raw.map(item => plannerText(item, length, true)))];
}
export function decodePlannerEntry(row: Row): Entry {
  return { ...row, links: JSON.parse(String(row.links)), skills: JSON.parse(String(row.skills)), metric: row.metric ? JSON.parse(String(row.metric)) : null } as Entry;
}
async function rowAt(db: D1Database, kind: PlannerCollection, id: number) {
  const row = await db.prepare(`SELECT * FROM ${tables[kind]} WHERE id=?1`).bind(id).first<Row>();
  if (!row) throw new PlannerError("记录不存在", 404);
  return row;
}
async function nextPosition(db: D1Database, kind: "tasks" | "milestones", projectId: number) {
  const row = await db.prepare(`SELECT COALESCE(MAX(position),-1)+1 AS position FROM ${tables[kind]} WHERE project_id=?1`).bind(projectId).first<{ position: number }>();
  return row?.position ?? 0;
}
async function fields(db: D1Database, kind: PlannerCollection, input: Input, old: Row | null, now: Date): Promise<Record<string, Value>> {
  const value = { ...old, ...input };
  const stamp = now.toISOString();
  const title = () => plannerText(value.title, 180, true);
  const ref = async (collection: PlannerCollection, raw: unknown, optional = false) => {
    const id = plannerId(raw, optional);
    return id === null ? null : await rowAt(db, collection, id);
  };
  switch (kind) {
    case "goals": return { title: title(), why: plannerText(value.why, 4000),
      priority: boundedInteger(value.priority ?? 2, 1, 3), weekly_target_minutes: boundedInteger(value.weekly_target_minutes, 1, 10_080, true),
      status: pick(value.status ?? "active", ["active", "archived"]) };
    case "projects": return { goal_id: (await ref("goals", value.goal_id, true))?.id ?? null, title: title(),
      kind: pick(value.kind ?? "project", plannerProjectKinds), description: plannerText(value.description, 8000),
      repo_path: plannerText(value.repo_path, 1000) || null, status: pick(value.status ?? "active", plannerProjectStates),
      last_activity_at: old?.last_activity_at ?? stamp };
    case "milestones": {
      const project_id = (await ref("projects", value.project_id))!.id;
      if (old && old.project_id !== project_id) throw new PlannerError("里程碑所属项目不能更改");
      const status = pick(value.status ?? "open", ["open", "done", "dropped"]);
      return { project_id, title: title(), done_criteria: plannerText(value.done_criteria, 4000), target_on: plannerDate(value.target_on),
        position: boundedInteger(value.position ?? await nextPosition(db, kind, project_id), 0, 1_000_000), status,
        done_at: status === "done" ? old?.done_at ?? stamp : null };
    }
    case "tasks": {
      const project_id = (await ref("projects", value.project_id))!.id;
      if (old && old.project_id !== project_id) throw new PlannerError("任务所属项目不能更改");
      const milestone = await ref("milestones", value.milestone_id, true);
      if (milestone && project_id !== milestone.project_id) throw new PlannerError("里程碑与项目不匹配");
      const status = pick(value.status ?? "next", plannerTaskStates);
      const reason = status === "blocked" ? plannerText(value.blocked_reason, 1000) || null : null;
      const checkBack = status === "blocked" ? plannerDate(value.check_back_on) : null;
      if (status === "blocked") assertBlock(reason, checkBack);
      return { project_id, milestone_id: milestone?.id ?? null, title: title(), notes: plannerText(value.notes, 8000),
        status, due_on: plannerDate(value.due_on), estimate_minutes: boundedInteger(value.estimate_minutes, 1, 10_080, true),
        actual_minutes: boundedInteger(value.actual_minutes, 0, 10_080, true),
        blocked_reason: reason, check_back_on: checkBack, delay_reason: pick(value.delay_reason, plannerCauses, true),
        unblocked_at: old?.status === "blocked" && status !== "blocked" ? stamp : old?.unblocked_at ?? null,
        position: boundedInteger(value.position ?? await nextPosition(db, kind, project_id), 0, 1_000_000),
        started_at: old?.started_at ?? (status === "doing" ? stamp : null),
        done_at: status === "done" ? old?.done_at ?? stamp : null };
    }
    case "entries": {
      const task = await ref("tasks", value.task_id, true);
      const project = await ref("projects", value.project_id ?? task?.project_id, true);
      if (task && project?.id !== task.project_id) throw new PlannerError("任务与项目不匹配");
      const entryKind = pick(value.kind ?? "progress", plannerEntryKinds);
      const links = strings(value.links ?? [], 16, 2000);
      if (links.some(link => !URL.canParse(link) || !["http:", "https:"].includes(new URL(link).protocol))) throw new PlannerError("只接受 HTTP 或 HTTPS 链接");
      if (entryKind === "artifact" && !links.length) throw new PlannerError("产出记录需要至少一个链接");
      const metric = parseMetric(value.metric);
      if (value.resume_candidate !== undefined && ![0, 1, true, false].includes(value.resume_candidate as number)) throw new PlannerError("选项无效");
      return { project_id: project?.id ?? null, task_id: task?.id ?? null, kind: entryKind,
        body: plannerText(value.body, 8000, true), links: JSON.stringify(links),
        skills: JSON.stringify(normalizeTechnologies(strings(value.skills ?? [], 32, 80))),
        metric: metric ? JSON.stringify(metric) : null, cause: pick(value.cause, plannerCauses, true), resume_candidate: value.resume_candidate ? 1 : 0 };
    }
    case "cards": {
      const entry = await ref("entries", value.entry_id, true);
      const project = await ref("projects", value.project_id ?? entry?.project_id);
      if (entry && (entry.kind !== "insight" || entry.project_id !== project?.id)) throw new PlannerError("请选择同一项目下的理解记录");
      return { project_id: project!.id, entry_id: entry?.id ?? null,
        question: plannerText(value.question, 800, true), answer: plannerText(value.answer ?? entry?.body, 8000, true),
        interval_days: old?.interval_days ?? 1, due_on: old?.due_on ?? plannerDay(now) };
    }
  }
}

function taskCompletion(db: D1Database, input: Input, projectId: number, stamp: string, target: string, binds: Value[]) {
  if (input.completion === undefined) return [];
  const completion = plannerObject(input.completion);
  const records = [
    { kind: "insight", body: plannerText(completion.insight, 8000), metric: null },
    { kind: "metric", body: plannerText(completion.metric_body, 8000), metric: parseMetric(completion.metric) },
    { kind: "mistake", body: plannerText(completion.mistake, 8000), metric: null },
  ];
  return records.filter(record => record.body || record.metric).map(record =>
    db.prepare(`INSERT INTO planner_entries(project_id,task_id,kind,body,metric,cause,created_at,updated_at)
      SELECT ?,id,?,?,?,?,?,? FROM planner_tasks WHERE ${target}`)
      .bind(projectId, record.kind, record.body || record.metric?.name || "", record.metric ? JSON.stringify(record.metric) : null,
        record.kind === "mistake" ? pick(completion.cause, plannerCauses, true) : null, stamp, stamp, ...binds));
}

export async function savePlannerRow(db: D1Database, kind: PlannerCollection, input: Input, id?: number, now = new Date()) {
  const table = tables[kind], stamp = now.toISOString();
  const old = id === undefined ? null : await rowAt(db, kind, id);
  const version = old ? plannerId(input.version) : 0;
  if (old && old.version !== version) throw new PlannerError("记录已更新，请刷新后重试", 409);
  const data = await fields(db, kind, input, old, now);
  const config = kind === "projects" || kind === "tasks" ? wip[kind] : null;
  const entering = config && data.status === config.live && old?.status !== config.live;
  const resolution = input.resolution == null ? null : plannerObject(input.resolution);
  const replaceId = entering && resolution?.action === "replace" ? plannerId(resolution.id) : null;
  const increase = entering && resolution?.action === "increase";
  const binds: Value[] = [];
  let guard = "1";
  if (entering && config) {
    await plannerSettings(db);
    const live = `(SELECT COUNT(*) FROM ${table} WHERE status='${config.live}')`;
    const limit = `(SELECT ${config.limit} FROM planner_settings WHERE id=1)`;
    if (replaceId) {
      guard = `EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='${config.live}') AND (${limit} IS NULL OR ${live}<=${limit})`;
      binds.push(replaceId);
    } else if (increase) guard = `(${limit}<10 AND ${live}<=${limit})`;
    else guard = `(${limit} IS NULL OR ${live}<${limit})`;
  }
  const columns = [...Object.keys(data), "updated_at", ...(!old ? ["created_at"] : [])];
  const values: Value[] = [...Object.values(data), stamp, ...(!old ? [stamp] : [])];
  const saved = old
    ? db.prepare(`UPDATE ${table} SET ${columns.map(column => `${column}=?`).join(",")},version=version+1 WHERE id=? AND version=? AND ${guard} RETURNING *`)
      .bind(...values, old.id, version, ...binds)
    : db.prepare(`INSERT INTO ${table}(${columns.join(",")}) SELECT ${values.map(() => "?").join(",")} WHERE ${guard} RETURNING *`)
      .bind(...values, ...binds);
  const writeGuard = old ? "id=? AND version=? AND updated_at=?" : "id=last_insert_rowid() AND updated_at=?";
  const writeBinds: Value[] = old ? [old.id, old.version + 1, stamp] : [stamp];
  const exists = `EXISTS(SELECT 1 FROM ${table} WHERE ${writeGuard})`;
  const sideEffects: D1PreparedStatement[] = [];
  if (entering && config && replaceId) {
    sideEffects.push(db.prepare(`UPDATE ${table} SET status=?,updated_at=?,version=version+1 WHERE id=? AND changes()>0 AND ${exists}`)
      .bind(config.replace, stamp, replaceId, ...writeBinds));
    if (kind === "tasks") sideEffects.push(db.prepare(`UPDATE planner_projects SET last_activity_at=? WHERE id=
      (SELECT project_id FROM planner_tasks WHERE id=?) AND changes()>0`).bind(stamp, replaceId));
  }
  if (entering && config && increase) sideEffects.push(db.prepare(`UPDATE planner_settings SET ${config.limit}=${config.limit}+1,version=version+1,updated_at=?
    WHERE id=1 AND changes()>0 AND ${exists}`).bind(stamp, ...writeBinds));
  if (data.project_id && (kind === "cards" || kind === "entries" && !old || kind === "tasks" && data.status !== old?.status)) {
    sideEffects.push(db.prepare(`UPDATE planner_projects SET last_activity_at=? WHERE id=? AND ${exists}`).bind(stamp, data.project_id, ...writeBinds));
  }
  if (kind === "tasks" && data.status === "done" && old?.status !== "done") {
    if (!old && input.completion) throw new PlannerError("请先创建任务再保存完成记录");
    sideEffects.push(...taskCompletion(db, input, data.project_id as number, stamp, writeGuard, writeBinds));
  }
  const [result] = await db.batch<Row>([saved, ...sideEffects]);
  const row = result.results[0];
  if (!row) {
    if (old && (await rowAt(db, kind, old.id)).version !== old.version) throw new PlannerError("记录已更新，请刷新后重试", 409);
    if (entering && config) {
      const settings = await plannerSettings(db);
      const count = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE status=?1`).bind(config.live).first<{ count: number }>();
      throw new PlannerError("已达到进行中上限", 409, { limit: config.limit as SettingsField, count: count?.count ?? 0, max: settings[config.limit] ?? 10 });
    }
    throw new PlannerError("记录已更新，请刷新后重试", 409);
  }
  return kind === "entries" ? decodePlannerEntry(row) : row;
}

export async function deletePlannerRow(db: D1Database, kind: PlannerCollection, id: number, version: unknown) {
  await rowAt(db, kind, id);
  const deleted = await db.prepare(`DELETE FROM ${tables[kind]} WHERE id=?1 AND version=?2`).bind(id, plannerId(version)).run();
  if (!deleted.meta.changes) throw new PlannerError("记录已更新，请刷新后重试", 409);
  return { ok: true };
}

export async function listPlannerRows(db: D1Database, kind: PlannerCollection, query = new URLSearchParams(), now = new Date()) {
  const conditions: string[] = [];
  const binds: Value[] = [];
  if (["tasks", "milestones", "entries", "cards"].includes(kind) && query.get("project")) {
    conditions.push("project_id=?"); binds.push(plannerId(Number(query.get("project"))));
  }
  if (kind === "entries" && query.get("kind")) { conditions.push("kind=?"); binds.push(pick(query.get("kind"), plannerEntryKinds)); }
  if (kind === "entries" && query.get("skill")) {
    const skill = normalizeTechnologies([plannerText(query.get("skill"), 80, true)])[0];
    conditions.push("EXISTS(SELECT 1 FROM json_each(skills) WHERE value=?)"); binds.push(skill);
  }
  if (kind === "entries" && query.get("resume") === "1") conditions.push("resume_candidate=1");
  if (kind === "cards" && query.get("due") === "today") { conditions.push("due_on<=?"); binds.push(plannerDay(now)); }
  const order = ["tasks", "milestones"].includes(kind) ? "position,id" : kind === "cards" ? "due_on,id" : "created_at DESC,id DESC";
  const rows = await db.prepare(`SELECT * FROM ${tables[kind]}${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY ${order}`).bind(...binds).all<Row>();
  return kind === "entries" ? rows.results.map(decodePlannerEntry) : rows.results;
}

export async function readPlannerState(db: D1Database): Promise<PlannerState> {
  const [goals, projects, milestones, tasks, cards] = await Promise.all(
    (["goals", "projects", "milestones", "tasks", "cards"] as const).map(kind => listPlannerRows(db, kind)));
  return { goals: goals as unknown as Goal[], projects: projects as unknown as Project[], milestones: milestones as unknown as Milestone[],
    tasks: tasks as unknown as Task[], cards: cards as unknown as Card[] };
}

export async function reviewPlannerCard(db: D1Database, id: number, input: Input, now = new Date()) {
  const old = await rowAt(db, "cards", id);
  const version = input.version === undefined ? old.version : plannerId(input.version);
  const versionOk = old.version === version;
  if (!versionOk) throw new PlannerError("记录已更新，请刷新后重试", 409);
  const result = cardReview(Number(old.interval_days), pick(input.result, plannerCardResults)!, now);
  const stamp = now.toISOString();
  const [saved] = await db.batch([
    db.prepare("UPDATE planner_cards SET interval_days=?,due_on=?,last_result=?,version=version+1,updated_at=? WHERE id=? AND version=? RETURNING *")
      .bind(result.interval_days, result.due_on, result.last_result, stamp, id, version),
    db.prepare("UPDATE planner_projects SET last_activity_at=? WHERE id=? AND changes()>0").bind(stamp, old.project_id),
  ]);
  if (!saved.results.length) throw new PlannerError("记录已更新，请刷新后重试", 409);
  return saved.results[0];
}

export async function reorderPlannerTasks(db: D1Database, input: Input, now = new Date()) {
  const from = plannerId(input.from)!, to = plannerId(input.to)!;
  if (from === to) return { ok: true };
  const a = await rowAt(db, "tasks", from), b = await rowAt(db, "tasks", to);
  if (a.project_id !== b.project_id || a.milestone_id !== b.milestone_id) throw new PlannerError("只能在同一里程碑内调整顺序");
  const fromVersion = plannerId(input.from_version), toVersion = plannerId(input.to_version);
  const result = await db.prepare(`WITH guard AS MATERIALIZED (
      SELECT COUNT(*) AS matched FROM planner_tasks WHERE (id=?1 AND version=?3) OR (id=?2 AND version=?4)
    ) UPDATE planner_tasks SET position=CASE WHEN id=?1 THEN ?6 ELSE ?5 END,version=version+1,updated_at=?7
    WHERE id IN (?1,?2) AND (SELECT matched FROM guard)=2`).bind(from, to, fromVersion, toVersion, a.position, b.position, now.toISOString()).run();
  if (!result.meta.changes) throw new PlannerError("记录已更新，请刷新后重试", 409);
  return { ok: true };
}

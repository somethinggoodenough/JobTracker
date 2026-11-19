import { shiftCalendarDate } from "./crawl-window";
import { rankToday, SELECT_FOCUS_LIMIT } from "./planner-rank";
import { assertBlock, boundedInteger, pick, PLANNER_DEFAULT_MINUTES, plannerCauses, plannerDate, plannerDay, PlannerError, plannerText, plannerWeek, type Entry } from "./planner-rules";
import { listPlannerRows, plannerId, plannerObject, plannerSettings, readPlannerState } from "./planner-store";

type Day = { day: string; available_minutes: number | null; focus_task_ids: string; started_at: string | null; closed_at: string | null; note: string };
type CloseChoice = { id: number; action: "continue" | "backlog" | "blocked"; reason: string | null; date: string | null };
const unchanged = "记录已更新，请刷新后重试";
const focusIds = (day: Day) => JSON.parse(day.focus_task_ids) as number[];
const decodeDay = (day: Day | null) => day && { ...day, focus_task_ids: focusIds(day) };

async function closeDay(db: D1Database, day: Day, choices: CloseChoice[], note: string, now: Date) {
  const stamp = now.toISOString();
  const unfinished = JSON.stringify(choices);
  const result = await db.batch([
    db.prepare("UPDATE planner_days SET closed_at=?2,note=?3 WHERE day=?1 AND closed_at IS NULL").bind(day.day, stamp, note),
    db.prepare(`WITH choices AS MATERIALIZED (
      SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.action') AS action,
        json_extract(value,'$.reason') AS reason,json_extract(value,'$.date') AS date FROM json_each(?1)
    ) UPDATE planner_tasks AS t SET
      status=CASE action WHEN 'backlog' THEN 'next' WHEN 'blocked' THEN 'blocked' ELSE t.status END,
      blocked_reason=CASE action WHEN 'blocked' THEN reason WHEN 'backlog' THEN NULL ELSE t.blocked_reason END,
      check_back_on=CASE action WHEN 'blocked' THEN date WHEN 'backlog' THEN NULL ELSE t.check_back_on END,
      unblocked_at=CASE WHEN action='backlog' AND t.status='blocked' THEN ?2 ELSE t.unblocked_at END,
      rollover_count=t.rollover_count+(action='continue'),updated_at=?2,version=t.version+1
      FROM choices WHERE t.id=choices.id AND t.status NOT IN ('done','dropped') AND changes()>0`).bind(unfinished, stamp),
    db.prepare(`UPDATE planner_projects SET last_activity_at=?1 WHERE changes()>0 AND id IN (
      SELECT project_id FROM planner_tasks WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?2)
        WHERE json_extract(value,'$.action')<>'continue') AND updated_at=?1)`).bind(stamp, unfinished),
  ]);
  return !!result[0].meta.changes;
}
export async function rolloverPlannerDays(db: D1Database, now = new Date()) {
  const { results } = await db.prepare("SELECT * FROM planner_days WHERE day<?1 AND started_at IS NOT NULL AND closed_at IS NULL ORDER BY day")
    .bind(plannerDay(now)).all<Day>();
  for (const day of results) await closeDay(db, day, focusIds(day).filter(id => id > 0)
    .map(id => ({ id, action: "continue", reason: null, date: null })), day.note, now);
}
export async function plannerToday(db: D1Database, minutes?: number | null, now = new Date()) {
  const today = plannerDay(now);
  await rolloverPlannerDays(db, now);
  const [state, day, settings, waiting, review] = await Promise.all([
    readPlannerState(db), db.prepare("SELECT * FROM planner_days WHERE day=?1").bind(today).first<Day>(),
    plannerSettings(db), db.prepare(`SELECT COUNT(*) count FROM applications WHERE status='interview'
      AND NOT EXISTS (SELECT 1 FROM planner_projects WHERE kind='project' AND title='求职')`).first<{ count: number }>(),
    db.prepare("SELECT completed_at FROM planner_reviews WHERE week=?1").bind(plannerWeek(today)).first<{ completed_at: string }>(),
  ]);
  const available = minutes ?? day?.available_minutes ?? PLANNER_DEFAULT_MINUTES;
  const ranked = rankToday(state, today, available);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return { ...ranked, state, today, available, settings, day: decodeDay(day), week: plannerWeek(today),
    remindReview: (weekday >= 5 || weekday === 0) && !review?.completed_at, pendingInterviews: waiting?.count ?? 0 };
}

export async function updatePlannerDay(db: D1Database, input: Record<string, unknown>, now = new Date()) {
  const action = pick(input.action, ["start", "close"]);
  const day = plannerDay(now);
  await rolloverPlannerDays(db, now);
  const stored = await db.prepare("SELECT * FROM planner_days WHERE day=?1").bind(day).first<Day>();
  const stamp = now.toISOString();
  if (action === "start") {
    if (stored?.started_at) throw new PlannerError("今天的计划已经开始", 409);
    const minutes = boundedInteger(input.available_minutes ?? PLANNER_DEFAULT_MINUTES, 1, 1440)!;
    const ranked = rankToday(await readPlannerState(db), day, minutes);
    const ids = input.focus_task_ids ?? ranked.focus.map(item => item.id);
    if (!Array.isArray(ids) || ids.length > SELECT_FOCUS_LIMIT || new Set(ids).size !== ids.length) throw new PlannerError("最多选择三项焦点");
    const picked = ids.map(id => ranked.candidates.find(candidate => candidate.id === id));
    if (picked.some(item => !item)) throw new PlannerError("焦点任务已变化，请刷新后再选");
    if (picked.some(item => picked.filter(candidate => candidate?.project_id === item?.project_id).length > 2)) throw new PlannerError("同一项目最多设置两个焦点");
    const row = await db.prepare(`INSERT INTO planner_days(day,available_minutes,focus_task_ids,started_at) VALUES(?1,?2,?3,?4)
      ON CONFLICT(day) DO UPDATE SET available_minutes=excluded.available_minutes,focus_task_ids=excluded.focus_task_ids,started_at=excluded.started_at
      WHERE planner_days.started_at IS NULL RETURNING *`).bind(day, minutes, JSON.stringify(ids), stamp).first<Day>();
    if (!row) throw new PlannerError(unchanged, 409);
    return decodeDay(row);
  }
  if (!stored?.started_at || stored.closed_at) throw new PlannerError("今天的计划未开始或已结束", 409);
  const rawChoices = input.tasks ?? [];
  if (!Array.isArray(rawChoices) || rawChoices.length > SELECT_FOCUS_LIMIT) throw new PlannerError("焦点任务格式无效");
  const allowed = focusIds(stored).filter(id => id > 0);
  const choices = new Map<number, CloseChoice>(allowed.map(id => [id, { id, action: "continue", reason: null, date: null }]));
  for (const raw of rawChoices) {
    const record = plannerObject(raw), id = plannerId(record.id)!;
    if (!choices.has(id)) throw new PlannerError("任务不在当天焦点里");
    const action = pick(record.action, ["continue", "backlog", "blocked"])!;
    const reason = action === "blocked" ? plannerText(record.blocked_reason, 1000) : null;
    const date = action === "blocked" ? plannerDate(record.check_back_on) : null;
    if (action === "blocked") assertBlock(reason, date);
    choices.set(id, { id, action, reason, date });
  }
  const note = plannerText(input.note, 2000);
  if (!await closeDay(db, stored, [...choices.values()], note, now)) throw new PlannerError(unchanged, 409);
  return decodeDay({ ...stored, note, closed_at: stamp });
}

const causeCounts = () => Object.fromEntries(plannerCauses.map(key => [key, 0])) as Record<typeof plannerCauses[number], number>;
const dayOf = (stamp: string) => plannerDay(new Date(stamp));
export async function plannerWeeklyReview(db: D1Database, week?: string | null, now = new Date()) {
  const today = plannerDay(now);
  const selected = week ?? plannerWeek(today);
  if (plannerWeek(selected) !== selected) throw new PlannerError("请选择周一");
  const end = shiftCalendarDate(selected, 7), start = shiftCalendarDate(selected, -21);
  const [state, allEntries, saved] = await Promise.all([
    readPlannerState(db),
    listPlannerRows(db, "entries") as Promise<Entry[]>,
    db.prepare("SELECT * FROM planner_reviews WHERE week=?1").bind(selected).first<{ completed_at: string | null; notes: string; version: number }>(),
  ]);
  const projectGoals = new Map(state.projects.map(project => [project.id, project.goal_id]));
  const totals = new Map<number, number>();
  const delay = causeCounts(), causes = causeCounts(), ratio: number[] = [];
  for (const task of state.tasks) {
    if (!task.done_at) continue;
    const date = dayOf(task.done_at), goal = projectGoals.get(task.project_id);
    if (goal && date >= selected && date < end) totals.set(goal, (totals.get(goal) ?? 0) + (task.actual_minutes ?? task.estimate_minutes ?? 0));
    if (date >= start && date < end) {
      if (task.delay_reason) delay[task.delay_reason]++;
      if (task.actual_minutes && task.estimate_minutes) ratio.push(task.estimate_minutes / task.actual_minutes);
    }
  }
  for (const entry of allEntries) {
    const date = dayOf(entry.created_at);
    if (entry.cause && date >= start && date < end) causes[entry.cause]++;
  }
  ratio.sort((a, b) => a - b);
  const middle = Math.floor(ratio.length / 2);
  const median = ratio.length === 0 ? null : ratio.length % 2 ? ratio[middle] : (ratio[middle - 1] + ratio[middle]) / 2;
  return {
    week: selected, today, completed_at: saved?.completed_at ?? null, version: saved?.version ?? null, notes: saved ? JSON.parse(saved.notes) : {},
    state, blocked: state.tasks.filter(task => task.status === "blocked"),
    time: state.goals.map(goal => ({ id: goal.id, title: goal.title, target: goal.weekly_target_minutes, actual: totals.get(goal.id) ?? 0 })),
    patterns: { delay, causes, median, sampleSize: ratio.length },
    entries: allEntries.filter(entry => dayOf(entry.created_at) >= selected && dayOf(entry.created_at) < end),
  };
}

export async function savePlannerReview(db: D1Database, input: Record<string, unknown>, week?: string | null, now = new Date()) {
  const review = await plannerWeeklyReview(db, week, now);
  const version = input.version == null ? null : plannerId(input.version);
  if (version !== review.version) throw new PlannerError(unchanged, 409);
  const rawNotes = plannerObject(input.notes ?? {});
  const stepNames = ["检查进行中项目", "清理卡住任务", "时间分配", "规律", "简历候选"] as const;
  const steps = rawNotes.steps ?? [], suggestions = rawNotes.suggestions ?? [];
  if (!Array.isArray(steps) || steps.length > stepNames.length || !Array.isArray(suggestions) || suggestions.length > 6) {
    throw new PlannerError("请求格式无效");
  }
  const selectedSteps = [...new Set(steps.map(step => pick(step, stepNames)))];
  if (selectedSteps.includes(stepNames[0]) && rankToday(review.state, review.today).stalled.length) {
    throw new PlannerError("请为停滞项目补下一步或暂停项目");
  }
  const notes = { steps: selectedSteps, note: plannerText(rawNotes.note, 8000),
    suggestions: suggestions.map(item => plannerText(item, 500)).filter(Boolean),
    ...(selectedSteps.includes(stepNames[0]) ? { projects: review.state.projects.map(project => ({
      id: project.id, status: project.status, target_on: review.state.milestones.find(m => m.project_id === project.id && m.status === "open")?.target_on ?? null,
    })) } : {}),
    ...(selectedSteps.includes(stepNames[1]) ? { blocked: review.blocked.map(task => ({ id: task.id, check_back_on: task.check_back_on })) } : {}) };
  const encoded = JSON.stringify(notes);
  if (encoded.length > 16_000) throw new PlannerError("回顾备注太长");
  const ids = input.resume_entry_ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > review.entries.length || ids.some(id => !review.entries.some(entry => entry.id === id)))) {
    throw new PlannerError("所选记录不属于本周");
  }
  const stamp = now.toISOString();
  const [status] = await db.batch([
    db.prepare(`INSERT INTO planner_reviews(week,completed_at,notes) VALUES(?1,?2,?3)
      ON CONFLICT(week) DO UPDATE SET completed_at=excluded.completed_at,notes=excluded.notes,version=planner_reviews.version+1
      WHERE planner_reviews.version=?4 RETURNING *`).bind(review.week, stamp, encoded, version),
    ...(ids === undefined ? [] : [db.prepare(`UPDATE planner_entries SET resume_candidate=(
      id IN (SELECT value FROM json_each(?1))),version=version+1,updated_at=?3
      WHERE id IN(SELECT value FROM json_each(?2)) AND changes()>0 AND resume_candidate<>(id IN (SELECT value FROM json_each(?1)))`)
      .bind(JSON.stringify(ids), JSON.stringify(review.entries.map(entry => entry.id)), stamp)]),
  ]);
  if (!status.results.length) throw new PlannerError(unchanged, 409);
  return plannerWeeklyReview(db, review.week, now);
}

export function interviewPlannerStatements(db: D1Database, applicationId: number, now: Date, token?: string, reachedAt?: string | null) {
  const ref = `application:${applicationId}:interview`;
  const stamp = now.toISOString();
  const match = `FROM applications a JOIN planner_projects p ON p.id=(
    SELECT id FROM planner_projects WHERE kind='project' AND title='求职' ORDER BY id LIMIT 1)
    WHERE a.id=?1 AND a.status='interview' AND (?4 IS NULL OR a.mutation_token=?4)`;
  return [
    db.prepare(`INSERT INTO planner_milestones(project_id,title,position,source_ref,created_at,updated_at)
      SELECT p.id,a.company||' 面试准备',(SELECT COALESCE(MAX(position),-1)+1 FROM planner_milestones WHERE project_id=p.id),?2,?3,?3
      ${match} ON CONFLICT(project_id,source_ref) DO NOTHING`).bind(applicationId, ref, stamp, token ?? null),
    db.prepare(`INSERT INTO planner_tasks(project_id,milestone_id,title,due_on,source_ref,position,created_at,updated_at)
      SELECT p.id,(SELECT id FROM planner_milestones WHERE project_id=p.id AND source_ref=?2),
        parts.title,ny_day,?2||parts.suffix,parts.position,?3,?3 FROM (
          SELECT '公司和岗位调研' AS title,'' AS suffix,0 AS position UNION ALL SELECT '相关知识复习',':review',1
          UNION ALL SELECT '模拟面试一次',':mock',2
        ) parts CROSS JOIN (SELECT ?5 AS ny_day) CROSS JOIN applications a JOIN planner_projects p ON p.id=(
          SELECT id FROM planner_projects WHERE kind='project' AND title='求职' ORDER BY id LIMIT 1)
      WHERE a.id=?1 AND a.status='interview' AND (?4 IS NULL OR a.mutation_token=?4) AND changes()>0
      ON CONFLICT(project_id,source_ref) DO NOTHING`).bind(applicationId, ref, stamp, token ?? null,
      reachedAt && Number.isFinite(Date.parse(reachedAt)) ? dayOf(reachedAt) : null),
    db.prepare(`UPDATE planner_projects SET last_activity_at=?1 WHERE changes()>0 AND id=(
      SELECT id FROM planner_projects WHERE kind='project' AND title='求职' ORDER BY id LIMIT 1)`).bind(stamp),
  ];
}

export async function fillPendingInterviews(db: D1Database, now = new Date()) {
  const rows = await db.prepare("SELECT id,status_at FROM applications WHERE status='interview'").all<{ id: number; status_at: string | null }>();
  for (const row of rows.results) await db.batch(interviewPlannerStatements(db, row.id, now, undefined, row.status_at));
}

export async function createSkillProject(db: D1Database, value: unknown, now = new Date()) {
  const skill = plannerText(value, 120, true), name = `学习 ${skill}`, stamp = now.toISOString();
  await plannerSettings(db);
  const [created] = await db.batch([
    db.prepare(`INSERT INTO planner_projects(kind,title,status,created_at,updated_at,last_activity_at)
      SELECT 'learning',?1,CASE WHEN max_active_projects IS NULL OR
        (SELECT COUNT(*) FROM planner_projects WHERE status='active')<max_active_projects THEN 'active' ELSE 'paused' END,?2,?2,?2
      FROM planner_settings WHERE id=1 AND NOT EXISTS(SELECT 1 FROM planner_projects WHERE kind='learning' AND title=?1 AND status IN('active','paused'))
      RETURNING id,status`).bind(name, stamp),
    db.prepare(`INSERT INTO planner_tasks(project_id,title,created_at,updated_at)
      SELECT last_insert_rowid(),'确定学习资料和第一步',?1,?1 WHERE changes()>0`).bind(stamp),
  ]);
  return created.results[0] ?? await db.prepare("SELECT id,status FROM planner_projects WHERE kind='learning' AND title=?1 AND status IN('active','paused') ORDER BY id LIMIT 1").bind(name).first();
}

import { daysBetween, PLANNER_DEFAULT_MINUTES, plannerDay, type PlannerState } from "./planner-rules";

export type Reason = { label: string; value: number; args?: (number | string)[] };
export type FocusItem = { id: number; project_id: number; title: string; minutes: number | null; score: number;
  reasons: Reason[]; due: string | null; overdue: boolean; position: number; reviewCount?: number };
export const SELECT_FOCUS_LIMIT = 3;

function urgency(days: number) {
  return days <= 0 ? 100 : days === 1 ? 80 : days <= 3 ? 60 : days <= 7 ? 30 : 0;
}

export function rankToday(state: PlannerState, today: string, availableMinutes = PLANNER_DEFAULT_MINUTES) {
  const active = state.projects.filter(project => project.status === "active");
  const activeIds = new Set(active.map(project => project.id));
  const byProject = new Map(active.map(project => [project.id, project]));
  const goals = new Map(state.goals.filter(goal => goal.status === "active").map(goal => [goal.id, goal]));
  const milestones = new Map(state.milestones.map(milestone => [milestone.id, milestone]));
  const current = new Map<number, number>();
  for (const milestone of state.milestones.filter(row => row.status === "open").sort((a, b) => a.position - b.position || a.id - b.id)) {
    if (!current.has(milestone.project_id)) current.set(milestone.project_id, milestone.id);
  }
  const lastGoal = new Map<number, string>();
  for (const project of state.projects) {
    if (project.goal_id !== null && project.last_activity_at > (lastGoal.get(project.goal_id) ?? "")) lastGoal.set(project.goal_id, project.last_activity_at);
  }
  const tasks = state.tasks.filter(task => activeIds.has(task.project_id) && ["doing", "next"].includes(task.status));
  const reviewCounts = new Map<number, number>();
  for (const card of state.cards) {
    if (byProject.get(card.project_id)?.kind === "learning" && card.due_on <= today) reviewCounts.set(card.project_id, (reviewCounts.get(card.project_id) ?? 0) + 1);
  }
  function scored(item: Omit<FocusItem, "score" | "reasons">, reasons: Reason[]) {
    const minutes = item.minutes;
    if (minutes !== null && minutes > availableMinutes) reasons.push({ label: "需要整块时间", value: -40 });
    if (availableMinutes < 90 && minutes !== null && minutes <= 30) reasons.push({ label: "适合碎片时间", value: 10 });
    return { ...item, score: reasons.reduce((sum, reason) => sum + reason.value, 0), reasons };
  }
  const candidates: FocusItem[] = tasks.map(task => {
    const project = byProject.get(task.project_id)!;
    const milestone = milestones.get(task.milestone_id ?? 0);
    const target = milestone?.status === "open" ? milestone.target_on : null;
    const deadline = task.due_on ? urgency(daysBetween(task.due_on, today)) : 0;
    const weighted = target ? urgency(daysBetween(target, today)) * 0.5 : 0;
    const reasons: Reason[] = [];
    const date = weighted > deadline ? target : task.due_on;
    if (date && Math.max(weighted, deadline)) reasons.push({ label: date < today ? "{0} 截止，已逾期" : "{0} 截止，还剩 {1} 天",
      args: [date, daysBetween(date, today)], value: Math.max(weighted, deadline) });
    if (task.status === "doing") reasons.push({ label: "进行中，继续完成", value: 25 });
    if (task.unblocked_at) {
      const days = daysBetween(today, plannerDay(new Date(task.unblocked_at)));
      if (days >= 0 && days <= 2) reasons.push({ label: "卡点近日已解除", value: 20 });
    }
    if (task.milestone_id && current.get(task.project_id) === task.milestone_id) reasons.push({ label: "当前里程碑的关键任务", value: 15 });
    const goal = goals.get(project.goal_id ?? 0);
    if (goal) {
      const activity = lastGoal.get(goal.id) ?? goal.created_at;
      const days = Math.max(0, daysBetween(today, plannerDay(new Date(activity))));
      if (days) reasons.push({ label: "这个目标已 {0} 天没有进展", args: [days], value: Math.min(days, 10) * 3 });
      reasons.push({ label: "目标优先级 {0}", args: [goal.priority], value: goal.priority * 5 });
    }
    return scored({ id: task.id, project_id: task.project_id, title: task.title, minutes: task.estimate_minutes, position: task.position,
      due: task.due_on, overdue: !!date && date < today }, reasons);
  });
  for (const [id, count] of reviewCounts) candidates.push(scored({ id: -id, project_id: id, title: "", minutes: count * 2,
    position: 0, due: today, overdue: false, reviewCount: count }, [{ label: "{0} 张卡片今天到期", args: [count], value: Math.min(count * 3, 30) }]));
  candidates.sort((a, b) => b.score - a.score || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.position - b.position || a.id - b.id);
  const focus: FocusItem[] = [];
  const counts = new Map<number, number>();
  for (const item of candidates) {
    if (focus.length === SELECT_FOCUS_LIMIT) break;
    if ((counts.get(item.project_id) ?? 0) >= 2 || (item.minutes ?? 0) > availableMinutes) continue;
    focus.push({ ...item, reasons: item.reasons.filter(reason => reason.value > 0).sort((a, b) => b.value - a.value).slice(0, 2) });
    counts.set(item.project_id, (counts.get(item.project_id) ?? 0) + 1);
  }
  return {
    focus, candidates,
    checkBack: state.tasks.filter(task => activeIds.has(task.project_id) && task.status === "blocked" && task.check_back_on && task.check_back_on <= today)
      .sort((a, b) => a.check_back_on!.localeCompare(b.check_back_on!) || a.id - b.id),
    stalled: active.filter(project => !tasks.some(task => task.project_id === project.id)),
    stale: active.filter(project => daysBetween(today, plannerDay(new Date(project.last_activity_at))) >= 7),
    reviewCounts: Object.fromEntries(reviewCounts),
  };
}

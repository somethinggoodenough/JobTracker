const zone = "America/New_York";
const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
});

const grades = [
  ["大吉", 1], ["中吉", 2], ["小吉", 2], ["吉", 2], ["中平", 3], ["凶", 3], ["大凶", 1],
] as const;
export const fortuneActions = [
  { id: "tailor", label: "修改简历", good: "让最相关的项目排在前面。", bad: "别让模板排版抢走写项目的时间。" },
  { id: "apply", label: "投递新岗位", good: "挑一条合适的 JD，认真投一份。", bad: "别为了凑投递数跳过岗位要求。" },
  { id: "follow-up", label: "跟进申请", good: "给等了几天的申请写一封简短跟进。", bad: "刚联系过的招聘方，可以再等一等。" },
  { id: "interview", label: "练习面试", good: "挑一个项目，讲清你的决策和取舍。", bad: "别死背答案，试试用自己的话解释。" },
  { id: "portfolio", label: "整理项目", good: "给一个项目补上可运行的示例。", bad: "别为了重做架构搁置能展示的成果。" },
  { id: "track", label: "更新申请记录", good: "把今天的投递和进展记下来。", bad: "别把待跟进和已回复混在一起。" },
  { id: "search", label: "找新机会", good: "换一个同义岗位名试试。", bad: "别只用一个职位名搜遍所有公司。" },
  { id: "rest", label: "休息一下", good: "走一走，给下一轮投递留点精力。", bad: "别用反复刷邮箱当休息。" },
] as const;

export type FortuneAction = typeof fortuneActions[number];
type ActionId = FortuneAction["id"];
type Grade = typeof grades[number][0];
export type DailyFortune = { day: string; grade: Grade; favored: ActionId[]; avoided: ActionId[]; streak: number };

export function fortuneDay(date = new Date()) {
  const fields = Object.fromEntries(calendar.formatToParts(date).map(part => [part.type, part.value]));
  return fields.year + "-" + fields.month + "-" + fields.day;
}

function dayTime(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day + "T00:00:00Z") : NaN;
}

export function readFortune(raw: string | null): DailyFortune | null {
  if (!raw) return null;
  try {
    const draw = JSON.parse(raw) as DailyFortune;
    if (!draw || !Number.isFinite(dayTime(draw.day)) || !grades.some(([grade]) => grade === draw.grade)
      || !Number.isSafeInteger(draw.streak) || draw.streak < 1 || !Array.isArray(draw.favored) || !Array.isArray(draw.avoided)) return null;
    const ids = [...draw.favored, ...draw.avoided];
    if (draw.favored.length !== (draw.grade === "大凶" ? 0 : 2) || draw.avoided.length !== (draw.grade === "大吉" ? 0 : 2)
      || new Set(ids).size !== ids.length || !ids.every(id => fortuneActions.some(action => action.id === id))) return null;
    return draw;
  } catch {
    return null;
  }
}

export function drawDailyFortune(day: string, previous: DailyFortune | null, random = Math.random): DailyFortune {
  if (previous?.day === day) return previous;

  let roll = random() * grades.reduce((sum, [, weight]) => sum + weight, 0);
  let grade: Grade = grades[grades.length - 1][0];
  for (const [label, weight] of grades) {
    if (roll < weight) { grade = label; break; }
    roll -= weight;
  }

  const pool = fortuneActions.map(action => action.id);
  const count = grade === "大吉" || grade === "大凶" ? 2 : 4;
  const picks = Array.from({ length: count }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return {
    day, grade, favored: grade === "大凶" ? [] : picks.slice(0, 2),
    avoided: grade === "大吉" ? [] : picks.slice(-2),
    streak: previous && dayTime(day) - dayTime(previous.day) === 86_400_000 ? previous.streak + 1 : 1,
  };
}

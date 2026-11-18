import type { JobRecord } from "./job-types";
export const SHORTLIST_VERSION = "engineering-early-career-v2";

function requiresSeniorExperience(description: string): boolean {
  const heading = /(?:minimum|basic|required) qualifications|(?:job )?requirements|what you(?:'|’)ll bring|what you bring|任职要求|岗位要求|职位要求|必备条件/ig;
  const preferred = /preferred qualifications|nice to have|bonus points|加分项|优先条件/ig;
  const years = /\b(\d{1,2})\s*(?:(?:[-–—]|to)\s*\d{1,2})?\s*\+?\s*years?\s+(?:of\s+)?(?:(?:relevant|professional|industry|work|hands.on|software development|programming|engineering)\s+){0,3}experience|([0-9]{1,2}|[三四五六七八九十])\s*(?:[-–到至]\s*[0-9三四五六七八九十]+)?\s*年(?:以上|及以上)?[^。；\n]{0,12}(?:工作|相关|开发|研发)?经验/ig;
  for (const match of description.matchAll(years)) {
    const value = match[1] || match[2], minimum = Number(value) || ({ 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>)[value];
    if (!(minimum >= 3)) continue;
    const index = match.index!, before = description.slice(0, index);
    const lineStart = Math.max(before.lastIndexOf("\n"), before.lastIndexOf(". "), before.lastIndexOf("。"), before.lastIndexOf("；"), index - 200) + 1;
    const lineEnd = description.slice(index).search(/[\n。；]/);
    const line = description.slice(lineStart, lineEnd < 0 ? Math.min(description.length, index + 200) : index + lineEnd);
    const requiredAt = [...before.matchAll(heading)].at(-1)?.index ?? -1;
    const preferredAt = [...before.matchAll(preferred)].at(-1)?.index ?? -1;
    if (/\bnot (?:strictly )?(?:required|mandatory)\b|不要求|无需|不需要/i.test(line)) continue;
    if (/科研|学术|课程|项目经验|research|academic/i.test(line) && !/工作|从业|professional|industry/i.test(line)) continue;
    const explicit = /\b(?:must|required|at least|minimum|requires?)\b|至少|必须|不少于|要求/i.test(line);
    if (!explicit && (/\b(?:preferred|a plus|nice to have)\b|优先|加分/i.test(line) || preferredAt > requiredAt)) continue;
    if (explicit || requiredAt > preferredAt && requiredAt >= 0) return true;
  }
  return false;
}

export function localShortlist(job: JobRecord): { priority: number; reason: string | null } {
  const title = job.title, description = job.description;
  const nonEngineering = /^(?:technical\s+)?(?:recruiter|account executive|sales (?:engineer|development|representative)|business development|customer (?:success|support)|product manager|project manager|program manager|marketing|graphic designer|accountant|financial analyst|mechanical engineer|electrical engineer|hardware engineer)\b|^(?:招聘|销售|市场|财务|行政|产品经理|项目经理|机械|电气)/i;
  if (nonEngineering.test(title)) return { priority: 0, reason: "本地预筛：明确为目标工程岗位以外的职责" };
  const otherRoles = /\b(?:recruiter|account executive|business development|sales development|(?:marketing|communications|social media) (?:intern|specialist|associate|analyst|coordinator)|(?:UX|UI|graphic|product) designer|accountant|financial analyst)\b|(?:市场营销|人力资源|招聘专员|财务|平面设计|视觉设计)/i;
  const frontendOnly = /\b(?:front.end|frontend|mobile|iOS|Android)\b.*\b(?:engineer|developer)\b|\b(?:engineer|developer)\b.*\b(?:front.end|frontend|mobile|iOS|Android)\b|前端(?:开发)?工程师|客户端(?:开发)?工程师/i;
  const mixedRole = /\b(?:full.stack|backend|back.end|distributed|platform|infrastructure|compiler|kernel)\b|全栈|后端|分布式|平台|基础架构|编译|内核/i;
  const testingOnly = /^(?:QA\b|quality assurance|software (?:test|testing) engineer|hardware|electrical|mechanical)|^(?:测试工程师|测试开发工程师|软件测试|硬件|电气|机械)/i;
  if (otherRoles.test(title) || (frontendOnly.test(title) || testingOnly.test(title)) && !mixedRole.test(title))
    return { priority: 0, reason: "本地预筛：职位标题明确属于非目标岗位" };
  if (requiresSeniorExperience(description)) return { priority: 0, reason: "本地预筛：必备条件明确要求最低 3 年以上经验" };
  const engineering = /\b(?:software|backend|back.end|full.stack|distributed|AI|ML|LLM|machine learning|cloud|platform|infrastructure|data engineer|data engineering|inference|training|reinforcement learning|runtime|execution|compiler|kernel|CUDA|Triton|MLOps|DevOps|SRE|systems engineer|research engineer)\b|后端|全栈|分布式|人工智能|机器学习|大模型|云平台|数据工程|数据开发|基础架构|算法|推理|训练|编译|算子|内核|软件|研发|开发工程|运维/i;
  if (!engineering.test(`${title}\n${description}`)) return { priority: 0, reason: "本地预筛：没有目标工程职责线索" };
  const internship = /\b(?:intern(?:ship)?|co[ -]?op)\b|实习|實習/i;
  const graduate = /\b(?:new[ -]?grad(?:uate)?s?|fresh[ -]?grad(?:uate)?s?|university grad(?:uate)?s?|campus|early[ -]?career|graduate (?:program|engineer|role)|entry[ -]?level|junior|jr\.?)\b|应届|應屆|校招|校园招聘|初级|初級|毕业生|畢業生/i;
  if (internship.test(title)) return { priority: 100, reason: null };
  if (graduate.test(title) || /\bengineer\s+I\b/.test(title)) return { priority: 95, reason: null };
  // Eligibility/requirement language only, rather than incidental mentoring of juniors.
  const degree = /(?:currently (?:enrolled|pursuing)|pursuing (?:a |an )?(?:bachelor|master|PhD)|graduat(?:ing|e[sd]?) (?:in|between)|在读|在讀|毕业时间|畢業時間)/i;
  const entryRequirement = /(?:\b(?:new[ -]?grad(?:uate)?s?|fresh graduates?|entry[ -]?level|early[ -]?career|junior (?:engineer|developer)|no (?:prior |previous )?(?:work )?experience)\b|接受应届|应届毕业|校招|初级工程|无需.*经验)/i;
  if ((internship.test(description) && degree.test(description)) || entryRequirement.test(description)) return { priority: 80, reason: null };
  const experience = /\b(?:[012]|zero|one|two)\s*(?:(?:[-–—]|to)\s*[0-9]+)?\+?\s*years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+|hands.on\s+|work\s+)?(?:experience|software development|programming|engineering experience)|(?:^|[^0-9])(?:[0-2一二两零])\s*(?:[-–到至]\s*[0-9一二两三四五六七八九十]+)?\s*年.{0,8}(?:工作|开发|研发|相关)?经验|(?:工作|开发|研发)经验\s*(?:[：:]|至少|不少于|需要|为)?\s*[0-2一二两零]\s*年/i;
  if (experience.test(description)) return { priority: 60, reason: null };
  return { priority: 0, reason: "本地预筛：未发现实习、应届、初级或最低 0–2 年经验线索" };
}

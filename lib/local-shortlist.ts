import type { JobRecord } from "./job-types";
import { currentScreeningRules } from "./screening-context";
import type { CoarseFilter } from "./screening-defaults";
export const SHORTLIST_VERSION = "broad-technical-early-career-v3";

function requiresSeniorExperience(description: string, maximum: number | null): boolean {
  if (maximum === null) return false;
  const heading = /(?:minimum|basic|required) qualifications|(?:job )?requirements|what you(?:'|’)ll bring|what you bring|任职要求|岗位要求|职位要求|必备条件/ig;
  const preferred = /preferred qualifications|nice to have|bonus points|加分项|优先条件/ig;
  const years = /\b(\d{1,2})\s*(?:(?:[-–—]|to)\s*\d{1,2})?\s*\+?\s*years?\s+(?:of\s+)?(?:(?:relevant|professional|industry|work|hands.on|software development|programming|engineering)\s+){0,3}experience|([0-9]{1,2}|[三四五六七八九十])\s*(?:[-–到至]\s*[0-9三四五六七八九十]+)?\s*年(?:以上|及以上)?[^。；\n]{0,12}(?:工作|相关|开发|研发)?经验/ig;
  for (const match of description.matchAll(years)) {
    const value = match[1] || match[2], minimum = Number(value) || ({ 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>)[value];
    if (!(minimum > maximum)) continue;
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

export function localShortlist(job: JobRecord, coarse: CoarseFilter = currentScreeningRules().coarse): { priority: number; reason: string | null } {
  const title = job.title, description = job.description;
  const relevantTitle = /\b(?:quant(?:itative)?|data (?:scien(?:ce|tist)|analy(?:st|tics)|engineer)|solutions? (?:architect|engineer)|forward[ -]?deploy(?:ed|ment)|software (?:engineer|developer))\b|量化|数据科学|数据分析|解决方案|前线部署/i;
  const nonEngineering = /^(?:technical\s+)?(?:recruiter|account executive|sales (?:development|representative)|business development|product manager|project manager|program manager|marketing|graphic designer|accountant|financial analyst)\b|^(?:招聘|销售代表|市场|财务|行政|产品经理|项目经理)/i;
  if (coarse.rejectNonTechnical && nonEngineering.test(title) && !relevantTitle.test(title)) return { priority: 0, reason: "本地预筛：明确为目标工程岗位以外的职责" };
  const otherRoles = /\b(?:recruiter|account executive|business development|sales development|(?:marketing|communications|social media) (?:intern|specialist|associate|analyst|coordinator)|(?:UX|UI|graphic|product) designer|accountant)\b|(?:市场营销|人力资源|招聘专员|财务|平面设计|视觉设计)/i;
  if (coarse.rejectNonTechnical && otherRoles.test(title) && !relevantTitle.test(title))
    return { priority: 0, reason: "本地预筛：职位标题明确属于非目标岗位" };
  if (requiresSeniorExperience(description, coarse.maxRequiredYears)) return { priority: 0, reason: `本地预筛：必备经验超过 ${coarse.maxRequiredYears} 年阈值` };
  const engineering = /\b(?:software|backend|back.end|full.stack|front.end|frontend|mobile|iOS|Android|SDET|QA|test automation|distributed|AI|ML|LLM|machine learning|cloud|platform|infrastructure|data (?:engineer|engineering|scien(?:ce|tist)|analy(?:st|tics|sis))|business intelligence|decision science|applied scientist|Python|SQL|programming|quant(?:itative)?|quant developer|trading (?:systems?|technology)|statistic(?:s|ian|al)|solutions? (?:architect|engineer|consultant)|forward[ -]?deploy(?:ed|ment)|deployment engineer|implementation engineer|integration engineer|technical (?:consultant|support|solutions)|sales engineer|customer engineer|inference|training|reinforcement learning|runtime|execution|compiler|kernel|CUDA|Triton|MLOps|DevOps|SRE|systems engineer|research (?:engineer|scientist))\b|后端|全栈|前端|客户端|测试开发|自动化测试|分布式|人工智能|机器学习|大模型|云平台|数据工程|数据开发|数据科学|数据分析|量化|统计|解决方案|架构师|前线部署|前沿部署|技术咨询|技术支持|客户工程|基础架构|算法|推理|训练|编译|算子|内核|软件|研发|开发工程|运维/i;
  const text = `${title}\n${description}`.normalize("NFKC").toLowerCase();
  const extra = coarse.extraTechnicalKeywords.some(word => text.includes(word.normalize("NFKC").toLowerCase()));
  if (coarse.requireTechnicalSignals && !extra && !engineering.test(`${title}\n${description}`)) return { priority: 0, reason: "本地预筛：没有软件、数据、量化或相关技术职责线索" };
  const internship = /\b(?:intern(?:ship)?|co[ -]?op)\b|实习|實習/i;
  const graduate = /\b(?:new[ -]?grad(?:uate)?s?|fresh[ -]?grad(?:uate)?s?|university grad(?:uate)?s?|campus|early[ -]?career|graduate (?:program|engineer|role)|entry[ -]?level|junior|jr\.?)\b|应届|應屆|校招|校园招聘|初级|初級|毕业生|畢業生/i;
  if (internship.test(title)) return { priority: 100, reason: null };
  if (graduate.test(title) || /\b(?:engineer|developer|scientist|analyst|architect|consultant)\s+I\b/.test(title)) return { priority: 95, reason: null };
  // Eligibility/requirement language only, rather than incidental mentoring of juniors.
  const degree = /(?:currently (?:enrolled|pursuing)|pursuing (?:a |an )?(?:bachelor|master|PhD)|graduat(?:ing|e[sd]?) (?:in|between)|在读|在讀|毕业时间|畢業時間)/i;
  const entryRequirement = /(?:\b(?:new[ -]?grad(?:uate)?s?|fresh graduates?|entry[ -]?level|early[ -]?career|junior (?:engineer|developer)|no (?:prior |previous )?(?:work )?experience)\b|接受应届|应届毕业|校招|初级工程|无需.*经验)/i;
  if ((internship.test(description) && degree.test(description)) || entryRequirement.test(description)) return { priority: 80, reason: null };
  const experience = /\b(?:[012]|zero|one|two)\s*(?:(?:[-–—]|to)\s*[0-9]+)?\+?\s*years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+|hands.on\s+|work\s+)?(?:experience|software development|programming|engineering experience)|(?:^|[^0-9])(?:[0-2一二两零])\s*(?:[-–到至]\s*[0-9一二两三四五六七八九十]+)?\s*年.{0,8}(?:工作|开发|研发|相关)?经验|(?:工作|开发|研发)经验\s*(?:[：:]|至少|不少于|需要|为)?\s*[0-2一二两零]\s*年/i;
  if (experience.test(description)) return { priority: 60, reason: null };
  return coarse.requireEarlyCareerSignals ? { priority: 0, reason: "本地预筛：未发现实习、应届、初级或最低 0–2 年经验线索" } : { priority: 40, reason: null };
}

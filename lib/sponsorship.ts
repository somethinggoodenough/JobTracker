import type { JobAnalysis } from "./classification-types";

export type UsSponsorship = { available: true; evidence: string };
export type VisaSponsorship =
  | { status: "available" | "unavailable"; evidence: string }
  | { status: "unclear"; evidence?: string };
const visa = /\b(?:visas?|H[ -]?1B|immigration|work (?:permit|authorization))\b|签证|簽證|工签|工簽/i;
const sponsor = /\b(?:sponsor(?:ship|ing|ed)?|sponsors)\b|赞助|贊助|担保|擔保/i;
const visaSupport = /\b(?:visas?|immigration|work (?:permit|authorization))\s+sponsor|\b(?:sponsor(?:ship|ing|ed)?|sponsors)\b[^.!?。\n]{0,80}\b(?:visas?|H[ -]?1B|work (?:permit|authorization)|immigration)\b|\bH[ -]?1B\b[^.!?。\n]{0,40}\bsponsor|(?:签证|簽證|工签|工簽)[^。\n]{0,30}(?:赞助|贊助|担保|擔保)|(?:赞助|贊助|担保|擔保)[^。\n]{0,30}(?:签证|簽證|工签|工簽)/i;
const negative = /\b(?:no|not|cannot|can't|unable|won't|without|never)\b[^.!?。\n]{0,110}\b(?:sponsor(?:ship|ing|ed)?|visas?)\b|\b(?:sponsor(?:ship|ing|ed)?|visas?)\b[^.!?。\n]{0,70}\b(?:unavailable|not (?:available|offered|provided|eligible|supported)|cannot)\b|(?:不(?:能|会|會)?(?:提供|支持|办理|辦理|担保|擔保)|无法|無法|不能|不予)[^。\n]{0,30}(?:签证|簽證|赞助|贊助|担保|擔保)|(?:签证|簽證|赞助|贊助)[^。\n]{0,20}(?:不提供|不支持|不可用)/i;
const conditional = /\b(?:may|might|could|potential(?:ly)?|case.by.case|subject to|depending|consider(?:ed|ing)?|not guaranteed)\b|可能|视情况|視情況|酌情|不保证|不保證/i;
const historical = /\b(?:previously|historically|in the past|used to|was|were|last year)\b|曾经|曾經|过往|過往|历史|歷史|过去|過去/i;
const affirmative = /\b(?:provide|provides|provided|offer|offers|offered|support|supports|supported|available|eligible)\b|\b(?:can|will|able to|willing to)\s+sponsor\b|\b(?:we|employer|company)\s+(?:also\s+)?sponsor\b|提供|支持|可以办理|可办理|可辦理/i;
const otherCountry = /\b(?:Canada|Canadian|United Kingdom|UK|London|Germany|India|Singapore|Australia|France|Japan|China|CN)\b|加拿大|英国|英國|德国|新加坡|中国|中國/i;
const explicitUS = (text: string) => /\b(?:US|USA)\b|\bU\.S\./.test(text) || /United States|美国|美國/i.test(text);
const foreignOnly = (text: string) => otherCountry.test(text) && !explicitUS(text);
const sentences = (description: string) => description
  .split(/(?<!\bU\.S\.)(?<!\be\.g\.)(?<!\bi\.e\.)(?<=[.!?。！？])\s+|\n+/i)
  .map(line => line.trim()).filter(Boolean);
const restricted = /\b(?:transfers?|cap.exempt|cap applications?|new sponsorship|exceptions?|except|only eligible)\b|仅限|僅限|除外/i;
const nonEmployment = /\b(?:export licen[cs]e|security clearance|conference|event|mentorship)\b/i;
const workEligibility = /\b(?:work|employment)\s+(?:authori[sz]ation|eligibility)|\b(?:eligible|authori[sz]ed|authorization|right)\s+to\s+work|\blegally\s+(?:work|employed)|工作许可|工作許可|工作资格|工作資格/i;
const noSponsorship = /\b(?:no|without)\s+(?:(?:the need for|requiring|any|employer|visa|immigration|work authorization|H[ -]?1B)\s+)*sponsorship\b/i;
const employerRefusal = /\b(?:cannot|can['’]t|unable to|will not|won['’]t|does not|do not|is not)\s+(?:be\s+)?(?:sponsor\w*|(?:offer|provide|support|eligible for)\s+.{0,55}sponsorship)\b|\bnot in a position\b.{0,85}\bto (?:offer|provide)\s+.{0,40}sponsorship\b|\bsponsorship\b.{0,45}\b(?:unavailable|not\s+(?:be\s+)?(?:available|offered|provided|eligible|supported))\b/i;
const chineseRefusal = /不(?:能|会|會|予)?(?:提供|支持|办理|辦理|担保|擔保).{0,25}(?:签证|簽證|工签|工簽|赞助|贊助)|(?:签证|簽證|工签|工簽).{0,25}(?:不提供|不支持|不可用)/i;
const refusal = (text: string) => noSponsorship.test(text) || employerRefusal.test(text) || chineseRefusal.test(text);

// Absence of this annotation means "not confirmed", never "no sponsorship".
// This annotation does not participate in job acceptance or consume a model request.
export function confirmedUsSponsorship(description: string, countries: JobAnalysis["countries"], claim?: unknown, location = ""): UsSponsorship | null {
  if (!countries.includes("US") || !description.trim()) return null;
  const statements = sentences(description);
  if (statements.some(line => sponsor.test(line) && refusal(line) && !foreignOnly(line) && !nonEmployment.test(line))) return null;
  const candidates: string[] = [];
  if (claim && typeof claim === "object" && "available" in claim && claim.available === true && "evidence" in claim && typeof claim.evidence === "string") candidates.push(claim.evidence.trim());
  candidates.push(...statements);
  for (const quote of candidates) {
    if (quote.length < 8 || quote.length > 350 || !description.includes(quote) || !visa.test(quote) || !sponsor.test(quote) || !visaSupport.test(quote)
      || !affirmative.test(quote) || negative.test(quote) || conditional.test(quote) || historical.test(quote) || restricted.test(quote) || nonEmployment.test(quote) || foreignOnly(quote)) continue;
    if (otherCountry.test(location) && !explicitUS(quote)) continue;
    return { available: true, evidence: quote };
  }
  return null;
}

// Derive this at read time so old approvals and application snapshots are covered.
export function assessUsSponsorship(description: string, countries: JobAnalysis["countries"], claim?: unknown, location = ""): VisaSponsorship | undefined {
  if (!countries.includes("US")) return undefined;
  const scoped = sentences(description).filter(line => line.length <= 350
    && !historical.test(line) && !nonEmployment.test(line) && !foreignOnly(line)
    && (!otherCountry.test(location) || explicitUS(line)));
  const relevant = scoped.filter(line => sponsor.test(line) && (visa.test(line) || workEligibility.test(line)));
  const limited = scoped.find(line => visa.test(line) && restricted.test(line) && /\b(?:can|offer|provide|support)\b|提供|支持/i.test(line));
  const explicitRefusal = relevant.find(line => refusal(line) && !conditional.test(line) && !restricted.test(line));
  if (explicitRefusal && !limited) return { status: "unavailable", evidence: explicitRefusal };
  if (limited) return { status: "unclear", evidence: limited };
  const confirmed = confirmedUsSponsorship(description, countries, claim, location);
  if (confirmed) return { status: "available", evidence: confirmed.evidence };
  const evidence = relevant.find(line => conditional.test(line) || restricted.test(line));
  return evidence ? { status: "unclear", evidence } : { status: "unclear" };
}

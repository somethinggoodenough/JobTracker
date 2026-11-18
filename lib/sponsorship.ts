import type { JobAnalysis } from "./classification-types";

export type UsSponsorship = { available: true; evidence: string };
const visa = /\b(?:visas?|H[ -]?1B|immigration|work (?:permit|authorization))\b|签证|簽證|工签|工簽/i;
const sponsor = /\b(?:sponsor(?:ship|ing|ed)?|sponsors)\b|赞助|贊助|担保|擔保/i;
const visaSupport = /\bvisas?\s+sponsor|\b(?:sponsor(?:ship|ing|ed)?|sponsors)\b[^.!?。\n]{0,80}\b(?:visas?|H[ -]?1B|work (?:permit|authorization)|immigration)\b|\bH[ -]?1B\b[^.!?。\n]{0,40}\bsponsor|(?:签证|簽證|工签|工簽)[^。\n]{0,30}(?:赞助|贊助|担保|擔保)|(?:赞助|贊助|担保|擔保)[^。\n]{0,30}(?:签证|簽證|工签|工簽)/i;
const negative = /\b(?:no|not|cannot|can't|unable|won't|without|never)\b[^.!?。\n]{0,110}\b(?:sponsor(?:ship|ing|ed)?|visas?)\b|\b(?:sponsor(?:ship|ing|ed)?|visas?)\b[^.!?。\n]{0,70}\b(?:unavailable|not (?:available|offered|provided|eligible|supported)|cannot)\b|(?:不(?:能|会|會)?(?:提供|支持|办理|辦理|担保|擔保)|无法|無法|不能|不予)[^。\n]{0,30}(?:签证|簽證|赞助|贊助|担保|擔保)|(?:签证|簽證|赞助|贊助)[^。\n]{0,20}(?:不提供|不支持|不可用)/i;
const conditional = /\b(?:may|might|could|potential(?:ly)?|case.by.case|subject to|depending|consider(?:ed|ing)?|not guaranteed)\b|可能|视情况|視情況|酌情|不保证|不保證/i;
const historical = /\b(?:previously|historically|in the past|used to|was|were|last year)\b|曾经|曾經|过往|過往|历史|歷史|过去|過去/i;
const affirmative = /\b(?:provide|provides|provided|offer|offers|offered|support|supports|supported|available|eligible)\b|\b(?:can|will|able to|willing to)\s+sponsor\b|\b(?:we|employer|company)\s+(?:also\s+)?sponsor\b|提供|支持|可以办理|可办理|可辦理/i;
const otherCountry = /\b(?:Canada|Canadian|United Kingdom|UK|London|Germany|India|Singapore|Australia|France|Japan|China|CN)\b|加拿大|英国|英國|德国|新加坡|中国|中國/i;
const explicitUS = (text: string) => /\b(?:US|USA)\b|\bU\.S\./.test(text) || /United States|美国|美國/i.test(text);
const foreignOnly = (text: string) => otherCountry.test(text) && !explicitUS(text);

// Absence of this annotation means "not confirmed", never "no sponsorship".
// This annotation does not participate in job acceptance or consume a model request.
export function confirmedUsSponsorship(description: string, countries: JobAnalysis["countries"], claim?: unknown, location = ""): UsSponsorship | null {
  if (!countries.includes("US") || !description.trim()) return null;
  const statements = description.split(/(?<=[.!?。])\s+|\n+/).map(line => line.trim()).filter(Boolean);
  if (statements.some(line => sponsor.test(line) && negative.test(line) && !foreignOnly(line))) return null;
  const candidates: string[] = [];
  if (claim && typeof claim === "object" && "available" in claim && claim.available === true && "evidence" in claim && typeof claim.evidence === "string") candidates.push(claim.evidence.trim());
  candidates.push(...statements);
  for (const quote of candidates) {
    if (quote.length < 8 || quote.length > 350 || !description.includes(quote) || !visa.test(quote) || !sponsor.test(quote) || !visaSupport.test(quote)
      || !affirmative.test(quote) || negative.test(quote) || conditional.test(quote) || historical.test(quote) || foreignOnly(quote)) continue;
    if (otherCountry.test(location) && !explicitUS(quote)) continue;
    return { available: true, evidence: quote };
  }
  return null;
}

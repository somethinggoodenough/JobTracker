import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_SCREENING, type ScreeningRules } from "./screening-defaults";
const settings = new AsyncLocalStorage<ScreeningRules>();
export const currentScreeningRules = () => settings.getStore() ?? DEFAULT_SCREENING;
export const withScreeningRules = <T>(rules: ScreeningRules, fn: () => T): T => settings.run(rules, fn);
export function screeningIdentity(rules: ScreeningRules) {
  const defaults = DEFAULT_SCREENING;
  const values = (r: ScreeningRules) => JSON.stringify([r.aiPrompt, ...Object.keys(defaults.coarse).map(k => r.coarse[k as keyof typeof r.coarse])]);
  const value = values(rules);
  return value === values(defaults) ? "" : value;
}

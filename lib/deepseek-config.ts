import { env } from "cloudflare:workers";
import { DEFAULT_DEEPSEEK_MODEL } from "./classification-types";
export function deepseekConfig() {
  const bindings = env as unknown as Record<string, unknown>;
  const apiKey = String(bindings.DEEPSEEK_API_KEY || bindings.deepseekapi || "").trim();
  const model = String(bindings.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL).trim();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(model)) throw new Error("DEEPSEEK_MODEL 配置无效");
  return { apiKey, model };
}

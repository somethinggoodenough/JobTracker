import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  if (!env.DB) throw new Error("D1 数据库绑定 DB 不可用");
  return env.DB;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLocalTypeScript } from "../scripts/load-local-typescript.mjs";

const { drawDailyFortune, fortuneDay, readFortune } = loadLocalTypeScript("lib/daily-fortune.ts");

test("daily fortune starts a new day at New York midnight, including daylight saving", () => {
  assert.equal(fortuneDay(new Date("2026-03-09T03:59:59Z")), "2026-03-08");
  assert.equal(fortuneDay(new Date("2026-03-09T04:00:00Z")), "2026-03-09");
  assert.equal(fortuneDay(new Date("2026-11-02T04:59:59Z")), "2026-11-01");
  assert.equal(fortuneDay(new Date("2026-11-02T05:00:00Z")), "2026-11-02");
});

test("daily fortune keeps the same draw, extends a streak the next day and resets after a gap", () => {
  const first = drawDailyFortune("2026-11-01", null, () => 0.35);
  assert.strictEqual(drawDailyFortune(first.day, first, () => { throw Error("already drawn"); }), first);
  const next = drawDailyFortune("2026-11-02", first, () => 0.35);
  assert.equal(next.streak, 2);
  assert.equal(drawDailyFortune("2026-11-04", next, () => 0.35).streak, 1);
  assert.deepEqual(readFortune(JSON.stringify(next)), next);
});

test("the daily fortune grades control which advice is drawn without duplicates", () => {
  const day = "2026-11-01";
  const lucky = drawDailyFortune(day, null, () => 0);
  assert.deepEqual([lucky.grade, lucky.favored.length, lucky.avoided.length], ["大吉", 2, 0]);
  const unlucky = drawDailyFortune(day, null, () => 0.999);
  assert.deepEqual([unlucky.grade, unlucky.favored.length, unlucky.avoided.length], ["大凶", 0, 2]);
  const regular = drawDailyFortune(day, null, () => 0.5);
  assert.equal(new Set([...regular.favored, ...regular.avoided]).size, 4);
  assert.equal(readFortune(JSON.stringify({ ...regular, avoided: regular.favored })), null);
  assert.equal(readFortune("{wrong"), null);
});

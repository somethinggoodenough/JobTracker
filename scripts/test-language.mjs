import assert from "node:assert/strict";
import { startBrowser } from "./cdp-browser.mjs";

const base = process.argv[2] || "http://127.0.0.1:4173";
const browser = await startBrowser("language-browser");
const englishButton = "Lan: EN";
const chineseButton = "语言：中文";
const browserErrors = [];

try {
  const { targetId } = await browser.call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.call("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params = {}) => browser.call(method, params, sessionId);
  await page("Page.enable");
  await page("Runtime.enable");
  browser.listeners.add(event => {
    if (event.method === "Runtime.exceptionThrown") browserErrors.push(event.params.exceptionDetails.text);
  });

  async function evaluate(expression) {
    const result = await page("Runtime.evaluate", { expression, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  async function until(expression, label) {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (await evaluate(expression)) return;
      } catch (error) {
        if (!/execution context/i.test(error.message)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Timed out waiting for ${label} at ${await evaluate("location.href")}`);
  }

  const button = label => `[...document.querySelectorAll("header button")].find(button => button.textContent.trim() === ${JSON.stringify(label)})`;
  const heading = text => `document.querySelector("main h1")?.textContent === ${JSON.stringify(text)}`;
  async function switchLanguage(from, to, locale) {
    assert(await evaluate(`Boolean(${button(from)})`));
    await evaluate(`${button(from)}.click()`);
    await until(`document.documentElement?.lang === ${JSON.stringify(locale)} && Boolean(${button(to)})`, locale);
  }

  await page("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url: base });
  await until(`${heading("所有机会，一页页发现。")} && !!document.querySelector("#daily-ai-limit")`, "Chinese home");

  await evaluate(`(() => {
    const select = document.querySelector('select[aria-label="工作方式"]');
    select.value = "Remote";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await switchLanguage(englishButton, chineseButton, "en-US");
  assert(await evaluate(heading("Find your next opportunity")));
  assert.equal(await evaluate("document.title"), "Job Radar");
  assert.equal(await evaluate(`document.querySelector('select[aria-label="Work arrangement"]').value`), "Remote");

  await page("Page.reload");
  await until(`document.documentElement?.lang === "en-US" && ${heading("Find your next opportunity")}`, "English after reload");
  await until(`!!document.querySelector("#daily-ai-limit") && !document.querySelector("main .animate-pulse")`, "jobs and AI budget");
  if (await evaluate(`Boolean(document.querySelector("main .job-card > button"))`)) {
    await evaluate(`document.querySelector("main .job-card > button").click()`);
    await until(`!!document.querySelector('section[aria-label="Job technologies and screening evidence"]')`, "English job details");
    await evaluate(`document.querySelector('button[aria-label="Close job details"]').click()`);
  }

  async function navigate(path, text) {
    await evaluate(`[...document.querySelectorAll('nav[aria-label="Main navigation"] a')].find(link => link.getClientRects().length && link.pathname === ${JSON.stringify(path)}).click()`);
    await until(`location.pathname === ${JSON.stringify(path)} && document.documentElement?.lang === "en-US" && ${heading(text)}`, text);
  }

  await navigate("/applications", "Applications");
  await evaluate(`[...document.querySelectorAll("main button")].find(button => button.textContent.trim() === "Analytics").click()`);
  await until(`document.querySelector('[aria-label="Application analytics"]')?.textContent.includes("Submitted")`, "English analytics");
  await navigate("/resumes", "Resumes");
  await evaluate(`[...document.querySelectorAll("main button")].find(button => button.textContent.trim() === "New resume").click()`);
  await until(`!!document.querySelector('button[aria-label="Close resume editor"]')`, "English resume editor");
  await evaluate(`document.querySelector('button[aria-label="Close resume editor"]').click()`);
  await navigate("/sources", "Job sources");
  await navigate("/runs", "Sync history");
  await navigate("/", "Find your next opportunity");

  await page("Emulation.setDeviceMetricsOverride", { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
  assert(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth && ${button(chineseButton)}.getBoundingClientRect().right <= window.innerWidth`), "the English header fits a narrow phone");
  await switchLanguage(chineseButton, englishButton, "zh-CN");
  assert(await evaluate(heading("所有机会，一页页发现。")));
  await page("Page.reload");
  await until(`document.documentElement?.lang === "zh-CN" && !!document.querySelector("#daily-ai-limit")`, "Chinese after reload");
  assert(await evaluate(`Boolean(${button(englishButton)})`));
  assert.deepEqual(browserErrors, []);
  console.log("Language switch, persistence, routes, filters, and mobile header passed.");
} finally {
  await browser.close();
}

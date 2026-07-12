/*
 * Verification against the FULL local app (SPA + Worker), where /api answers 401 for want of a
 * session — the production-shaped path. Also proves the metrics update DURING a run (the
 * $state reference-equality bug), then aborts early rather than spending 200 MB again.
 */
import { createRequire } from "node:module";

const require = createRequire(
  "file:///C:/Users/Trevo/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/",
);
const { chromium } = require("playwright-core");

const URL = "http://localhost:8787/tools/network-speed-test";
const OUT = "C:/dev/magna-carta-worktrees/slice-0-7a-design-system/scratch";
const errors = [];
const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("h1", { timeout: 20000 });
await page.waitForTimeout(2500);

const idle = clean(await page.locator("main").innerText());
console.log("=== IDLE, real Worker (no session) ===");
console.log(
  "round-trip line :",
  clean((idle.match(/You are not signed in[^.]*\./) || ["(NOT FOUND)"])[0]),
);
console.log(
  "packet-loss note:",
  clean((idle.match(/Sign in to measure packet loss/) || ["(NOT FOUND)"])[0]),
);
console.log("falsely blames network:", /could not be reached from this network/i.test(idle));
console.log("server panel     :", clean((idle.match(/Connected via[^]{0,90}/) || [""])[0]));
await page.screenshot({ path: `${OUT}/nstw-1-idle.png` });

// --- live update proof ---
console.log("\n=== RUN (aborted early) ===");
const tileValue = async (label) =>
  clean(
    await page
      .locator(`text=/^${label}$/i`)
      .first()
      .locator("xpath=following-sibling::*[1]")
      .innerText()
      .catch(() => "?"),
  );

await page.getByRole("button", { name: "Start" }).click();
const samples = [];
for (let i = 0; i < 6; i += 1) {
  await page.waitForTimeout(4000);
  samples.push(await tileValue("Latency"));
}
console.log("Latency tile over 24s:", samples.join(" | "));
const changedDuringRun = new Set(samples.filter((s) => s !== "—" && s !== "?")).size > 0;
console.log("populated DURING the run (live updates work):", changedDuringRun);

await page.screenshot({ path: `${OUT}/nstw-2-midrun.png` });

// scroll the app's scroll container to the charts and shoot them
await page.evaluate(() => {
  const main = document.querySelector("main");
  const scroller = main?.closest("[class*=overflow]") ?? main;
  scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/nstw-3-charts.png` });

console.log("\nconsole errors:", errors.length ? errors.join(" ; ") : "(none)");
await browser.close();

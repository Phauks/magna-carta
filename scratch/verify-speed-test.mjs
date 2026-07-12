/*
 * Coordinator browser verification for /tools/network-speed-test.
 * Drives a real Chrome via playwright-core resolved from the npx cache, with its own profile,
 * so it never contends with the Playwright MCP server's locked user-data-dir.
 */
import { createRequire } from "node:module";

const require = createRequire(
  "file:///C:/Users/Trevo/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/",
);
const { chromium } = require("playwright-core");

const URL = "http://localhost:5173/tools/network-speed-test";
const OUT = "C:/dev/magna-carta-worktrees/slice-0-7a-design-system/scratch";

const consoleErrors = [];

function text(t) {
  return (t ?? "").replace(/\s+/g, " ").trim();
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("h1", { timeout: 20000 });
await page.waitForTimeout(1500);

// --- 1. Idle state: must NOT autostart, must show disclosures + Start ---
const startVisible = await page
  .getByRole("button", { name: "Start" })
  .isVisible()
  .catch(() => false);
const bodyIdle = text(
  await page
    .locator("main")
    .innerText()
    .catch(() => ""),
);
const autostarted = /Measuring/i.test(bodyIdle);
await page.screenshot({ path: `${OUT}/nst-1-idle.png` });

console.log("=== IDLE ===");
console.log("Start button visible:", startVisible);
console.log("Auto-started (must be false):", autostarted);
console.log("Discloses data cost:", /200 MB|200MB/.test(bodyIdle));
console.log("Discloses IP sharing:", /IP address|public address/i.test(bodyIdle));
console.log("Packet loss text:", text((bodyIdle.match(/Packet loss[^]{0,120}/) || [""])[0]));
console.log("Server panel:", text((bodyIdle.match(/Connected via[^]{0,120}/) || [""])[0]));

// --- 2. Run it ---
console.log("\n=== RUNNING (real test, this takes a while) ===");
await page.getByRole("button", { name: "Start" }).click();

// Mid-run: prove the metrics update live (the $state reference-equality bug we fixed).
await page.waitForTimeout(12000);
const midBody = text(
  await page
    .locator("main")
    .innerText()
    .catch(() => ""),
);
const midDownload = text((midBody.match(/Download\s+([\d.]+\s*[MG]bps|—)/) || [])[1] || "—");
console.log("Mid-run Download reads:", midDownload, "(must not be — if live updates work)");
await page.screenshot({ path: `${OUT}/nst-2-midrun.png` });

// Wait for completion: Retest appears when phase becomes finished/failed.
await page
  .getByRole("button", { name: "Retest" })
  .waitFor({ timeout: 240000 })
  .catch(() => {
    console.log("!! Retest never appeared within 240s");
  });

await page.waitForTimeout(1500);
const finalBody = text(
  await page
    .locator("main")
    .innerText()
    .catch(() => ""),
);

console.log("\n=== FINISHED ===");
for (const label of ["Download", "Upload", "Latency", "Jitter", "Packet loss"]) {
  const m = finalBody.match(new RegExp(`${label}\\s+([^A-Z]{0,40})`));
  console.log(`${label}:`, text(m ? m[1] : "(not found)"));
}
console.log("Run-at timestamp present:", /Run at \d/.test(await page.locator("body").innerText()));
console.log("Error shown:", /The measurement stopped/.test(finalBody));
console.log("Blames network (must be false):", /filters speed\.cloudflare\.com/.test(finalBody));
console.log("Quality score section:", /Network quality score/i.test(finalBody));
console.log("Charts present:", {
  latency: /Latency measurements/i.test(finalBody),
  download: /Download measurements/i.test(finalBody),
  upload: /Upload measurements/i.test(finalBody),
});
console.log("Table views:", await page.getByText("Table view").count());
console.log("Server panel:", text((finalBody.match(/Connected via[^]{0,160}/) || [""])[0]));
console.log(
  "Round trip line:",
  text((finalBody.match(/(not signed in|Round trip to Magna Carta)[^]{0,120}/) || [""])[0]),
);

await page.screenshot({ path: `${OUT}/nst-3-final.png`, fullPage: true });

console.log("\n=== CONSOLE ERRORS ===");
console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");

await browser.close();

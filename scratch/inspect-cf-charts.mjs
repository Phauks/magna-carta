/*
 * Look at what speed.cloudflare.com actually draws for "Download Measurements".
 * Runs their test only until the chart populates, then exits hard to limit data use.
 */
import { createRequire } from "node:module";
const require = createRequire(
  "file:///C:/Users/Trevo/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/",
);
const { chromium } = require("playwright-core");

const OUT = "C:/dev/magna-carta-worktrees/slice-0-7a-design-system/scratch";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

await page.goto("https://speed.cloudflare.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// Their page gates on a Start button (privacy notice). Click it if present.
const start = page.getByRole("button", { name: /start/i }).first();
if (await start.isVisible().catch(() => false)) await start.click();

// Wait until the Download Measurements chart has real marks.
const found = await page
  .waitForFunction(
    () => {
      const heads = [...document.querySelectorAll("*")].filter(
        (n) => n.children.length === 0 && /Download Measurements/i.test(n.textContent ?? ""),
      );
      if (heads.length === 0) return false;
      let node = heads[0];
      for (let i = 0; i < 8 && node; i += 1) {
        const svg = node.querySelector?.("svg");
        if (svg && svg.querySelectorAll("path, rect, circle, line, polyline").length > 2) return true;
        node = node.parentElement;
      }
      return false;
    },
    { timeout: 180000 },
  )
  .then(() => true)
  .catch(() => false);

console.log("download chart populated:", found);

const anatomy = await page.evaluate(() => {
  const label = [...document.querySelectorAll("*")].find(
    (n) => n.children.length === 0 && /Download Measurements/i.test(n.textContent ?? ""),
  );
  if (!label) return { error: "section label not found" };
  let section = label;
  let svg = null;
  for (let i = 0; i < 8 && section; i += 1) {
    svg = section.querySelector?.("svg");
    if (svg) break;
    section = section.parentElement;
  }
  if (!svg) return { error: "no svg under the section" };

  const count = (sel) => svg.querySelectorAll(sel).length;
  const firstPath = svg.querySelector("path");
  const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent?.trim()).filter(Boolean);

  return {
    viewBox: svg.getAttribute("viewBox"),
    marks: {
      path: count("path"),
      polyline: count("polyline"),
      rect: count("rect"),
      circle: count("circle"),
      line: count("line"),
      text: count("text"),
    },
    firstPathD: firstPath?.getAttribute("d")?.slice(0, 140) ?? null,
    firstPathFill: firstPath ? getComputedStyle(firstPath).fill : null,
    firstPathStroke: firstPath ? getComputedStyle(firstPath).stroke : null,
    axisTexts: texts.slice(0, 14),
    sectionText: (section?.innerText ?? "").replace(/\s+/g, " ").slice(0, 260),
  };
});

console.log(JSON.stringify(anatomy, null, 2));

// Screenshot just that region.
const box = await page
  .locator("text=/Download Measurements/i")
  .first()
  .locator("xpath=ancestor::*[.//svg][1]")
  .screenshot({ path: `${OUT}/cf-download-chart.png` })
  .then(() => "saved")
  .catch((e) => `screenshot failed: ${String(e).slice(0, 80)}`);
console.log("region screenshot:", box);

await page.screenshot({ path: `${OUT}/cf-full.png` }).catch(() => {});
console.log("DONE");
process.exit(0);

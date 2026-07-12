import { createRequire } from "node:module";
const require = createRequire("file:///C:/Users/Trevo/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/");
const { chromium } = require("playwright-core");
const OUT = "C:/dev/magna-carta-worktrees/slice-0-7a-design-system/scratch";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
await page.goto("https://speed.cloudflare.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const start = page.getByRole("button", { name: /^start$/i }).first();
const had = await start.isVisible().catch(() => false);
if (had) await start.click();
console.log("clicked start:", had);
// let it run
for (const t of [20, 20, 20, 20]) {
  await page.waitForTimeout(t * 1000);
  const dl = await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find(n => n.children.length===0 && /^Download$/i.test((n.textContent||"").trim()));
    return el?.parentElement?.innerText?.replace(/\s+/g," ").slice(0,40) ?? "?";
  });
  console.log("progress ~ Download tile:", dl);
}
// find the richest svg on the page and describe it
const info = await page.evaluate(() => {
  const svgs = [...document.querySelectorAll("svg")];
  const scored = svgs.map(s => ({ s, n: s.querySelectorAll("path,rect,circle,line,polyline").length }))
                     .sort((a,b)=>b.n-a.n);
  const top = scored.slice(0,3).map(({s,n}) => {
    const c = sel => s.querySelectorAll(sel).length;
    const p = s.querySelector("path");
    return {
      marks: n, viewBox: s.getAttribute("viewBox"),
      counts: { path:c("path"), rect:c("rect"), circle:c("circle"), line:c("line"), polyline:c("polyline"), text:c("text") },
      firstPathD: p?.getAttribute("d")?.slice(0,120) ?? null,
      fill: p ? getComputedStyle(p).fill : null,
      stroke: p ? getComputedStyle(p).stroke : null,
      strokeWidth: p ? getComputedStyle(p).strokeWidth : null,
      nearbyText: (s.closest("div")?.innerText ?? "").replace(/\s+/g," ").slice(0,80),
    };
  });
  return top;
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: `${OUT}/cf-running-full.png`, fullPage: true }).catch(e=>console.log("shot fail"));
console.log("DONE");
process.exit(0);

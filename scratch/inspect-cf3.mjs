import { createRequire } from "node:module";
const require = createRequire("file:///C:/Users/Trevo/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/");
const { chromium } = require("playwright-core");
const OUT = "C:/dev/magna-carta-worktrees/slice-0-7a-design-system/scratch";
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding","--disable-background-timer-throttling"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
// The engine pauses on a hidden page; headless reports hidden. Lie about it.
await page.addInitScript(() => {
  Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
  Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
});
await page.goto("https://speed.cloudflare.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
for (const rx of [/^start$/i, /start/i, /resume/i]) {
  const b = page.getByRole("button", { name: rx }).first();
  if (await b.isVisible().catch(()=>false)) { await b.click().catch(()=>{}); console.log("clicked:", rx.source); break; }
}
// wait until the Download headline shows a number
const ok = await page.waitForFunction(() => /\d/.test(document.body.innerText.match(/Download\s*\n?\s*([^\n]{0,20})/)?.[1] ?? ""), { timeout: 150000 }).then(()=>true).catch(()=>false);
console.log("download number appeared:", ok);
await page.waitForTimeout(45000);
const charts = await page.evaluate(() => {
  const svgs = [...document.querySelectorAll("svg")]
    .filter(s => (s.getAttribute("viewBox") ?? "") !== "0 0 16 16")
    .map(s => ({ s, n: s.querySelectorAll("path,rect,circle,line,polyline").length }))
    .filter(x => x.n >= 3)
    .sort((a,b)=>b.n-a.n).slice(0,2);
  return svgs.map(({s,n}) => {
    const c = sel => s.querySelectorAll(sel).length;
    const paths=[...s.querySelectorAll("path")];
    const lineish = paths.find(p => (getComputedStyle(p).fill==="none") && getComputedStyle(p).stroke!=="none");
    let section=s; for(let i=0;i<6&&section;i++){ if(/Measurements/i.test(section.innerText??"")) break; section=section.parentElement; }
    return { marks:n, viewBox:s.getAttribute("viewBox"),
      counts:{path:c("path"),rect:c("rect"),circle:c("circle"),line:c("line"),polyline:c("polyline"),text:c("text")},
      hasStrokedLinePath: Boolean(lineish),
      lineStroke: lineish?getComputedStyle(lineish).stroke:null,
      lineWidth: lineish?getComputedStyle(lineish).strokeWidth:null,
      lineD: lineish?.getAttribute("d")?.slice(0,150) ?? null,
      section:(section?.innerText??"").replace(/\s+/g," ").slice(0,90) };
  });
});
console.log(JSON.stringify(charts,null,2));
await page.screenshot({ path: `${OUT}/cf-charts-full.png`, fullPage: true }).catch(()=>{});
console.log("DONE"); process.exit(0);

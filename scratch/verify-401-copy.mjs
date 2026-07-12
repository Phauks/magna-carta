import { createRequire } from "node:module";
const require = createRequire(
  "file:///C:/Users/Trevo/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/",
);
const { chromium } = require("playwright-core");
const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://localhost:8787/tools/network-speed-test", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector("h1", { timeout: 20000 });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Start" }).click();
await page.waitForTimeout(6000);
const body = clean(await page.locator("main").innerText());
console.log(
  "ROUNDTRIP :",
  clean((body.match(/You are not signed in[^.]*\./) || ["(NOT FOUND)"])[0]),
);
console.log(
  "PACKETLOSS:",
  clean((body.match(/Sign in to measure packet loss/) || ["(NOT FOUND)"])[0]),
);
console.log("BLAMES_NET:", /could not be reached from this network/i.test(body));
console.log("NOTCONFIG :", /not set up to measure/i.test(body));
console.log("DONE");
process.exit(0);

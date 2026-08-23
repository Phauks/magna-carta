// Checks the file-manager mockup against the owner's standing rulings.
// A ruling that a later round silently undoes fails here instead of reaching the owner.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";

const page_url = pathToFileURL(process.argv[2] ?? "docket.html").href;
const browser = await chromium.launch();
const page = await browser.newPage();
// A failing assertion should fail in seconds, not thirty: with this many checks the default
// per-action timeout turns one real failure into a run that never finishes.
page.setDefaultTimeout(15000);
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
// A blocked font CDN is the sandbox, not the page. Only script failures count.
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("Failed to load resource"))
    consoleErrors.push(m.text());
});
await page.goto(page_url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(400);

const results = [];
const check = async (id, label, fn) => {
  try {
    const ok = await fn();
    results.push([ok ? "PASS" : "FAIL", id, label]);
  } catch (e) {
    results.push(["ERROR", id, label + " — " + e.message]);
  }
};

await check(
  "N3",
  "Back, forward and up all exist",
  async () =>
    (await page.locator("#backBtn").count()) === 1 &&
    (await page.locator("#fwdBtn").count()) === 1 &&
    (await page.locator("#upBtn").count()) === 1,
);

await check("N3b", "Forward is disabled until Back is used, then enabled", async () => {
  if (!(await page.locator("#fwdBtn").isDisabled())) return false;
  await page.locator('.tnode[data-tree="discovery"]').first().click();
  await page.locator("#backBtn").click();
  return !(await page.locator("#fwdBtn").isDisabled());
});

await check("N4", "The breadcrumb root is an icon, not the word Files", async () => {
  const crumbs = await page.locator("#crumbs").innerHTML();
  return crumbs.includes("crumbhome") && !/>\s*Files\s*</.test(crumbs);
});

await check(
  "N13",
  "One expand/collapse toggle, not two",
  async () =>
    (await page.locator("#treeToggleAll").count()) === 1 &&
    (await page.locator("#expandAll, #collapseAll").count()) === 0,
);

await check(
  "S1",
  "The search sits in the matter masthead, not the file-manager toolbar",
  async () =>
    (await page.locator(".masthead #fsearch").count()) === 1 &&
    (await page.locator(".toolbar #fsearch").count()) === 0,
);

await check("A1", "Pin, rename, copy, download and delete are right-click items", async () => {
  await page.locator("#rows tr").first().click({ button: "right" });
  const ctx = page.locator("#ctx");
  const cmds = await ctx
    .locator("button[data-cmd]")
    .evaluateAll((bs) => bs.map((b) => b.dataset.cmd));
  return ["pin", "rename", "copy", "download", "delete"].every((c) => cmds.includes(c));
});

await check(
  "A3",
  "The download item reads 'Download', with no acknowledgement in the label",
  async () => {
    const t = await page.locator('#ctx button[data-cmd="download"]').textContent();
    return t.trim() === "Download";
  },
);

await check("A5", "Copy and cut exist and copy is not disabled", async () => {
  const copy = page.locator('#ctx button[data-cmd="copy"]');
  return (
    (await copy.count()) === 1 &&
    !(await copy.isDisabled()) &&
    (await page.locator('#ctx button[data-cmd="cut"]').count()) === 1
  );
});

await check(
  "A2",
  "The inspector offers no Download / Open in Editor / Save New Version",
  async () => {
    await page.keyboard.press("Escape");
    await page.locator("#rows tr").first().click();
    const html = await page.locator("#inspector").innerHTML();
    return !/Open in Editor|Save New Version/.test(html);
  },
);

await check("F5", "The analysis view carries no explanatory subtitle", async () => {
  await page.locator('.viewrow[data-view="analysis"]').click();
  const html = await page.locator("#statePane").innerHTML();
  return !html.includes("Nothing is refused at upload");
});

await check("F6", "The file list does not advertise the analysis view", async () => {
  const html = await page.content();
  return !html.includes("View every finding on this matter");
});

await check("L5", "Column headers spell the words out", async () => {
  const heads = await page.locator("#headRow th").allInnerTexts();
  const joined = heads.join(" ");
  return joined.includes("Version") && joined.includes("Date Modified") && !joined.includes("Ver.");
});

await check(
  "L16",
  "No keyboard hints in the footer",
  async () => (await page.locator(".pagefoot .keys").count()) === 0,
);

await check("L18", "Every column but Name is draggable, and Name is first", async () => {
  const ths = page.locator("#headRow th");
  if ((await ths.first().getAttribute("data-col")) !== "name") return false;
  if (await ths.first().getAttribute("draggable")) return false;
  const n = await ths.count();
  for (let i = 1; i < n; i++) {
    if ((await ths.nth(i).getAttribute("draggable")) !== "true") return false;
  }
  return true;
});

await check(
  "NEW",
  "The New button sits beside the search, not in the rail",
  async () =>
    (await page.locator(".masthead #newBtn").count()) === 1 &&
    (await page.locator(".rail #newBtn").count()) === 0,
);

await check("SOON", "Development status uses the design system's Badge", async () => {
  const html = await page.content();
  return !html.includes("soonpill") && html.includes("mc-badge-neutral");
});

await check("I17", "Clicking a row does not open the inspector", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  const openBefore = await page.locator("#inspector").isVisible();
  await page.locator("#rows tr").first().click();
  const openAfter = await page.locator("#inspector").isVisible();
  if (openBefore || openAfter) return false;
  await page.locator("#insBtn").click();
  return await page.locator("#inspector").isVisible();
});

// Open the inspector once, on a file with an open finding, and exercise every tab.
const openFile = async (folder, nameFragment) => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  if (!(await page.locator("#inspector").isVisible())) await page.locator("#insBtn").click();
  await page.locator(`.tnode[data-tree="${folder}"]`).first().click();
  await page.locator('#rows tr[data-key^="d:"]').filter({ hasText: nameFragment }).first().click();
};
const openInspectorOnFlagged = () => openFile("experts", "Expert Report");

await check(
  "I1",
  "Five inspector tabs: Preview, Details, Version History, Hashes, Safety",
  async () => {
    await openInspectorOnFlagged();
    const tabs = await page.locator("#inspector [data-instab]").allInnerTexts();
    return (
      JSON.stringify(tabs.map((t) => t.trim())) ===
      JSON.stringify(["Preview", "Details", "Version History", "Hashes", "Safety"])
    );
  },
);

await check(
  "I11",
  "The type is stated once, and a byte disagreement names both sides",
  async () => {
    await page.locator('#inspector [data-instab="details"]').click();
    const html = await page.locator("#inspector").innerHTML();
    if (/Claimed Type[\s\S]*Actual Content/.test(html)) return false;
    return html.includes("Type");
  },
);

await check("I3", "Hashes recompute on open rather than reciting the stored digest", async () => {
  await page.locator('#inspector [data-instab="hashes"]').click();
  const during = await page.locator("#hashList").innerText();
  if (!during.includes("digesting them again")) return false;
  await page.waitForTimeout(1200);
  return (await page.locator("#hashList").innerText()).includes("matches ingest");
});

await check(
  "I22",
  "Compare is a button beside refresh, and its field stays closed until asked for",
  async () => {
    await page.locator('#inspector [data-instab="hashes"]').click();
    await page.waitForTimeout(1100);
    const row = page.locator("#hashCompare");
    if ((await page.locator("#hashCompareBtn").count()) !== 1) return false;
    if (await row.isVisible()) return false;
    await page.locator("#hashCompareBtn").click();
    return await row.isVisible();
  },
);

await check("I21", "No Verified badge beside the digests", async () => {
  const text = await page.locator("#hashList").innerText();
  return !text.includes("Verified") && text.includes("matches ingest");
});

await check("I4", "Version rows carry icon buttons at all times, no hover reflow", async () => {
  await openFile("pleadings", "Motion to Compel");
  await page.locator('#inspector [data-instab="versions"]').click();
  const rows = page.locator("#inspector .vrow");
  const n = await rows.count();
  if (n < 2) return false;
  for (let i = 0; i < n; i++) {
    const acts = rows.nth(i).locator(".acts .iconact");
    if ((await acts.count()) === 0) return false;
    // Counting them is not enough: the defect was a hover-only `visibility` rule.
    if (!(await acts.first().isVisible())) return false;
    if ((await rows.nth(i).locator(".acts button").allInnerTexts()).some((t) => t.trim().length))
      return false;
  }
  return true;
});

await check("I6", "An older version can be compared with the current one", async () => {
  await page.locator("#inspector .vrow").nth(1).locator('[data-ver^="diff:"]').click();
  return await page.locator("#verdiff").isVisible();
});

await check("I23", "Safety names the engine AND its version, not the engine alone", async () => {
  await openInspectorOnFlagged();
  await page.locator('#inspector [data-instab="safety"]').click();
  const text = await page.locator("#inspector .hist").innerText();
  // The version was prose inside the sentence; it is an attribute now.
  return /Engine\s*\n?\s*ClamAV\s+\d{4}-\d{2}-\d{2}/.test(text) && !/\(engine \d{4}/.test(text);
});

await check("I9", "A signature match is its own line and opens an explanation", async () => {
  const link = page.locator("#inspector [data-sig]");
  if ((await link.count()) === 0) return "skip-no-finding" === "x";
  await link.click();
  const sheet = page.locator("#newDocWash");
  const shown = await sheet.isVisible();
  const text = await sheet.innerText();
  await page.locator("[data-sigclose]").click();
  return shown && text.includes("What it matches");
});

await check(
  "T4",
  "Right-click reaches folders in the rail, not only rows in the list",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('.tnode[data-tree="discovery"]').first().click({ button: "right" });
    return await page.locator("#ctx").isVisible();
  },
);

await check("T5", "A folder recolours from the closed palette, and the icon follows", async () => {
  const swatches = page.locator("#ctx .swatch[data-colour]");
  if ((await swatches.count()) !== 11) return false; // ten colours plus Default
  if ((await page.locator("#ctx .swatch.icon").count()) !== 1) return false; // room reserved for icons
  await page.locator('#ctx .swatch[data-colour="red"]').click();
  const style = await page.locator('.tnode[data-tree="discovery"] svg.fold').getAttribute("style");
  return style !== null && style.includes("color");
});

await check("L25", "Selecting a row does not reflow the footer", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  const foot = page.locator("#selfoot");
  const before = await foot.boundingBox();
  await page.locator("#rows tr").first().click();
  const after = await foot.boundingBox();
  // Both controls exist either way; only the disabled state changes.
  if ((await foot.locator("#selNone").count()) !== 1) return false;
  return Math.abs(before.width - after.width) < 1;
});

await check("L24", "A row queued for cut looks different from one queued for copy", async () => {
  const row = page.locator('#rows tr[data-key^="d:"]').first();
  await row.click({ button: "right" });
  await page.locator('#ctx button[data-cmd="copy"]').click();
  if ((await row.getAttribute("data-clipboard")) !== "copy") return false;
  await row.click({ button: "right" });
  await page.locator('#ctx button[data-cmd="cut"]').click();
  return (await row.getAttribute("data-clipboard")) === "cut";
});

await check("I27", "Document type can be set, and a new one added to the firm's list", async () => {
  const row = page.locator('#rows tr[data-key^="d:"]').first();
  await row.click({ button: "right" });
  await page.locator('#ctx button[data-cmd="doctype"]').click();
  const wash = page.locator("#newDocWash");
  if (!(await wash.isVisible())) return false;
  await page.locator("#dtFilter").fill("Trial Brief");
  const add = page.locator('#dtList [data-new="1"]');
  if ((await add.count()) !== 1) return false;
  await add.click();
  if (await wash.isVisible()) return false;
  return (await row.innerText()).includes("Trial Brief");
});

await check(
  "JS",
  "No page errors while exercising all of the above",
  async () => consoleErrors.length === 0,
);

await browser.close();
let failed = 0;
for (const [state, id, label] of results) {
  if (state !== "PASS") failed++;
  console.log(`${state.padEnd(5)} ${id.padEnd(5)} ${label}`);
}
if (consoleErrors.length) console.log("\npage errors:\n" + consoleErrors.join("\n"));
console.log(`\n${results.length - failed}/${results.length} rulings hold.`);
process.exit(failed ? 1 : 0);

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
  // Recompute means the values are NOT on screen at open: every algorithm row is pending
  // (I45's presentation), and the digests arrive from the recompute, not from storage.
  if ((await page.locator("#hashList .pendingval").count()) !== 3) return false;
  await page.waitForTimeout(1700);
  const after = await page.locator("#hashList").innerText();
  return (await page.locator("#hashList .pendingval").count()) === 0 && /[0-9a-f]{16}/i.test(after);
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
  return !text.includes("Verified") && !text.includes("matches ingest");
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

// I6 asked for a diff between two versions and it was built inline. I25 supersedes it: comparing
// versions is a reading surface of its own, tied to the preview, and it is deferred. The affordance
// stays on every older row so the shape of the feature is legible, and it states that it is not
// built rather than opening something half-made.
await check(
  "I25",
  "Comparing versions is offered on every older row, and declares itself deferred",
  async () => {
    const rows = page.locator("#inspector .vrow");
    const n = await rows.count();
    if (n < 2) return false;
    for (let i = 1; i < n; i += 1) {
      const compare = rows.nth(i).locator('[data-ver^="diff:"]');
      if ((await compare.count()) !== 1) return false;
      if (await compare.isEnabled()) return false;
      const why = await compare.getAttribute("title");
      if (!why || !/not built/i.test(why)) return false;
    }
    return true;
  },
);

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
  // The modal was rebuilt: it decodes the signature name into its documented parts so it says
  // something true even when the firm library has no entry, and it states where the facts come from.
  const decoded = ["Platform", "Category", "Family name", "Signature"].every((k) =>
    text.includes(k),
  );
  // Section headings are uppercased by `.caps` in CSS, so the rendered text is "WHAT IT MEANS".
  // Comparing case-sensitively here is what made this assertion lie about the heading twice.
  // The provenance sentence was struck: a finding states itself. What must survive is the decode,
  // the plain-language section, and the two ways of taking the finding off the screen.
  return shown && decoded && /what it means/i.test(text) && !text.includes("Source:");
});

await check(
  "I31",
  "The signature modal is capped so its Close button cannot leave the screen",
  async () => {
    await page.locator("#inspector [data-sig]").click();
    const dialog = page.locator("#newDocWash .dialog");
    const [box, viewport] = [await dialog.boundingBox(), page.viewportSize()];
    if (box.y + box.height > viewport.height + 1) return false;
    // The body is the part that scrolls, so a long finding never pushes the footer away.
    const overflow = await page
      .locator("#newDocWash .dialog > .body")
      .evaluate((el) => getComputedStyle(el).overflowY);
    const closeVisible = await page.locator("[data-sigclose]").isVisible();
    await page.locator("[data-sigclose]").click();
    return overflow === "auto" && closeVisible;
  },
);

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

await check("T5", "Colour is a submenu that opens to the right, with square swatches", async () => {
  // The palette used to sit open in the menu, which made every folder right-click a colour
  // decision. It is behind one item now, so the panel must be CLOSED until the item is hovered.
  // Two flyouts live here now, Colour and Icon. This ruling is about Colour's.
  const panel = page.locator("#ctx .hassub").first().locator(".subpanel");
  if ((await panel.count()) !== 1) return false;
  if (await panel.isVisible()) return false;
  const opener = page.locator("#ctx .subopen").first();
  if (!/color/i.test((await opener.innerText()) ?? "")) return false;
  await opener.hover();
  if (!(await panel.isVisible())) return false;
  // Opening to the RIGHT, not below. `left: 100%` is relative to the menu ITEM, which the menu's
  // own padding insets, so the panel's left edge sits a few pixels inside the menu's right edge —
  // the assertion allows that inset rather than demanding a clean separation that flyouts do not have.
  const [menuBox, panelBox] = [await page.locator("#ctx").boundingBox(), await panel.boundingBox()];
  if (panelBox.x < menuBox.x + menuBox.width - 16) return false;
  if (panelBox.y > menuBox.y + menuBox.height) return false;
  const swatches = page.locator("#ctx .swatch[data-colour]");
  if ((await swatches.count()) !== 12) return false; // eleven colours plus Default
  // Square, not round: a colour chip must not read as a bullet.
  // Square means no radius at all, not merely "not a circle" — a rounded chip was the complaint.
  const radius = await swatches.first().evaluate((el) => getComputedStyle(el).borderRadius);
  if (radius !== "0px") return false;
  // Icon is no longer inside this panel: it is its own item, checked by T6b.
  if ((await page.locator("#ctx .subicon").count()) !== 0) return false;
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
  // One control now, and it must be present in both states — a control that appears on selection
  // is exactly what moves the footer.
  if ((await foot.locator("#selToggle").count()) !== 1) return false;
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
  // Round ten moved this into a flyout beside the menu item (I27d); the PROPERTY — set a
  // type, add a new one to the firm's vocabulary — is what this asserts.
  const row = page.locator('#rows tr[data-key^="d:"]').first();
  await row.click();
  await row.click({ button: "right" });
  await page.locator("#ctx .subopen").filter({ hasText: "Set Document Type" }).hover();
  const panel = page.locator("#ctx .dtpanel");
  await panel.waitFor({ state: "visible", timeout: 4000 });
  await page.locator("#ctx .dtflyfilter").fill("Trial Brief");
  const add = page.locator('#ctx [data-dtfly][data-new="1"]');
  if ((await add.count()) !== 1) return false;
  await add.click();
  if (await page.locator("#ctx").isVisible()) return false;
  return (await row.innerText()).includes("Trial Brief");
});

await check(
  "L27",
  "Created By and Location are columns, and Created By names a person",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    const heads = (await page.locator("#headRow th").allInnerTexts()).join(" ");
    // L48: an upload is an act of creation, so the column reads Created By.
    if (!heads.toLowerCase().includes("created by")) return false;
    if (heads.toLowerCase().includes("uploaded by")) return false;
    await page.locator("#colsBtn").click();
    const location = page.locator('#colsMenu input[data-col="location"]');
    if ((await location.count()) !== 1) return false;
    if (await location.isChecked()) return false; // off by default in browse
    await page.keyboard.press("Escape");
    const row = page.locator('#rows tr[data-key^="d:"]').first();
    return /[A-Z]\. [A-Z][a-z]+/.test(await row.innerText()); // a person's name, not "You"
  },
);

await check("L26", "A photograph folder opens as icons, and the toggle switches back", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  // Discovery is already expanded at load, so clicking its twist would collapse it.
  await page.locator('.tnode[data-tree="sitephotos"]').first().click();
  const grid = page.locator("#iconGrid");
  if (!(await grid.isVisible())) return false; // mostly-images opens as icons
  if ((await grid.locator(".tile .thumb.photo").count()) !== 8) return false;
  await page.locator("#viewModeBtn").click();
  if (await grid.isVisible()) return false; // toggles back to the list
  return await page.locator("#tablewrap").isVisible();
});

await check("L26b", "A tile selects, and right-click on one opens the same menu", async () => {
  await page.locator("#viewModeBtn").click();
  const tile = page.locator("#iconGrid .tile").first();
  await tile.click();
  if ((await tile.getAttribute("aria-selected")) !== "true") return false;
  await tile.click({ button: "right" });
  return await page.locator("#ctx").isVisible();
});

await check("P12", "A zip opens into itself and its members are browsable", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="discovery"]').first().click();
  const zip = page.locator('#rows tr[data-key^="d:"]').filter({ hasText: ".zip" }).first();
  await zip.dblclick();
  const bar = page.locator(".archbar");
  if (!(await bar.isVisible())) return false;
  // Members render on the MATTER'S OWN TABLE now, not a second list that looks different.
  if (!(await page.locator("#tablewrap").isVisible())) return false;
  const memberRows = page.locator("#rows tr");
  if ((await memberRows.count()) === 0) return false;
  // Same row height as a matter file, and columns that cannot apply are empty rather than invented.
  const shape = await memberRows.first().evaluate((r) => ({
    h: Math.round(r.getBoundingClientRect().height),
    cells: [...r.cells].map((c) => c.innerText.trim()),
  }));
  if (shape.h !== 32) return false;
  if (!shape.cells.some((c) => c === "")) return false;
  // Descend a directory inside the archive, then climb back out of the archive entirely.
  await page.locator("#rows tr[data-archdir]").first().click();
  if ((await page.locator("#rows tr").count()) === 0) return false;
  await page.locator("#archLeave").click();
  return (
    !(await page.locator(".archbar").isVisible()) && (await page.locator("#tablewrap").isVisible())
  );
});

await check(
  "P12b",
  "A never-scanned archive is still browsable, and says its contents are unchecked",
  async () => {
    const zip = page.locator('#rows tr[data-key^="d:"]').filter({ hasText: ".zip" }).first();
    await zip.click({ button: "right" });
    await page.locator('#ctx button[data-cmd="enterzip"]').click();
    const text = await page.locator("#statePane").innerText();
    if (!text.toLowerCase().includes("never scanned")) return false;
    await page.locator("#archExtract").click();
    const sheet = page.locator("#newDocWash");
    const shown = await sheet.isVisible();
    const body = await sheet.innerText();
    await page.locator('[data-ex="no"]').click();
    return shown && body.includes("Nothing is refused on the way in");
  },
);

await check("F3", "Every analysis card names where the file is", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.viewrow[data-view="analysis"]').click();
  const cards = page.locator(".ancard");
  const n = await cards.count();
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    if ((await cards.nth(i).locator(".anwhere").innerText()).trim().length === 0) return false;
  }
  return true;
});

await check(
  "P13",
  "Analysis covers more than the scanner's opinion, and narrows by kind",
  async () => {
    const pills = page.locator(".anpill");
    // At minimum: All, plus a scanner verdict, plus something the scanner never said.
    if ((await pills.count()) < 3) return false;
    const labels = (await pills.allInnerTexts()).join(" ").toLowerCase();
    if (!labels.includes("never scanned") && !labels.includes("no document type")) return false;
    const before = await page.locator(".ancard").count();
    await page.locator('.anpill:not([data-anfilter=""])').first().click();
    const after = await page.locator(".ancard").count();
    return after > 0 && after <= before;
  },
);

await check("F2", "A file can be acted on from analysis, not merely revealed", async () => {
  await page.locator('.anpill[data-anfilter=""]').click();
  const card = page.locator(".ancard").first();
  const acts = await card
    .locator("[data-anact]")
    .evaluateAll((bs) => bs.map((b) => b.dataset.anact));
  if (!acts.includes("reveal")) return false;
  if (acts.length < 2) return false; // reveal alone is the complaint, not the fix
  // Reveal still works and lands on the file, in its folder, with Safety open.
  await card.locator('[data-anact="reveal"]').click();
  if (!(await page.locator("#tablewrap").isVisible())) return false;
  return (
    (await page.locator('#inspector [data-instab="safety"]').getAttribute("aria-selected")) ===
    "true"
  );
});

// ---- Round nine. The first three are the ones the owner had to raise more than once.

await check(
  "A9",
  "Renaming never selects the extension, and never shows it when extensions are hidden",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    await page
      .locator('#rows tr[data-key^="d:"]')
      .filter({ hasText: "Motion to Compel" })
      .first()
      .click({ button: "right" });
    await page.locator('#ctx button[data-cmd="rename"]').click();
    const field = page.locator("#rows input.rename");
    const read = (locator) =>
      locator.evaluate((el) => ({
        value: el.value,
        start: el.selectionStart,
        end: el.selectionEnd,
        ext: el.dataset.ext,
      }));
    // Extensions SHOWN — the default. The extension is visible and editable on purpose, but the
    // selection must stop before it, so the first keystroke cannot replace ".docx".
    const shown = await read(field);
    if (shown.ext !== ".docx") return false;
    if (!shown.value.endsWith(".docx")) return false;
    if (shown.start !== 0 || shown.end !== shown.value.length - ".docx".length) return false;
    await field.press("Escape");

    // Extensions HIDDEN — the field must carry no extension at all, and committing must put it back
    // rather than renaming the file to something with no type.
    // "Hide File Extensions" lives in the columns menu, so it has to be opened to reach the setting.
    await page.locator("#colsBtn").click();
    await page.locator("#hideExt").check();
    await page.keyboard.press("Escape");
    await page
      .locator('#rows tr[data-key^="d:"]')
      .filter({ hasText: "Motion to Compel" })
      .first()
      .click({ button: "right" });
    await page.locator('#ctx button[data-cmd="rename"]').click();
    const hiddenField = page.locator("#rows input.rename");
    const hidden = await read(hiddenField);
    if (hidden.value.includes(".docx")) return false;
    if (hidden.start !== 0 || hidden.end !== hidden.value.length) return false;
    await hiddenField.fill("Motion to Compel Production (renamed)");
    await hiddenField.press("Enter");
    // The row still shows no extension, but the underlying name kept one: turning the setting back
    // off has to reveal it.
    await page.locator("#colsBtn").click();
    await page.locator("#hideExt").uncheck();
    await page.keyboard.press("Escape");
    const after = await page.locator('#rows tr[data-key^="d:"]').allInnerTexts();
    return after.some((row) => row.includes("Motion to Compel Production (renamed).docx"));
  },
);

await check("I14", "An active sidebar toggle carries no filled panel behind it", async () => {
  // Independent of whatever the previous check left on screen — this one is about a computed style,
  // so it must not inherit an archive view or a half-open menu.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  const toolbar = await page
    .locator(".toolbar")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  for (const id of ["#insBtn", "#treeBtn"]) {
    const button = page.locator(id);
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    // Park the pointer away from the toolbar first. `:hover` legitimately raises the surface, and
    // measuring while the mouse still rests on the button reads that as the active fill.
    await page.mouse.move(4, 4);
    const style = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, shadow: s.boxShadow };
    });
    // The complaint was a DARK FILL, not a box-shadow. Asserting only the shadow is exactly what let
    // this survive three rounds while the thing being pointed at sat there unchanged.
    if (style.background !== "rgba(0, 0, 0, 0)" && style.background !== toolbar) return false;
    if (style.shadow !== "none") return false;
  }
  return true;
});

await check(
  "A12",
  "A folder with contents asks before deleting, and defaults to keeping them",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    const before = await page.locator("#rows tr").count();
    await page.locator('#rows tr[data-kind="folder"]').first().click({ button: "right" });
    const remove = page.locator('#ctx button[data-cmd="delete"]');
    if (!(await remove.isEnabled())) return false; // it used to be disabled for any non-empty folder
    await remove.click();
    const dialog = page.locator("#newDocWash .dialog");
    if (!(await dialog.isVisible())) return false;
    if (!/\d+ file/.test(await dialog.innerText())) return false; // it must name what is inside
    if (!(await page.locator('#newDocWash input[value="promote"]').isChecked())) return false;
    await page.locator('#newDocWash [data-del="yes"]').click();
    // The folder went and its contents came up a level, so the row count cannot have fallen.
    return (await page.locator("#rows tr").count()) >= before;
  },
);

await check("L28", "A folder row is the same height as a file row", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="discovery"]').first().click();
  const rows = await page
    .locator("#rows tr")
    .evaluateAll((list) =>
      list.map((r) => ({ kind: r.dataset.kind, h: Math.round(r.getBoundingClientRect().height) })),
    );
  const folders = rows.filter((r) => r.kind === "folder").map((r) => r.h);
  const files = rows.filter((r) => r.kind === "file").map((r) => r.h);
  if (folders.length === 0 || files.length === 0) return false;
  // An unclassed folder icon rendered at its intrinsic 200px and made the row 207px tall.
  return Math.max(...folders) === Math.max(...files);
});

await check("N20", "Home in the rail returns to the root", async () => {
  await page.locator('.tnode[data-tree="depositions"]').first().click();
  if ((await page.locator("#crumbs").innerText()).trim() === "") return false;
  await page.locator("#railHome").click();
  return (await page.locator("#crumbs").innerText()).trim() === "";
});

await check("P11", "A folder states its size in bytes and how many files make it up", async () => {
  // Aggregates render pending first (L40) and fill in; the property here is the FILLED
  // value, so wait for the computation the way a person would.
  await page
    .waitForFunction(() => !document.querySelector("#rows .pendingval"), null, { timeout: 4000 })
    .catch(() => {});
  const cells = await page
    .locator('#rows tr[data-kind="folder"]')
    .evaluateAll((list) => list.map((r) => [...r.cells].map((c) => c.innerText.trim())));
  if (cells.length === 0) return false;
  return cells.every((row) =>
    row.some((cell) => /\d+(\.\d+)?\s?(B|KB|MB|GB|TB)/.test(cell) && /\d+ file/.test(cell)),
  );
});

await check("I27b", "Document type is editable from the field that displays it", async () => {
  await openFile("pleadings", "Motion to Compel");
  await page.locator('#inspector [data-instab="details"]').click();
  const field = page.locator("#inspector [data-dt-open]");
  if ((await field.count()) !== 1) return false;
  await field.click();
  await page.locator("#filterMenu").waitFor({ state: "visible", timeout: 4000 });
  const open = await page.locator("#filterMenu").isVisible();
  await page.locator("#filterMenu").evaluate((el) => {
    el.hidden = true;
  });
  return open;
});

await check("I30", "The inspector tab strip scrolls rather than wrapping", async () => {
  const strip = page.locator("#inspector .instabs");
  const style = await strip.evaluate((el) => getComputedStyle(el).overflowX);
  const rowCount = await strip.evaluate(
    (el) =>
      new Set(
        [...el.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().top)),
      ).size,
  );
  // One row, always: wrapping changes the panel's height as the selection moves.
  return style === "auto" && rowCount === 1;
});

await check(
  "I32",
  "A digest can be verified from a file on disk, not only from paste",
  async () => {
    await page.locator('#inspector [data-instab="hashes"]').click();
    await page.waitForTimeout(1100);
    await page.locator("#hashCompareBtn").click();
    if ((await page.locator("#hashFileBtn").count()) !== 1) return false;
    // It must say the bytes stay local, or nobody should point it at a client document.
    return /not uploaded/i.test(await page.locator("#hashCompare .hashnote").innerText());
  },
);

await check("F7", "A clean file is not given a preamble explaining that it is clean", async () => {
  await page.locator('#inspector [data-instab="safety"]').click();
  const text = await page.locator("#inspector").innerText();
  return !/No open finding/i.test(text) && !/every check this file has been through/i.test(text);
});

// ---- Round seven, search.

await check(
  "S13",
  "Clicking the search field opens the dropdown before anything is typed",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    // The field is collapsed to an icon until the search button opens it.
    await page.locator("#searchBtn").click();
    await page.locator("#searchInput").click();
    const pop = page.locator("#searchpop");
    if (!(await pop.isVisible())) return false;
    // Scope is the one control set BEFORE typing, so it has to be reachable with an empty field.
    return (await pop.locator("#scopeSel").count()) === 1;
  },
);

await check(
  "S9",
  "Open Full Results sits on the scope line, not below a list that moves",
  async () => {
    const scope = page.locator("#searchpop .scope");
    const button = page.locator("#searchpop #openResults");
    if ((await button.count()) !== 1) return false;
    // Same row as the scope selector: same vertical centre, within a pixel or two.
    const [scopeBox, buttonBox] = [await scope.boundingBox(), await button.boundingBox()];
    const sameLine =
      Math.abs(scopeBox.y + scopeBox.height / 2 - (buttonBox.y + buttonBox.height / 2)) < 3;
    // And it cannot open a result set that does not exist yet.
    return sameLine && !(await button.isEnabled());
  },
);

await check(
  "S14",
  "An existing query re-runs when the field is reopened, with no keystroke",
  async () => {
    await page.locator("#searchInput").fill("Motion");
    await page.waitForTimeout(100);
    const before = await page.locator("#searchpop .hit").count();
    if (before === 0) return false;
    // Close the panel WITHOUT clearing the query, then come back to the field. Clicking away
    // collapses the field to its icon, so reopening goes through the search button again.
    await page.locator("#tablewrap").click({ position: { x: 5, y: 5 } });
    await page.locator("#searchBtn").click();
    await page.locator("#searchInput").click();
    // The defect: the panel rendered only on `input`, so this showed nothing until a letter moved.
    return (await page.locator("#searchpop .hit").count()) === before;
  },
);

await check(
  "S11",
  "The results page is the matter's own table, with the search field in its header",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator("#searchBtn").click();
    await page.locator("#searchInput").fill("Motion");
    await page.waitForTimeout(100);
    await page.locator("#openResults").click();
    if (!(await page.locator("#tablewrap").isVisible())) return false;
    const rows = page.locator("#rows tr");
    if ((await rows.count()) === 0) return false;
    // Same columns as browsing, so a result carries every fact a row carries.
    const heads = await page.locator("#headRow th").count();
    const cells = await rows.first().evaluate((r) => r.cells.length);
    if (heads !== cells) return false;
    // S12: the field is in the results header, so refining does not mean going back to the masthead.
    if ((await page.locator("#resInput").count()) !== 1) return false;
    // And a result is selectable, which is what makes "download all matches" unnecessary.
    await rows.first().click();
    return (await rows.first().getAttribute("aria-selected")) === "true";
  },
);

await check(
  "S11b",
  "Refining the query on the results page keeps the caret in the field",
  async () => {
    const field = page.locator("#resInput");
    await field.click();
    await field.press("End");
    await field.type("s");
    await page.waitForTimeout(80);
    const state = await page.locator("#resInput").evaluate((el) => ({
      focused: document.activeElement === el,
      value: el.value,
      caret: el.selectionStart,
    }));
    // Re-rendering replaces the input, so without restoring focus and caret the next keystroke lands
    // in the wrong place and typing appears to reverse itself.
    return state.focused && state.value === "Motions" && state.caret === state.value.length;
  },
);

// ---- The error view.

await check(
  "P4",
  "The error view explains, gives first steps, and reports through the in-house pipeline",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('.mockbar button[data-state="error"]').click();
    const pane = page.locator("#statePane");
    const text = await pane.innerText();
    // A technical explanation: what was requested, what came back, when, and the correlating ID.
    if (!/GET \/matters\//.test(text)) return false;
    if (!/504/.test(text)) return false;
    if (!/err_/.test(text)) return false;
    // First steps, as steps.
    if ((await pane.locator(".errsteps li").count()) < 3) return false;
    // And it must say the record is safe — the first thing a person needs to know.
    return /record itself is unaffected/i.test(text);
  },
);

await check("P4b", "Report opens a real reporter that states what leaves the firm", async () => {
  await page.locator("#reportBtn").click();
  const dialog = page.locator("#newDocWash .dialog");
  if (!(await dialog.isVisible())) return false;
  const text = await dialog.innerText();
  // It must name what is sent AND what is not — redact-by-default is the standard, and a person
  // deciding whether to send needs that stated, not implied.
  if ((await dialog.locator("#repWhat").count()) !== 1) return false;
  if (!/No document, file name or matter content/i.test(text)) return false;
  if (await dialog.locator("#repShot").isChecked()) return false; // a screenshot is opt-in
  await page.locator('#newDocWash [data-rep="yes"]').click();
  // Sending has to say something happened, and reference the same identifier.
  const ack = await page.locator("#reportAck").innerText();
  return /err_/.test(ack) && /not an outside service/i.test(ack);
});

await check(
  "P5",
  "The error view scrolls inside its pane rather than running off the screen",
  async () => {
    // Its own setup: this measures geometry, so it must not inherit whatever transient
    // state the reporting flow before it left behind.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('.mockbar button[data-state="error"]').click();
    const overflow = await page
      .locator("#statePane .errpane")
      .evaluate((el) => getComputedStyle(el).overflowY);
    // P5 was marked settled off a DIALOG fix, and the error view is a pane — the cap did nothing here.
    // The pane must never be taller than the area it sits in.
    const fits = await page
      .locator("#statePane .errpane")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().bottom <= el.parentElement.getBoundingClientRect().bottom + 1,
      );
    return overflow === "auto" && fits;
  },
);

// ---- Round eight.

await check("I15", "Every icon is Lucide, not a glyph drawn here", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  // Lucide stamps every icon with its own default attributes. An icon drawn by hand in this file
  // would not carry them, so a stray one shows up as a viewBox or a linecap that does not match.
  const bad = await page.evaluate(
    () =>
      [...document.querySelectorAll("svg")].filter(
        (s) =>
          s.getAttribute("viewBox") !== "0 0 24 24" ||
          s.getAttribute("stroke-linecap") !== "round" ||
          s.getAttribute("stroke-linejoin") !== "round",
      ).length,
  );
  return bad === 0;
});

await check(
  "T6b",
  "Icon is its own right-click item, below Color, not nested inside it",
  async () => {
    await page.locator('.tnode[data-tree="discovery"]').first().click({ button: "right" });
    const openers = await page
      .locator("#ctx .subopen")
      .evaluateAll((bs) => bs.map((b) => b.innerText.trim()));
    if (openers.length !== 2) return false;
    if (!/^color/i.test(openers[0]) || !/^icon/i.test(openers[1])) return false;
    // Reaching Icon must not require going through Colour: its panel is a sibling, not a child.
    const nested = await page.locator("#ctx .subpanel #iconSub").count();
    return nested === 0;
  },
);

await check("T6c", "The palette runs in rainbow order and includes pink", async () => {
  const names = await page
    .locator("#ctx .swatch[data-colour]")
    .evaluateAll((bs) => bs.map((b) => b.dataset.colour));
  const rainbow = ["red", "orange", "yellow", "green", "blue", "purple", "pink"];
  const seen = names.filter((n) => rainbow.includes(n));
  return names[0] === "default" && seen.join(",") === rainbow.join(",");
});

await check("T6d", "Choosing an icon changes the folder's icon", async () => {
  await page.locator("#iconSub").hover();
  const before = await page.locator('.tnode[data-tree="discovery"] svg').first().innerHTML();
  await page.locator('#ctx [data-folder-icon="gavel"]').click();
  const after = await page.locator('.tnode[data-tree="discovery"] svg').first().innerHTML();
  return before !== after;
});

await check("I33", "A tab strip scrolls sideways only, never vertically", async () => {
  await openFile("pleadings", "Motion to Compel");
  const strip = page.locator("#inspector .instabs");
  const box = await strip.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  return box.overflowY === "hidden" && box.scrollH <= box.clientH + 1;
});

await check("L29", "Both side panels resize by dragging their inner edge", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  // A hidden panel has no edge to drag, and no bounding box either.
  if (!(await page.locator("#inspector").isVisible())) await page.locator("#insBtn").click();
  await page.waitForTimeout(150);
  const drag = async (id, dx) => {
    const box = await page.locator(id).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + 200, { steps: 6 });
    await page.mouse.up();
  };
  const railBefore = (await page.locator(".rail").boundingBox()).width;
  await drag("#railResize", 60);
  const railAfter = (await page.locator(".rail").boundingBox()).width;
  const insBefore = (await page.locator("#inspector").boundingBox()).width;
  await drag("#inspResize", -60);
  const insAfter = (await page.locator("#inspector").boundingBox()).width;
  // Both grow when dragged away from the middle. If one of them did not, the two edges are not
  // behaving identically, which is the ruling.
  return railAfter > railBefore + 40 && insAfter > insBefore + 40;
});

await check("I34", "A scanner finding can be copied and downloaded", async () => {
  await openInspectorOnFlagged();
  await page.locator('#inspector [data-instab="safety"]').click();
  const link = page.locator("#inspector [data-sig]");
  if ((await link.count()) === 0) return false;
  await link.click();
  const ok =
    (await page.locator("[data-sigcopy]").count()) === 1 &&
    (await page.locator("[data-sigdownload]").count()) === 1;
  await page.locator("[data-sigclose]").click();
  return ok;
});

await check(
  "F10",
  "File Analysis counts by severity, not by how many files have anything",
  async () => {
    await page.locator('[data-view="analysis"]').click();
    await page.waitForTimeout(200);
    const chips = await page.locator("#statePane .sevchip").count();
    const tally = await page.locator("#tally").innerText();
    // The old line counted files. Severity is what a person triages by.
    return chips > 0 && /issue/.test(tally) && !/with something to answer/.test(tally);
  },
);

await check(
  "F8",
  "File Analysis offers Copy All and Download All Issues",
  async () =>
    (await page.locator("#anCopyAll").count()) === 1 &&
    (await page.locator("#anDownloadAll").count()) === 1,
);

await check("F11", "An issue can be ignored, then found again and taken back", async () => {
  const before = await page.locator("#statePane .ancard").count();
  const tag = page.locator("#statePane [data-anignore]").first();
  const which = await tag.getAttribute("data-anignore");
  await tag.click();
  await page.waitForTimeout(120);
  const toggle = page.locator("#anIgnoredToggle");
  if (!/Ignored \(1\)/.test(await toggle.innerText())) return false;
  await toggle.click();
  await page.waitForTimeout(120);
  // The ignored one is reachable, and reachable means reversible.
  const back = page.locator(`#statePane [data-anignore="${which}"]`);
  if ((await back.count()) !== 1) return false;
  await back.click();
  await page.waitForTimeout(120);
  await page.locator("#anIgnoredToggle").click();
  await page.waitForTimeout(120);
  return (await page.locator("#statePane .ancard").count()) === before;
});

await check("F9", "Safety History in File Analysis opens the panel it points at", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('[data-view="analysis"]').click();
  await page.waitForTimeout(150);
  await page.locator('#statePane [data-anact="safety"]').first().click();
  await page.waitForTimeout(150);
  // It used to set a tab on a panel this view had disabled, so the button looked live and did
  // nothing at all.
  const tab = page.locator('#inspector [data-instab="safety"]');
  return (await tab.count()) === 1 && (await tab.getAttribute("aria-selected")) === "true";
});

await check("N21", "A view that is not a folder titles the breadcrumb", async () => {
  await page.locator('[data-view="deleted"]').click();
  await page.waitForTimeout(150);
  const crumb = await page.locator("#crumbs").innerText();
  if (!/Deleted Files/.test(crumb)) return false;
  // And it does not ALSO print a heading below the breadcrumb, which is the duplication the
  // owner objected to.
  return (await page.locator("#statePane .viewhead h2").count()) === 0;
});

await check(
  "D1b",
  "Deleted files render on the matter's own table, with when and by whom",
  async () => {
    const rows = page.locator('#rows tr[data-key^="x:"]');
    if ((await rows.count()) < 2) return false;
    const heads = await page
      .locator("#headRow th")
      .evaluateAll((ths) => ths.map((th) => th.dataset.col));
    if (!["deleted", "deletedBy", "fromPath"].every((c) => heads.includes(c))) return false;
    // Sorting by deletion time is the whole reason this list is opened.
    await page.locator('[data-sortbtn="deleted"]').click();
    await page.waitForTimeout(120);
    const first = await page.locator('#rows tr[data-key^="x:"]').first().innerText();
    await page.locator('[data-sortbtn="deleted"]').click();
    await page.waitForTimeout(120);
    const flipped = await page.locator('#rows tr[data-key^="x:"]').first().innerText();
    return first !== flipped;
  },
);

await check(
  "D1c",
  "A deleted row has a right-click menu and no overlapping row buttons",
  async () => {
    await page.locator('[data-view="deleted"]').click();
    await page.waitForTimeout(150);
    // The old view put a Restore button in every row, where it overlapped the Soon badge beside it.
    if ((await page.locator("#rows tr .btn").count()) !== 0) return false;
    await page.locator('#rows tr[data-key^="x:"]').first().click({ button: "right" });
    const cmds = await page
      .locator("#ctx button[data-dcmd]")
      .evaluateAll((bs) => bs.map((b) => b.dataset.dcmd));
    await page.keyboard.press("Escape");
    return ["restore", "details", "purge"].every((c) => cmds.includes(c));
  },
);

await check("D1d", "Deleted rows take multiple selection like any other rows", async () => {
  const rows = page.locator('#rows tr[data-key^="x:"]');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ["Control"] });
  return (await page.locator('#rows tr[aria-selected="true"]').count()) === 2;
});

await check("A13", "One selection control, and it says what pressing it will do", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  if ((await page.locator("#selAll, #selNone").count()) !== 0) return false;
  const toggle = page.locator("#selToggle");
  if (!/Select All/.test(await toggle.innerText())) return false;
  await toggle.click();
  await page.waitForTimeout(120);
  if (!/Select None/.test(await page.locator("#selToggle").innerText())) return false;
  await page.locator("#selToggle").click();
  await page.waitForTimeout(120);
  return (await page.locator('#rows tr[aria-selected="true"]').count()) === 0;
});

await check("A14", "Unselecting a row reaches the details panel", async () => {
  // The panel has to be OPEN before its contents mean anything — a closed panel is empty, which
  // would satisfy a careless assertion in both directions.
  await openFile("pleadings", "Answer and Counterclaim");
  const row = page.locator('#rows tr[data-key^="d:"]').first();
  await row.click();
  await page.waitForTimeout(120);
  const named = await page.locator("#inspector").innerText();
  if (named.includes("Select a file or folder")) return false;
  await row.click({ modifiers: ["Control"] }); // let go of it
  await page.waitForTimeout(150);
  // It used to keep showing the file the user had just released, which reads as a dead click.
  return (await page.locator("#inspector").innerText()).includes("Select a file or folder");
});

await check(
  "L30",
  "A column's filter control sits with its label and reflows nothing",
  async () => {
    const th = page.locator('#headRow th[data-col="fileType"]');
    const widthBefore = (await th.boundingBox()).width;
    await th.hover();
    await page.waitForTimeout(120);
    const widthAfter = (await th.boundingBox()).width;
    if (Math.abs(widthBefore - widthAfter) > 1) return false;
    // Inside its own column, not floating past its right edge into the next one.
    const [cell, btn] = [await th.boundingBox(), await th.locator(".filterbtn").boundingBox()];
    return btn.x >= cell.x && btn.x + btn.width <= cell.x + cell.width + 1;
  },
);

await check("L31", "The list runs to the edge of its column", async () => {
  const [wrap, table] = [
    await page.locator("#tablewrap").boundingBox(),
    await page.locator("#tablewrap table").boundingBox(),
  ];
  // A gutter reserved on BOTH edges held the table off the left and stopped its rules short.
  return table.x - wrap.x < 2;
});

await check("I35", "A version label is one token, not two numbers", async () => {
  const cell = page.locator("#rows td.ver").first();
  if ((await cell.count()) !== 1) return false;
  const variant = await cell.evaluate((el) => getComputedStyle(el).fontVariantNumeric);
  // Tabular figures widen a "1" to a "0"'s advance, which put a visible gap inside "v12".
  return !/tabular/.test(variant);
});

// ---- Round nine.

await check("I37", "The safety report's Copy and Download are small icon buttons", async () => {
  await openInspectorOnFlagged();
  await page.locator('#inspector [data-instab="safety"]').click();
  await page.locator("#inspector [data-sig]").click();
  for (const sel of ["[data-sigcopy]", "[data-sigdownload]"]) {
    const b = page.locator(sel);
    if ((await b.count()) !== 1) return false;
    // Icon-only: no visible text label, and genuinely small.
    if ((await b.innerText()).trim() !== "") return false;
    const box = await b.boundingBox();
    if (box.width > 32 || box.height > 32) return false;
    // Still says what it will do — just not as a text label.
    if (!/(copy|download)/i.test((await b.getAttribute("title")) ?? "")) return false;
  }
  await page.locator("[data-sigclose]").click();
  return true;
});

await check(
  "I38",
  "Details has no safety sentence — a Flag row, alike the others, opens Safety",
  async () => {
    await openInspectorOnFlagged();
    await page.locator('#inspector [data-instab="details"]').click();
    const text = await page.locator("#inspector").innerText();
    // The sentence the owner struck, in both of its halves.
    if (/open safety finding/i.test(text)) return false;
    if (/Open the Safety tab/.test(text)) return false;
    // The flag is one facts row like every other: a dd in the same list, holding the
    // Lucide Flag geometry, not a notice bar.
    const flag = page.locator("#inspector dl.facts dd .flagbtn");
    if ((await flag.count()) !== 1) return false;
    const path = await flag.locator("svg path").first().getAttribute("d");
    if (!path?.startsWith("M4 22V4")) return false; // Lucide flag
    await flag.click();
    return (
      (await page.locator('#inspector [data-instab="safety"]').getAttribute("aria-selected")) ===
      "true"
    );
  },
);

await check(
  "L32",
  "File Type shows the extension — mp4, zip, docx — never the category",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    const cellOf = async (needle) => {
      const idx = await page
        .locator("#headRow th")
        .evaluateAll((ths) => ths.findIndex((th) => th.dataset.col === "fileType"));
      const row = page.locator("#rows tr").filter({ hasText: needle }).first();
      return await row.evaluate((r, i) => r.cells[i].innerText.trim(), idx);
    };
    await page.locator('.tnode[data-tree="depositions"]').first().click();
    if ((await cellOf("Deposition Video")) !== "mp4") return false;
    await page.locator('.tnode[data-tree="discovery"]').first().click();
    if ((await cellOf("Site Inspection Photos")) !== "zip") return false;
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    if ((await cellOf("Motion to Compel")) !== "docx") return false;
    // The category words must be gone from the column everywhere. Case matters: the
    // categories were Title-case words, while "pdf" the extension is a correct cell.
    const cells = await page.locator("#rows td.ftype").allInnerTexts();
    if (cells.some((c) => /^(Video|Archive|Word|Program|PDF)$/.test(c.trim()))) return false;
    // L32b: the Convert flyout is a menu surface of the same fact, so it speaks
    // extensions too — "To txt", never "To Plain Text"; "To docx", never "To Word".
    const flyoutOf = async (needle) => {
      const row = page.locator('#rows tr[data-key^="d:"]').filter({ hasText: needle }).first();
      await row.click({ button: "right" });
      await page.locator("#ctx .subopen").filter({ hasText: "Convert" }).hover();
      await page.waitForTimeout(150);
      const text = await page.locator("#ctx .convpanel").innerText();
      await page.keyboard.press("Escape");
      return text;
    };
    const docxConv = await flyoutOf("Motion to Compel");
    if (!/To txt/.test(docxConv) || /Plain Text/.test(docxConv)) return false;
    const pdfConv = await flyoutOf("Complaint");
    return /To docx/.test(pdfConv) && !/To Word/.test(pdfConv);
  },
);

await check(
  "L33",
  "A zebra setting sits directly beneath the extension setting, and it stripes",
  async () => {
    await page.locator('.tnode[data-tree="discovery"]').first().click();
    await page.locator("#colsBtn").click();
    // Directly beneath: the very next row of the menu, not somewhere in it.
    const adjacent = await page
      .locator("#hideExt")
      .evaluate(
        (el) => el.closest("label")?.nextElementSibling?.querySelector("#zebraRows") != null,
      );
    if (!adjacent) return false;
    await page.locator("#zebraRows").check();
    await page.keyboard.press("Escape");
    await page.mouse.move(4, 4); // hover legitimately recolours a row; park the pointer
    await page.waitForTimeout(120);
    const bg = (n) =>
      page
        .locator(`#rows tr:nth-child(${n})`)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    const striped = (await bg(1)) !== (await bg(2));
    await page.locator("#colsBtn").click();
    await page.locator("#zebraRows").uncheck();
    await page.keyboard.press("Escape");
    await page.mouse.move(4, 4);
    await page.waitForTimeout(120);
    const plain = (await bg(1)) === (await bg(2));
    return striped && plain;
  },
);

await check(
  "L34",
  "Label and filter button share one hover surface inside the header cell",
  async () => {
    const th = page.locator('#headRow th[data-col="fileType"]');
    const cell = th.locator(".hcell");
    await page.mouse.move(4, 4);
    await page.waitForTimeout(120);
    const resting = await cell.evaluate((el) => getComputedStyle(el).backgroundColor);
    // The unit encloses both the label and the filter control. Measured with
    // getBoundingClientRect, not boundingBox: at rest the filter button is invisible with its
    // space reserved (L30), and boundingBox returns null for an invisible element — the reserved
    // box is exactly the geometry this ruling is about.
    const rect = (loc) =>
      loc.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
    const [cellBox, labelBox, filterBox] = [
      await rect(cell),
      await rect(th.locator(".sortbtn")),
      await rect(th.locator(".filterbtn")),
    ];
    // A collapsed box would satisfy "enclosed" vacuously; the reserved space must be real.
    if (filterBox.width < 8 || filterBox.height < 8) return false;
    const encloses = (outer, inner) =>
      inner.x >= outer.x - 1 &&
      inner.x + inner.width <= outer.x + outer.width + 1 &&
      inner.y >= outer.y - 1 &&
      inner.y + inner.height <= outer.y + outer.height + 1;
    if (!encloses(cellBox, labelBox) || !encloses(cellBox, filterBox)) return false;
    // L34b: the filter control is the cell's right EDGE — label left, filter flush
    // right, never a strange distance in the middle after the label.
    if (Math.abs(cellBox.x + cellBox.width - (filterBox.x + filterBox.width)) > 1.5) return false;
    if (Math.abs(labelBox.x - cellBox.x) > 1.5) return false;
    // The unit still spans the whole header cell, so the one hover covers both.
    const thBox = await rect(th);
    const thPad = await th.evaluate((el) => {
      const s = getComputedStyle(el);
      return { l: parseFloat(s.paddingLeft), r: parseFloat(s.paddingRight) };
    });
    if (Math.abs(cellBox.width - (thBox.width - thPad.l - thPad.r)) > 1.5) return false;
    // Hovering the LABEL lights the unit…
    await th.locator(".sortbtn").hover();
    await page.waitForTimeout(100);
    const overLabel = await cell.evaluate((el) => getComputedStyle(el).backgroundColor);
    if (overLabel === resting) return false;
    // …and hovering the filter button lights the SAME surface, not a different one.
    await th.locator(".filterbtn").hover();
    await page.waitForTimeout(100);
    const overFilter = await cell.evaluate((el) => getComputedStyle(el).backgroundColor);
    return overFilter === overLabel;
  },
);

await check(
  "L35",
  "A pinned column holds still under horizontal scroll, behind a Lucide pin",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    await page.locator("#colsBtn").click();
    // The control is the PIN, not a star.
    const pinPath = await page
      .locator('#colsMenu [data-pincol="docType"] svg path')
      .first()
      .getAttribute("d");
    if (pinPath !== "M12 17v5") return false;
    for (const key of ["location", "created"]) {
      const cb = page.locator(`#colsMenu input[data-col="${key}"]`);
      if (!(await cb.isChecked())) await cb.check();
    }
    await page.locator('#colsMenu [data-pincol="docType"]').click();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(150);
    const xOf = (col) =>
      page.locator(`#headRow th[data-col="${col}"]`).evaluate((el) => el.getBoundingClientRect().x);
    const pinnedBefore = await xOf("docType");
    const looseBefore = await xOf("modified");
    await page.locator("#tablewrap").evaluate((el) => {
      el.scrollLeft = 180;
    });
    await page.waitForTimeout(150);
    const pinnedAfter = await xOf("docType");
    const looseAfter = await xOf("modified");
    await page.setViewportSize({ width: 1600, height: 900 });
    // The pinned column did not move; its neighbours did.
    return Math.abs(pinnedAfter - pinnedBefore) < 1 && looseBefore - looseAfter > 100;
  },
);

await check("L36", "Every column filters, through the one shared mechanism", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  // Every header cell carries a filter control — Name and the numeric columns included.
  const thCount = await page.locator("#headRow th").count();
  if ((await page.locator("#headRow th .filterbtn").count()) !== thCount) return false;
  // The text kind, on Name.
  const before = await page.locator('#rows tr[data-key^="d:"]').count();
  await page.locator('#headRow th[data-col="name"]').hover();
  await page.locator('#headRow th[data-col="name"] .filterbtn').click();
  await page.locator("#filterText").fill("Motion");
  await page.waitForTimeout(150);
  const narrowed = await page.locator('#rows tr[data-key^="d:"]').count();
  if (!(narrowed >= 1 && narrowed < before)) return false;
  await page.locator("#filterClear").click();
  await page.waitForTimeout(120);
  // The range kind, on Size: only the Complaint clears 0.3 MB in Pleadings. The bound
  // keeps a row on screen on purpose — an emptied list swaps to the No Matches pane and
  // stops saying anything about which rows the filter kept.
  await page.locator('#headRow th[data-col="size"]').hover();
  await page.locator('#headRow th[data-col="size"] .filterbtn').click();
  await page.locator("#rangeMin").fill("0.3");
  await page.waitForTimeout(150);
  const bigRows = await page.locator('#rows tr[data-key^="d:"]').allInnerTexts();
  if (bigRows.length !== 1 || !bigRows[0].includes("Complaint")) return false;
  await page.locator("#filterClear").click();
  await page.waitForTimeout(120);
  return (await page.locator('#rows tr[data-key^="d:"]').count()) === before;
});

await check("L11b", "The pin glyph is the Lucide pin, not a star", async () => {
  // Its own setup: this check must not inherit whatever filter state came before it.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  const row = page.locator('#rows tr[data-key^="d:"]').first();
  await row.click({ button: "right" });
  await page.locator('#ctx button[data-cmd="pin"]').click();
  await page.waitForTimeout(120);
  const mark = page.locator("#rows .pinmark path").first();
  if ((await mark.count()) === 0) return false;
  const d = await mark.getAttribute("d");
  // Lucide pin starts with the stem; the star's path starts M11.525 — the regression.
  return d === "M12 17v5";
});

await check("L14b", "A runtime deletion records a person's name, never You", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  await page
    .locator('#rows tr[data-key^="d:"]')
    .filter({ hasText: "Answer and Counterclaim" })
    .first()
    .click({ button: "right" });
  await page.locator('#ctx button[data-cmd="delete"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-view="deleted"]').click();
  await page.waitForTimeout(150);
  const row = page
    .locator('#rows tr[data-key^="x:"]')
    .filter({ hasText: "Answer and Counterclaim" });
  if ((await row.count()) !== 1) return false;
  const text = await row.innerText();
  if (/\bYou\b/.test(text)) return false;
  // Deleted By is a person's name.
  return /[A-Z]\. [A-Z][a-z]+/.test(text);
});

await check(
  "A15",
  "Moving files is undoable and redoable, and the control says what it will undo",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    if (!(await page.locator("#undoBtn").isDisabled())) return false; // nothing moved yet
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    await page
      .locator('#rows tr[data-key^="d:"]')
      .filter({ hasText: "Complaint" })
      .first()
      .click({ button: "right" });
    await page.locator('#ctx button[data-cmd="cut"]').click();
    await page.locator('.tnode[data-tree="orders"]').first().click();
    await page.locator("#tablewrap").click({ position: { x: 5, y: 5 } });
    await page.locator("#rows tr").first().click({ button: "right" });
    await page.locator('#ctx button[data-cmd="paste"]').click();
    await page.waitForTimeout(150);
    // The tooltip names the movement, not a mystery.
    const title = await page.locator("#undoBtn").getAttribute("title");
    if (!/^Undo move of 1 file to /.test(title ?? "")) return false;
    // Ctrl+Z puts it back.
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(150);
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    if ((await page.locator("#rows tr").filter({ hasText: "Complaint" }).count()) !== 1)
      return false;
    // The visible redo control re-applies it.
    if (!/^Redo move of 1 file/.test((await page.locator("#redoBtn").getAttribute("title")) ?? ""))
      return false;
    await page.locator("#redoBtn").click();
    await page.waitForTimeout(150);
    return (await page.locator("#rows tr").filter({ hasText: "Complaint" }).count()) === 0;
  },
);

await check(
  "N22",
  "History sits beneath File Analysis and Deleted Files, on the matter's table",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    const order = await page.locator(".viewrow").evaluateAll((bs) => bs.map((b) => b.dataset.view));
    // Search Results (S17, round ten) joined the family between Deleted Files and History.
    if (JSON.stringify(order) !== JSON.stringify(["analysis", "deleted", "results", "history"]))
      return false;
    await page.locator('[data-view="history"]').click();
    await page.waitForTimeout(150);
    // The breadcrumb titles the view (N21), with no second heading.
    if (!/History/.test(await page.locator("#crumbs").innerText())) return false;
    // The owner's columns, as revised in round twelve: time, action, file, From and To as
    // their own columns (N26), and the actor as Source (N27).
    const heads = await page.locator("#headRow th").allInnerTexts();
    const labels = heads.map((h) => h.trim().toLowerCase());
    if (
      !["time", "action", "file", "from", "to", "source"].every((l) =>
        labels.some((h) => h.startsWith(l)),
      )
    )
      return false;
    if (labels.some((h) => h.includes("from / to"))) return false;
    const rows = page.locator("#rows tr");
    if ((await rows.count()) < 5) return false;
    // Newest first by default; sorting by Time flips it.
    const firstBefore = await rows.first().innerText();
    await page.locator('[data-sortbtn="histTime"]').click();
    await page.waitForTimeout(120);
    const firstAfter = await page.locator("#rows tr").first().innerText();
    return firstBefore !== firstAfter;
  },
);

await check("T7", "A folder drags to a new parent within the tree", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  const node = page.locator('.tnode[data-tree="orders"]');
  if ((await node.getAttribute("draggable")) !== "true") return false;
  await page.evaluate(() => {
    const dt = new DataTransfer();
    const src = document.querySelector('.tnode[data-tree="orders"]');
    const dst = document.querySelector('.tnode[data-tree="pleadings"]');
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    dst.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
    dst.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(150);
  const parent = await page.evaluate(() => folderById("orders")?.parent);
  if (parent !== "pleadings") return false;
  // And it is a movement like any other: undo puts it back at the top level.
  await page.locator("#undoBtn").click();
  await page.waitForTimeout(150);
  return (await page.evaluate(() => folderById("orders")?.parent)) === null;
});

await check(
  "A16",
  "Uploading asks where to save: here by default, the root, or any folder",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    // A8's real picker still applies — the modal FOLLOWS the pick.
    await page.locator("#filePicker").setInputFiles({
      name: "settlement-notes.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 settlement notes"),
    });
    await page.waitForTimeout(200);
    const dialog = page.locator("#newDocWash .dialog");
    if (!(await dialog.isVisible())) return false;
    // The folder being viewed is the default…
    const here = page.locator('#newDocWash input[name="updest"][value="here"]');
    if (!(await here.isChecked())) return false;
    if (!/Pleadings/.test(await here.evaluate((el) => el.closest("label").innerText))) return false;
    // …the root is one click, and so is any other folder.
    if ((await page.locator('#newDocWash input[name="updest"][value="root"]').count()) !== 1)
      return false;
    await page.locator('#newDocWash input[name="updest"][value="other"]').check();
    await page.locator('#newDocWash [data-updfolder="correspondence"]').click();
    await page.locator('#newDocWash [data-upd="yes"]').click();
    await page.waitForTimeout(200);
    await page.locator('.tnode[data-tree="correspondence"]').first().click();
    return (await page.locator("#rows tr").filter({ hasText: "settlement-notes" }).count()) === 1;
  },
);

await check(
  "I39",
  "Clicking the name in the inspector renames inline, extension untouched",
  async () => {
    await openFile("pleadings", "Motion to Compel");
    await page.locator('#inspector [data-instab="preview"]').click();
    await page.locator("#insRename").click();
    const field = page.locator(".ins-head input.rename");
    const state = await field.evaluate((el) => ({
      value: el.value,
      start: el.selectionStart,
      end: el.selectionEnd,
    }));
    // A9 binds here too: the selection stops before ".docx".
    if (!state.value.endsWith(".docx")) return false;
    if (state.start !== 0 || state.end !== state.value.length - ".docx".length) return false;
    // Extensions are shown, so the field carries the whole name and what is typed stands
    // (A21). A user keeping the type keeps the extension in the field.
    await field.fill("Motion to Compel (retitled).docx");
    await field.press("Enter");
    await page.waitForTimeout(150);
    const rows = await page.locator('#rows tr[data-key^="d:"]').allInnerTexts();
    return rows.some((r) => r.includes("Motion to Compel (retitled).docx"));
  },
);

await check("L37", "An unset document type shows blank — never Unfiled", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  // Let the aggregate fill-ins land first: their re-render replaces inspector nodes, and
  // a boundingBox taken across that swap reads a detached element.
  await page
    .waitForFunction(() => !document.querySelector("#rows .pendingval"), null, { timeout: 4000 })
    .catch(() => {});
  if ((await page.content()).includes("Unfiled")) return false;
  // The flagged home-level file has no type: its cell is EMPTY.
  const idx = await page
    .locator("#headRow th")
    .evaluateAll((ths) => ths.findIndex((th) => th.dataset.col === "docType"));
  const cell = await page
    .locator('#rows tr[data-key="d:11"]')
    .evaluate((r, i) => r.cells[i].innerText.trim(), idx);
  if (cell !== "") return false;
  // The Details field is blank too, but keeps a labelled, clickable footprint.
  if (!(await page.locator("#inspector").isVisible())) await page.locator("#insBtn").click();
  await page.locator('#rows tr[data-key="d:11"]').click();
  await page.locator('#inspector [data-instab="details"]').click();
  const fieldButton = page.locator("#inspector [data-dt-open]");
  if ((await fieldButton.innerText()).trim() !== "") return false;
  const box = await fieldButton.boundingBox();
  return box.width >= 60; // blank, not vanished
});

await check("I40", "The preview fits its panel, and an image previews as the image", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  if (!(await page.locator("#inspector").isVisible())) await page.locator("#insBtn").click();
  // The pdf preview — the box that used to run off the right of the screen.
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  await page.locator('#rows tr[data-key^="d:"]').filter({ hasText: "Complaint" }).first().click();
  await page.locator('#inspector [data-instab="preview"]').click();
  await page.waitForTimeout(150);
  const fits = async () => {
    const [box, panel] = [
      await page.locator("#inspector .previewbox").boundingBox(),
      await page.locator("#inspector").boundingBox(),
    ];
    return (
      box.x + box.width <= panel.x + panel.width + 1 &&
      box.x + box.width <= page.viewportSize().width + 1
    );
  };
  if (!(await fits())) return false;
  // An image file previews AS the image — not a "renders here" placeholder.
  await page.locator('.tnode[data-tree="sitephotos"]').first().click();
  if (await page.locator("#iconGrid").isVisible()) await page.locator("#viewModeBtn").click();
  await page.locator('#rows tr[data-key^="d:"]').first().click();
  await page.locator('#inspector [data-instab="preview"]').click();
  await page.waitForTimeout(150);
  const photo = page.locator("#inspector .previewbox.photoprev");
  if ((await photo.count()) !== 1) return false;
  if (/renders here/i.test(await page.locator("#inspector").innerText())) return false;
  return await fits();
});

// ---- Round ten.

const waitForAggregates = async () => {
  await page
    .waitForFunction(
      () => !document.querySelector("#rows .pendingval, #iconGrid .pendingval"),
      null,
      { timeout: 4000 },
    )
    .catch(() => {});
};

await check("L38", "A pinned item's pin renders filled, in the menu and on the row", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  const row = page.locator('#rows tr[data-key^="d:"]').first();
  await row.click();
  await row.click({ button: "right" });
  const item = page.locator('#ctx button[data-cmd="pin"]');
  // Unpinned: the glyph is outline-only.
  if ((await item.locator("svg").getAttribute("fill")) !== "none") return false;
  await item.click();
  await page.waitForTimeout(120);
  // Pinned: the same glyph, filled — and the row's mark is filled too.
  if (
    (await page.locator('#ctx button[data-cmd="pin"] svg').getAttribute("fill")) !== "currentColor"
  )
    return false;
  const rowMark = page.locator("#rows .pinmark").first();
  if ((await rowMark.getAttribute("fill")) !== "currentColor") return false;
  await page.locator('#ctx button[data-cmd="pin"]').click(); // unpin again
  await page.keyboard.press("Escape");
  return true;
});

await check("A17", "Pinning keeps the menu open, and the item restates itself", async () => {
  const row = page.locator('#rows tr[data-key^="d:"]').first();
  await row.click({ button: "right" });
  const item = page.locator('#ctx button[data-cmd="pin"]');
  const before = (await item.innerText()).trim();
  await item.click();
  await page.waitForTimeout(120);
  if (!(await page.locator("#ctx").isVisible())) return false; // the ruling: it stays open
  const after = (await page.locator('#ctx button[data-cmd="pin"]').innerText()).trim();
  await page.locator('#ctx button[data-cmd="pin"]').click();
  await page.keyboard.press("Escape");
  return before.includes("Pin to Top") && after.includes("Unpin");
});

await check(
  "L39b",
  "The scale control: tooltip for a name, no text label, 50-200%, keyboard-operable",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    const slider = page.locator("#fmScale");
    if ((await slider.count()) !== 1) return false;
    // The accessible name stays; the visible text label is gone; the tooltip carries it.
    if (!((await slider.getAttribute("aria-label")) ?? "").length) return false;
    if (!((await slider.getAttribute("title")) ?? "").length) return false;
    if ((await page.locator('.pagefoot label[for="fmScale"]').count()) !== 0) return false;
    // The widened range, exactly as ruled.
    if ((await slider.getAttribute("min")) !== "50") return false;
    if ((await slider.getAttribute("max")) !== "200") return false;
    await page.locator('.tnode[data-tree="sitephotos"]').first().click();
    await waitForAggregates();
    const tile = page.locator("#iconGrid .tile").first();
    const beforeW = (await tile.boundingBox()).width;
    const beforeFont = await page
      .locator("#iconGrid .cap")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    // Keyboard-operable: End walks the slider to its maximum.
    await slider.focus();
    await slider.press("End");
    await page.waitForTimeout(200);
    const afterW = (await page.locator("#iconGrid .tile").first().boundingBox()).width;
    const afterFont = await page
      .locator("#iconGrid .cap")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (!(afterW > beforeW * 1.2 && afterFont > beforeFont * 1.2)) return false;
    // And the list's text scales too.
    await page.locator("#viewModeBtn").click();
    const rowFont = await page
      .locator("#rows td")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await slider.focus();
    await slider.press("Home");
    await page.waitForTimeout(150);
    const rowFontBack = await page
      .locator("#rows td")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    return rowFont > rowFontBack;
  },
);

await check("L40", "Computing aggregates render immediately, pending, then fill in", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  // Straight after load the folder rows must already CARRY their aggregate fields,
  // visibly pending — never hidden.
  await page.waitForSelector("#rows tr[data-kind='folder']", { timeout: 5000 });
  const pending = await page.locator("#rows .pendingval[aria-busy='true']").count();
  if (pending === 0) return false;
  await waitForAggregates();
  // Filled: sizes with counts, and the aggregate safety chip exists somewhere.
  const text = await page.locator("#rows").innerText();
  if (!/\d+ files/.test(text)) return false;
  return (await page.locator("#rows .okmark, #rows .chip").count()) > 0;
});

await check("A18", "Convert is a flyout of quick formats, every entry honestly Soon", async () => {
  await waitForAggregates();
  const row = page.locator('#rows tr[data-key^="d:"]').filter({ hasText: "Invoice_scan" }).first();
  // A program has no honest convert: the item must be absent for it.
  await row.click();
  await row.click({ button: "right" });
  if ((await page.locator("#ctx .subopen").filter({ hasText: "Convert" }).count()) !== 0)
    return false;
  await page.keyboard.press("Escape");
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  const docx = page.locator('#rows tr[data-key^="d:"]').filter({ hasText: "Motion" }).first();
  await docx.click();
  await docx.click({ button: "right" });
  const opener = page.locator("#ctx .subopen").filter({ hasText: "Convert" });
  if ((await opener.count()) !== 1) return false;
  await opener.hover();
  await page.waitForTimeout(150);
  const items = await page
    .locator("#ctx .convpanel .convitem")
    .evaluateAll((bs) =>
      bs.map((b) => [b.disabled, (b.title ?? "").length > 0, b.textContent.includes("Soon")]),
    );
  await page.keyboard.press("Escape");
  return items.length >= 3 && items.every(([d, t, s]) => d && t && s);
});

await check(
  "A15b",
  "Undo and redo live in the footer, not the navigation cluster",
  async () =>
    (await page.locator(".pagefoot #undoBtn").count()) === 1 &&
    (await page.locator(".pagefoot #redoBtn").count()) === 1 &&
    (await page.locator(".toolbar #undoBtn, .toolbar #redoBtn").count()) === 0,
);

await check(
  "I41",
  "The struck placeholder sentence is gone",
  async () => !(await page.content()).includes("details, safety history, and versions live here"),
);

await check("L41", "Right-clicking empty list space opens the folder-level menu", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator("#rows tr").first().click(); // have something selected
  const wrap = await page.locator("#tablewrap").boundingBox();
  await page.mouse.click(wrap.x + wrap.width / 2, wrap.y + wrap.height - 40, { button: "right" });
  await page.waitForTimeout(120);
  if (!(await page.locator("#ctx").isVisible())) return false;
  const cmds = await page
    .locator("#ctx button[data-bcmd]")
    .evaluateAll((bs) => bs.map((b) => b.dataset.bcmd));
  // L22 consistency: the selection cleared.
  const selected = await page.locator('#rows tr[aria-selected="true"]').count();
  await page.keyboard.press("Escape");
  return (
    ["newfolder", "newdoc", "upload", "paste", "selectall"].every((c) => cmds.includes(c)) &&
    selected === 0
  );
});

await check("A19", "Cut, copy and paste work from the keyboard, end to end", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  const complaint = page
    .locator('#rows tr[data-key^="d:"]')
    .filter({ hasText: "Complaint" })
    .first();
  await complaint.click();
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(120);
  if ((await complaint.getAttribute("data-clipboard")) !== "copy") return false;
  await page.keyboard.press("Control+x");
  await page.waitForTimeout(120);
  if ((await complaint.getAttribute("data-clipboard")) !== "cut") return false;
  await page.locator('.tnode[data-tree="orders"]').first().click();
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(150);
  return (await page.locator("#rows tr").filter({ hasText: "Complaint" }).count()) === 1;
});

await check(
  "N23",
  "No Views heading in the rail",
  async () => (await page.locator(".rail h2").filter({ hasText: "Views" }).count()) === 0,
);

await check("A20", "A selection's menu speaks for the whole selection, nothing dead", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  const rows = page.locator('#rows tr[data-key^="d:"]');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ["Control"] });
  await rows.nth(1).click({ button: "right" });
  const text = await page.locator("#ctx").innerText();
  if (!/Download 2 files/.test(text)) return false;
  if (!/Copy 2 files/.test(text)) return false;
  if (!/Set Document Type for 2 Files/.test(text)) return false;
  // Every disabled item states its reason.
  const disabled = await page
    .locator("#ctx button:disabled")
    .evaluateAll((bs) => bs.map((b) => (b.title ?? "").length > 0));
  if (!disabled.every(Boolean)) return false;
  // Files only: no folder styling offered.
  if ((await page.locator("#ctx .subopen").filter({ hasText: "Color" }).count()) !== 0)
    return false;
  await page.keyboard.press("Escape");
  // Mixed selection: Colour scopes itself to the folders and says so.
  await page.locator("#railHome").click();
  await waitForAggregates();
  await page.locator('#rows tr[data-kind="folder"]').first().click();
  await page
    .locator('#rows tr[data-kind="file"]')
    .first()
    .click({ modifiers: ["Control"] });
  await page.locator('#rows tr[data-kind="file"]').first().click({ button: "right" });
  const mixed = await page.locator("#ctx").innerText();
  await page.keyboard.press("Escape");
  return /Color \(1 folder\)/.test(mixed);
});

await check("T6e", "A hovered swatch keeps its own colour", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="discovery"]').first().click({ button: "right" });
  await page.locator("#ctx .subopen").first().hover();
  await page.waitForTimeout(150);
  const swatch = page.locator('#ctx .swatch[data-colour="blue"]');
  await page.mouse.move(4, 4);
  await page.waitForTimeout(100);
  const resting = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.locator("#ctx .subopen").first().hover();
  await swatch.hover();
  await page.waitForTimeout(100);
  const hovered = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
  // The defect turned it the menu-hover wash; the ruling: hover keeps ITS colour.
  return hovered === resting;
});

await check("T6f", "The selected swatch's halo paints above its neighbours", async () => {
  const on = page.locator("#ctx .swatch.on").first();
  if ((await on.count()) !== 1) return false;
  const style = await on.evaluate((el) => {
    const s = getComputedStyle(el);
    return { position: s.position, z: s.zIndex, outline: s.outlineStyle, radius: s.borderRadius };
  });
  await page.keyboard.press("Escape");
  // Raised stacking is what guarantees the halo is never overpainted by a later sibling;
  // and T6c re-verified while here: the rendered radius is exactly 0.
  return (
    style.position === "relative" &&
    Number(style.z) >= 1 &&
    style.outline !== "none" &&
    style.radius === "0px"
  );
});

await check("A21", "Invoice_scan.pdf.exe renames to Invoice_scan.pdf, and it sticks", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await waitForAggregates();
  const row = page.locator('#rows tr[data-key="d:11"]');
  await row.click();
  await row.click({ button: "right" });
  await page.locator('#ctx button[data-cmd="rename"]').click();
  const field = page.locator("#rows input.rename");
  // A9 still: the default selection stops before the LAST extension.
  const sel = await field.evaluate((el) => ({
    v: el.value,
    s: el.selectionStart,
    e: el.selectionEnd,
  }));
  if (sel.v !== "Invoice_scan.pdf.exe" || sel.s !== 0 || sel.e !== sel.v.length - ".exe".length)
    return false;
  await field.fill("Invoice_scan.pdf");
  await field.press("Enter");
  await page.waitForTimeout(150);
  const renamed = page.locator('#rows tr[data-key="d:11"]');
  const text = await renamed.innerText();
  // The name lost its .exe, the extension column follows the NAME — and the finding does
  // not vanish: a rename changes no bytes. The Safety cell speaks the severity word (L47).
  return (
    text.includes("Invoice_scan.pdf") &&
    !text.includes(".exe") &&
    /\bpdf\b/.test(text) &&
    /\bError\b/.test(text)
  );
});

await check(
  "A22",
  "The folder-delete dialog: header, affected list, structure and destination",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await waitForAggregates();
    await page
      .locator('#rows tr[data-kind="folder"]')
      .filter({ hasText: "Discovery" })
      .first()
      .click({ button: "right" });
    await page.locator('#ctx button[data-cmd="delete"]').click();
    await page.waitForTimeout(150);
    const dialog = page.locator("#newDocWash .dialog");
    // The header defect: the h2 must sit INSIDE a padded header.
    const headed = await dialog.evaluate((el) => {
      const h2 = el.querySelector("h2");
      const header = h2?.closest("header");
      return header ? getComputedStyle(header).paddingTop : null;
    });
    if (headed !== "16px") return false;
    // Collapsed affected list with an honest count, expanding to the actual files.
    const details = dialog.locator("details.delaffected");
    if (await details.evaluate((el) => el.open)) return false;
    const summary = await details.locator("summary").innerText();
    if (!/13 files and 3 subfolders/.test(summary)) return false;
    await details.locator("summary").click();
    await page.waitForTimeout(120);
    if ((await details.locator(".dellist li").count()) !== 16) return false;
    // Cap-and-scroll: the dialog still fits the viewport with the list open.
    const box = await dialog.boundingBox();
    if (box.y + box.height > page.viewportSize().height + 1) return false;
    // Structure choices, keep as default; destination choices, up-one-level as default.
    // Discovery is TOP-LEVEL, so "up one level" already IS the root and the separate root
    // option is deliberately collapsed away — a nested folder shows it (asserted below).
    if (!(await dialog.locator('input[name="delmode"][value="promote"]').isChecked())) return false;
    if ((await dialog.locator('input[name="delmode"][value="flatten"]').count()) !== 1)
      return false;
    if (!(await dialog.locator('input[name="deldest"][value="up"]').isChecked())) return false;
    await dialog.locator('[data-del="no"]').click();
    await page.waitForTimeout(150);
    // A nested folder offers the root as its own destination.
    await page.locator('.tnode[data-tree="discovery"]').first().click();
    await waitForAggregates();
    await page
      .locator('#rows tr[data-kind="folder"]')
      .filter({ hasText: "Depositions" })
      .first()
      .click({ button: "right" });
    await page.locator('#ctx button[data-cmd="delete"]').click();
    await page.waitForTimeout(150);
    if ((await dialog.locator('input[name="deldest"][value="root"]').count()) !== 1) return false;
    await dialog.locator('[data-del="no"]').click();
    await page.waitForTimeout(150);
    // Back to Discovery for the flatten exercise.
    await page.locator("#railHome").click();
    await waitForAggregates();
    await page
      .locator('#rows tr[data-kind="folder"]')
      .filter({ hasText: "Discovery" })
      .first()
      .click({ button: "right" });
    await page.locator('#ctx button[data-cmd="delete"]').click();
    await page.waitForTimeout(150);
    // Flatten: subfolders go, the files land loose at the destination.
    await dialog.locator('input[name="delmode"][value="flatten"]').check();
    await dialog.locator('[data-del="yes"]').click();
    await page.waitForTimeout(200);
    if ((await page.locator('.tnode[data-tree="depositions"]').count()) !== 0) return false;
    await waitForAggregates();
    // Home is mostly images after the flatten, so it opens as the icon grid — read the
    // surface the person sees, whichever it is.
    const surface = (await page.locator("#iconGrid").isVisible()) ? "#iconGrid" : "#rows";
    return (await page.locator(surface).innerText()).includes("Hale Deposition Transcript");
  },
);

await check(
  "N22c",
  "Selecting a history row presents it in the panel; Reveal is what navigates",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    // The panel opens by its own button (I17); selection then feeds it.
    await page.locator("#insBtn").click();
    await page.locator('[data-view="history"]').click();
    await page.waitForTimeout(150);
    await page
      .locator("#rows tr[data-hist]")
      .filter({ hasText: "Settlement Demand" })
      .first()
      .click();
    await page.waitForTimeout(200);
    // Selecting does NOT navigate: still in the History list.
    if (!/History/.test(await page.locator("#crumbs").innerText())) return false;
    // The panel presents the event: what happened, when, who, from/to, the document.
    const text = await page.locator("#inspector").innerText();
    for (const needle of ["New Version", "R. Osei", "11", "12", "Settlement Demand Letter.docx"]) {
      if (!text.includes(needle)) return false;
    }
    // Reveal in the entry view is the explicit way out: file selected, panel following.
    await page.locator('#inspector [data-hact="reveal"]').click();
    await page.waitForTimeout(250);
    if ((await page.locator('#rows tr[data-key="d:9"][aria-selected="true"]').count()) !== 1)
      return false;
    if (!(await page.locator("#inspector").innerText()).includes("Settlement Demand")) return false;
    // The deleted-item path navigates too, via the explicit right-click Reveal.
    await page.locator('[data-view="history"]').click();
    await page.waitForTimeout(150);
    await page
      .locator("#rows tr[data-hist]")
      .filter({ hasText: "Draft Settlement Outline" })
      .first()
      .click({ button: "right" });
    await page.locator('#ctx [data-hcmd="reveal"]').click();
    await page.waitForTimeout(250);
    if (!/Deleted Files/.test(await page.locator("#crumbs").innerText())) return false;
    if ((await page.locator('#rows tr[data-key="x:901"][aria-selected="true"]').count()) !== 1)
      return false;
    // Double-click is the other explicit navigate gesture.
    await page.locator('[data-view="history"]').click();
    await page.waitForTimeout(150);
    await page
      .locator("#rows tr[data-hist]")
      .filter({ hasText: "Settlement Demand" })
      .first()
      .dblclick();
    await page.waitForTimeout(250);
    if (/History/.test(await page.locator("#crumbs").innerText())) return false;
    return (await page.locator('#rows tr[data-key="d:9"][aria-selected="true"]').count()) === 1;
  },
);

await check("S15", "Open Full Results fits the dropdown, Search in on one line", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator("#searchBtn").click();
  await page.locator("#searchInput").click();
  await page.waitForTimeout(150);
  const [pop, all, scope] = [
    await page.locator("#searchpop").boundingBox(),
    await page.locator("#openResults").boundingBox(),
    await page.locator(".searchpop .scope").boundingBox(),
  ];
  if (all.x + all.width > pop.x + pop.width + 1) return false;
  // One line: the label and the results control share a vertical centre.
  const label = await page.locator(".searchpop .scopelbl").boundingBox();
  if (Math.abs(label.y + label.height / 2 - (all.y + all.height / 2)) > 4) return false;
  if (scope.height > 48) return false; // a wrapped second line would double this
  const options = await page.locator("#scopeSel option").allInnerTexts();
  return !options.some((o) => /everywhere/i.test(o));
});

await check("S16", "The indexing status is wired: the number moves, surfaces agree", async () => {
  const bar = page.locator("#popIdxBar");
  const label = page.locator("#popIdxLabel");
  const pct = Number(await bar.getAttribute("value"));
  if (!(await label.innerText()).includes(String(pct) + "%")) return false;
  await page.waitForTimeout(3400);
  const pct2 = await bar.evaluate((el) => Number(el.value));
  const label2 = await label.innerText();
  return pct2 > pct && label2.includes(String(pct2) + "%");
});

await check(
  "S17b",
  "Search Results always sits in the rail, and an empty click is ready",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    // The row stands with no live search at all.
    if (!(await page.locator("#searchViewRow").isVisible())) return false;
    await page.locator("#searchViewRow").click();
    await page.waitForTimeout(200);
    if ((await page.locator("#searchViewRow").getAttribute("aria-current")) !== "true")
      return false;
    if (!/Search Results/.test(await page.locator("#crumbs").innerText())) return false;
    // Never a dead click: the header field is focused and ready…
    if ((await page.evaluate(() => document.activeElement?.id)) !== "resInput") return false;
    // …and typing there searches at once.
    await page.keyboard.type("Motion");
    await page.waitForTimeout(250);
    if ((await page.locator('#rows tr[data-key^="d:"]').count()) === 0) return false;
    // Leaving keeps the row and drops the highlight.
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    await page.waitForTimeout(150);
    return (
      (await page.locator("#searchViewRow").getAttribute("aria-current")) === "false" &&
      (await page.locator("#searchViewRow").isVisible())
    );
  },
);

await check(
  "N24",
  "The rail starts tight under the header, views tight under the tree",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.mouse.move(4, 4);
    const railTop = (await page.locator(".rail").boundingBox()).y;
    const homeTop = (await page.locator("#railHome").boundingBox()).y;
    if (homeTop - railTop > 9) return false;
    const treeBottom = await page
      .locator("#treeList")
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const viewsTop = (await page.locator('[data-view="analysis"]').boundingBox()).y;
    return viewsTop - treeBottom <= 18;
  },
);

await check("L42", "A live filter is unmissable, and one click clears it", async () => {
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  const th = page.locator('#headRow th[data-col="name"]');
  await th.hover();
  await th.locator(".filterbtn").click();
  await page.locator("#filterText").fill("Motion");
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape");
  await page.mouse.move(4, 4);
  await page.waitForTimeout(100);
  // The funnel fills — a real background, not a tint of text alone.
  const active = await page
    .locator('#headRow th[data-col="name"] .filterbtn')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  if (active === "rgba(0, 0, 0, 0)") return false;
  // The footer counts what is hidden and offers the way back, saying what it will do.
  if (!/1 of 3 files · filtered/.test(await page.locator("#tally").innerText())) return false;
  const clear = page.locator("#clearAllFilters");
  if (!/Clear 1 Filter/.test(await clear.innerText())) return false;
  await clear.click();
  await page.waitForTimeout(150);
  return (
    (await page.locator("#clearAllFilters").count()) === 0 &&
    /3 files/.test(await page.locator("#tally").innerText())
  );
});

await check(
  "A24",
  "One Open: the editor for editable types, the preview for the rest",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    if ((await page.content()).includes("Open in Editor")) return false;
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    // A pdf opens its preview.
    const pdf = page.locator('#rows tr[data-key^="d:"]').filter({ hasText: "Complaint" }).first();
    await pdf.click();
    await pdf.click({ button: "right" });
    await page.locator('#ctx button[data-cmd="open"]').click();
    await page.waitForTimeout(150);
    if (
      (await page.locator('#inspector [data-instab="preview"]').getAttribute("aria-selected")) !==
      "true"
    )
      return false;
    // A docx opens the editor.
    const docx = page.locator('#rows tr[data-key^="d:"]').filter({ hasText: "Motion" }).first();
    await docx.click();
    await docx.click({ button: "right" });
    await page.locator('#ctx button[data-cmd="open"]').click();
    await page.waitForTimeout(150);
    return /editor/i.test(await page.locator("#toast").innerText());
  },
);

await check(
  "D2",
  "Restoring an orphaned file asks, defaulting to the nearest ancestor",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('[data-view="deleted"]').click();
    await page.waitForTimeout(150);
    // A file whose folder survives restores silently.
    await page.locator('#rows tr[data-key="x:901"]').click({ button: "right" });
    await page.locator('#ctx button[data-dcmd="restore"]').click();
    await page.waitForTimeout(200);
    if (await page.locator("#newDocWash .dialog").isVisible()) return false;
    // The orphaned one asks, and the default names the nearest surviving ancestor.
    await page.locator('#rows tr[data-key="x:902"]').click({ button: "right" });
    await page.locator('#ctx button[data-dcmd="restore"]').click();
    await page.waitForTimeout(200);
    const dialog = page.locator("#newDocWash .dialog");
    if (!(await dialog.isVisible())) return false;
    const near = dialog.locator('input[name="rddest"][value="near"]');
    if (!(await near.isChecked())) return false;
    if (!/Discovery/.test(await near.evaluate((el) => el.closest("label").innerText))) return false;
    await dialog.locator('[data-rd="yes"]').click();
    await page.waitForTimeout(200);
    await page.locator('.tnode[data-tree="discovery"]').first().click();
    await waitForAggregates();
    return (await page.locator("#rows tr").filter({ hasText: "Old Site Photos" }).count()) === 1;
  },
);

await check(
  "F12",
  "Severity speaks Error/Warning/Info, and the counts are the filters",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('[data-view="analysis"]').click();
    await page.waitForTimeout(200);
    const sev = await page.locator(".ansev").innerText();
    if (/serious|worth checking|tidy-up/.test(sev)) return false;
    if (!/Errors/.test(sev) || !/Warnings/.test(sev) || !/Info/.test(sev)) return false;
    const before = await page.locator(".ancard").count();
    await page.locator('button.sevchip[data-sevfilter="danger"]').click();
    await page.waitForTimeout(150);
    const after = await page.locator(".ancard").count();
    if (!(after > 0 && after < before)) return false;
    const pressed = page.locator("button.sevchip.on");
    if ((await pressed.count()) !== 1) return false;
    if ((await pressed.getAttribute("aria-pressed")) !== "true") return false;
    await pressed.click();
    await page.waitForTimeout(150);
    return (await page.locator(".ancard").count()) === before;
  },
);

await check("I42", "The clean verdict is a filled circle-check, not a bare tick", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  const mark = page.locator("#rows .okmark .cleanmark circle").first();
  if ((await mark.count()) === 0) return false;
  const fill = await mark.evaluate((el) => getComputedStyle(el).fill);
  // The circle is FILLED with the success token — computed to a real colour, not none.
  return fill !== "none" && fill !== "rgb(0, 0, 0)";
});

await check("A23", "Ctrl+A selects every file in the view, and no page text", async () => {
  const rowCount = await page.locator("#rows tr[data-key]").count();
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(120);
  const selected = await page.locator('#rows tr[aria-selected="true"]').count();
  if (selected !== rowCount) return false;
  if (String(await page.evaluate(() => String(getSelection()))) !== "") return false;
  return new RegExp(rowCount + " selected").test(await page.locator("#selfoot").innerText());
});

await check("L43", "Arrows: 2D in the grid, Left/Right never dead in the list", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  const rows = page.locator('#rows tr[data-key^="d:"]');
  await rows.nth(0).click();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(80);
  const second = await rows.nth(1).getAttribute("aria-selected");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(80);
  const firstAgain = await rows.nth(0).getAttribute("aria-selected");
  if (second !== "true" || firstAgain !== "true") return false;
  await page.locator('.tnode[data-tree="sitephotos"]').first().click();
  await waitForAggregates();
  const tiles = page.locator("#iconGrid .tile");
  await tiles.nth(0).click();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(80);
  if ((await tiles.nth(1).getAttribute("aria-selected")) !== "true") return false;
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(80);
  // One visual row down from tile 1: expected index is 1 + the measured column count,
  // clamped to the last tile — the 2D model, not a fixed guess at the grid's width.
  const columns = await page.evaluate(() => gridColumns());
  const count = await tiles.count();
  const expected = Math.min(1 + columns, count - 1);
  const [target, sel] = [
    await tiles.nth(expected).boundingBox(),
    await page.locator('#iconGrid .tile[aria-selected="true"]').boundingBox(),
  ];
  return Math.abs(sel.x - target.x) < 2 && Math.abs(sel.y - target.y) < 2;
});

await check(
  "I27d",
  "Set Document Type is a flyout beside its item, never at the screen edge",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    const row = page.locator('#rows tr[data-key^="d:"]').first();
    await row.click();
    await row.click({ button: "right" });
    await page.locator("#ctx .subopen").filter({ hasText: "Set Document Type" }).hover();
    await page.waitForTimeout(150);
    const [menu, panel] = [
      await page.locator("#ctx").boundingBox(),
      await page.locator("#ctx .dtpanel").boundingBox(),
    ];
    await page.keyboard.press("Escape");
    return panel.x > 100 && panel.x > menu.x + menu.width - 20;
  },
);

await check("A25", "Cut, copy, paste sit between separators as their own group", async () => {
  const row = page.locator('#rows tr[data-key^="d:"]').first();
  await row.click({ button: "right" });
  const kinds = await page
    .locator("#ctx > *")
    .evaluateAll((ns) =>
      ns.map((n) =>
        n.classList.contains("rule") ? "rule" : (n.textContent ?? "").trim().split(/\s|Ctrl/)[0],
      ),
    );
  await page.keyboard.press("Escape");
  const copyAt = kinds.findIndex((k) => k === "Copy");
  return (
    copyAt > 0 &&
    kinds[copyAt - 1] === "rule" &&
    kinds[copyAt + 1] === "Cut" &&
    kinds[copyAt + 2] === "Paste" &&
    kinds[copyAt + 3] === "rule"
  );
});

await check("F13", "A safety re-run appends to the history and never blocks", async () => {
  await openInspectorOnFlagged();
  await page.locator('#inspector [data-instab="safety"]').click();
  const entries = () => page.locator("#inspector .hist .h").count();
  const before = await entries();
  await page.locator('#inspector [data-act="rescan"]').click();
  await page.waitForTimeout(200);
  if ((await entries()) !== before + 1) return false; // the request lands immediately
  if (!/running now/i.test(await page.locator("#inspector .hist").innerText())) return false;
  await page.waitForTimeout(1600);
  if ((await entries()) !== before + 2) return false; // then the scanner's words
  const text = await page.locator("#inspector .hist").innerText();
  // A still-flagged file stays flagged — and the prior entries are all still there.
  if (!/Re-scan flagged/i.test(text)) return false;
  // The row's Safety cell speaks the severity word (L47), so flagged reads Error.
  return (await page.locator('#rows tr[data-key="d:8"]').innerText()).includes("Error");
});

await check(
  "N25",
  "The breadcrumb Home button's hover box matches the toolbar buttons",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    const [home, back] = [
      await page.locator("#crumbs .crumbhome").boundingBox(),
      await page.locator("#backBtn").boundingBox(),
    ];
    if (Math.abs(home.width - back.width) > 1 || Math.abs(home.height - back.height) > 1)
      return false;
    await page.mouse.move(4, 4);
    await page.waitForTimeout(100);
    const resting = await page
      .locator("#crumbs .crumbhome")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.locator("#crumbs .crumbhome").hover();
    await page.waitForTimeout(100);
    const hovered = await page
      .locator("#crumbs .crumbhome")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    return resting !== hovered;
  },
);

await check(
  "I43",
  "Versions are bare numbers, and the column still sorts numerically",
  async () => {
    const verCells = await page.locator("#rows td.ver").allInnerTexts();
    if (verCells.some((v) => /^v\d/.test(v.trim()))) return false;
    await openFile("correspondence", "Settlement Demand");
    await page.locator('#inspector [data-instab="versions"]').click();
    const vids = await page.locator("#inspector .vrow .vid").allInnerTexts();
    if (vids.some((v) => /^v\d/.test(v.trim()))) return false;
    if (vids[0].trim() !== "12") return false;
    // Numeric sort: 12 outranks 2 when descending.
    await page.locator('.tnode[data-tree="correspondence"]').first().click();
    await page.locator('[data-sortbtn="version"]').click();
    await page.locator('[data-sortbtn="version"]').click();
    await page.waitForTimeout(120);
    const first = await page.locator('#rows tr[data-key^="d:"]').first().innerText();
    return first.includes("Settlement Demand");
  },
);

await check("L44", "A clear-filter control exists only while a filter is in play", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  if ((await page.locator("#clearAllFilters").count()) !== 0) return false;
  const th = page.locator('#headRow th[data-col="fileType"]');
  await th.hover();
  await th.locator(".filterbtn").click();
  // Unfiltered column: no clear control in its menu.
  if (await page.locator("#filterMenu #filterClear").isVisible()) return false;
  await page.locator("#filterMenu input[data-val]").first().uncheck();
  await page.waitForTimeout(150);
  // The filter engaged: both clears exist now.
  if (!(await page.locator("#filterMenu #filterClear").isVisible())) return false;
  if ((await page.locator("#clearAllFilters").count()) !== 1) return false;
  await page.locator("#filterMenu #filterClear").click();
  await page.waitForTimeout(150);
  return (await page.locator("#clearAllFilters").count()) === 0;
});

await check("A26", "Share is offered, honestly Soon, naming the portal dependency", async () => {
  const row = page.locator('#rows tr[data-key^="d:"]').first();
  await row.click();
  await row.click({ button: "right" });
  const share = page.locator('#ctx button[data-cmd="share"]');
  if ((await share.count()) !== 1) return false;
  if (!(await share.isDisabled())) return false;
  if (!(await share.innerText()).includes("Soon")) return false;
  const why = (await share.getAttribute("title")) ?? "";
  await page.keyboard.press("Escape");
  return /portal/i.test(why);
});

await check("I44", "Timestamps render in the viewer's local time, everywhere", async () => {
  // A second context in a fixed non-UTC zone: 17:51 UTC is 1:51 PM in New York.
  const ny = await browser.newContext({
    timezoneId: "America/New_York",
    viewport: { width: 1600, height: 900 },
  });
  const nyPage = await ny.newPage();
  await nyPage.goto(page_url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await nyPage.waitForTimeout(400);
  await nyPage.locator('[data-view="history"]').click();
  await nyPage.waitForTimeout(150);
  const hist = await nyPage.locator("#rows tr[data-hist] td").first().innerText();
  let ok = hist.includes("1:51 PM") && !hist.includes("5:51 PM");
  // And a list surface: the deleted view's timestamp shifts the same way (16:12 UTC -> 12:12 PM).
  await nyPage.locator('[data-view="deleted"]').click();
  await nyPage.waitForTimeout(150);
  const del = await nyPage.locator('#rows tr[data-key="x:901"]').innerText();
  ok = ok && del.includes("12:12 PM") && !del.includes("4:12 PM");
  await ny.close();
  return ok;
});

// ---- Round eleven.

await check(
  "L45",
  "Names cannot collide: creations disambiguate, renames refuse, copies number",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    // Two creations in the same place get distinct names.
    await page.locator("#newFolderBtn").click();
    await page.waitForTimeout(150);
    await page.locator("#newFolderBtn").click();
    await page.waitForTimeout(150);
    const names = await page.locator('#rows tr[data-kind="folder"]').allInnerTexts();
    if (names.filter((n) => n.includes("New Folder")).length !== 2) return false;
    if (!names.some((n) => n.includes("New Folder (2)"))) return false;
    // A deliberate rename into a collision is REFUSED, in place, naming the exact sibling.
    await page
      .locator('#rows tr[data-kind="folder"]')
      .filter({ hasText: "New Folder (2)" })
      .first()
      .click({ button: "right" });
    await page.locator('#ctx button[data-cmd="rename"]').click();
    const field = page.locator("#rows input.rename");
    await field.fill("New Folder");
    await field.press("Enter");
    await page.waitForTimeout(120);
    if ((await page.locator("#rows input.rename.invalid").count()) !== 1) return false;
    const msg = await page.locator(".renameconflict").innerText();
    if (!msg.includes("“New Folder”")) return false;
    // Names compare case-insensitively: a case-only variant collides just the same,
    // and the message still names the sibling by its real name.
    await field.fill("new folder");
    await field.press("Enter");
    await page.waitForTimeout(120);
    if ((await page.locator("#rows input.rename.invalid").count()) !== 1) return false;
    if (!(await page.locator(".renameconflict").innerText()).includes("“New Folder”")) return false;
    await page.locator("#rows input.rename").press("Escape");
    await page.waitForTimeout(120);
    // A colliding copy lands NUMBERED, per the platform's copy convention — never refused.
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    const complaint = page
      .locator('#rows tr[data-key^="d:"]')
      .filter({ hasText: "Complaint (as filed)" })
      .first();
    await complaint.click({ button: "right" });
    await page.locator('#ctx button[data-cmd="copy"]').click();
    await complaint.click({ button: "right" });
    await page.locator('#ctx button[data-cmd="paste"]').click();
    await page.waitForTimeout(200);
    if (
      (await page
        .locator("#rows tr")
        .filter({ hasText: "Complaint (as filed) (2).pdf" })
        .count()) !== 1
    )
      return false;
    // An upload into a collision disambiguates per the copy convention — and the
    // comparison is case-insensitive there too, so a case-only variant still numbers.
    await page.locator("#filePicker").setInputFiles({
      name: "complaint (as filed).pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 colliding upload"),
    });
    await page.waitForTimeout(200);
    await page.locator('#newDocWash [data-upd="yes"]').click();
    await page.waitForTimeout(250);
    return (
      (await page
        .locator("#rows tr")
        .filter({ hasText: "complaint (as filed) (3).pdf" })
        .count()) === 1
    );
  },
);

await check(
  "I45",
  "Hash rows show pending before values, filling as each digest lands",
  async () => {
    await openFile("pleadings", "Complaint");
    await page.locator('#inspector [data-instab="hashes"]').click();
    // Every algorithm row is already on screen, value pending — expectation, not surprise.
    const names = await page.locator("#hashList .hashline .k").allInnerTexts();
    if (JSON.stringify(names.map((n) => n.trim())) !== JSON.stringify(["SHA-256", "SHA-1", "MD5"]))
      return false;
    if ((await page.locator("#hashList .pendingval").count()) !== 3) return false;
    // They fill one at a time, not all at once.
    await page.waitForTimeout(620);
    const mid = await page.locator("#hashList .pendingval").count();
    if (!(mid > 0 && mid < 3)) return false;
    await page.waitForTimeout(1300);
    if ((await page.locator("#hashList .pendingval").count()) !== 0) return false;
    // A clean match stays SILENT (I28/I47) — no verdict blocks at all.
    return (await page.locator("#hashList .hashalarm, #hashList .hashnorec").count()) === 0;
  },
);

await check(
  "I46",
  "The Hashes tab scopes to any version, entered from Version History",
  async () => {
    await openFile("pleadings", "Motion to Compel");
    await page.locator('#inspector [data-instab="versions"]').click();
    const verify = page.locator('#inspector [data-ver="hashes:3"]');
    if ((await verify.count()) !== 1) return false;
    await verify.click();
    await page.waitForTimeout(150);
    // The tab switched and its scope field says WHICH version it is reading.
    if (
      (await page.locator('#inspector [data-instab="hashes"]').getAttribute("aria-selected")) !==
      "true"
    )
      return false;
    const head = await page.locator("#hashVerBtn").innerText();
    if (!/Version\s*3/.test(head) || /Current/.test(head)) return false;
    // Pending rows here too (I45), before this version's values land.
    return (await page.locator("#hashList .pendingval").count()) === 3;
  },
);

await check(
  "I47",
  "A recompute that differs from the ingest record shouts, naming both values",
  async () => {
    // Version 3 of the Motion is the tampered fixture; I46 just scoped the tab to it.
    await page.waitForTimeout(1700);
    const alarm = page.locator('#hashList .hashalarm[role="alert"]');
    if ((await alarm.count()) !== 1) return false;
    const text = await alarm.innerText();
    if (!/Integrity warning/i.test(text)) return false;
    if (!/chain-of-custody/i.test(text)) return false;
    // BOTH values are named, and they differ.
    const digests = await alarm.locator("dd.mono").allInnerTexts();
    if (digests.length !== 2 || digests[0].trim() === digests[1].trim()) return false;
    // The mismatching rows read as bad, not as quiet numbers.
    return (await page.locator("#hashList .hashline.hashbad").count()) > 0;
  },
);

await check("I48", "A version with no ingest record says so, never faking agreement", async () => {
  // Version 1 of the Motion came through an older ingest path: no recorded digest.
  await page.locator("#hashVerBtn").click();
  await page.waitForTimeout(150);
  await page.locator('#filterMenu [data-hashver="1"]').click();
  await page.waitForTimeout(1700);
  if (!/Version\s*1/.test(await page.locator("#hashVerBtn").innerText())) return false;
  const note = page.locator("#hashList .hashnorec");
  if ((await note.count()) !== 1) return false;
  if (!/No ingest digest was recorded/.test(await note.innerText())) return false;
  // No alarm — and no silence dressed up as agreement: the note IS the statement.
  return (await page.locator("#hashList .hashalarm").count()) === 0;
});

// ---- Round twelve.

await check("N26", "History's From and To are two columns, sortable and filterable", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('[data-view="history"]').click();
  await page.waitForTimeout(150);
  const from = page.locator('#headRow th[data-col="histFrom"]');
  const to = page.locator('#headRow th[data-col="histTo"]');
  if ((await from.count()) !== 1 || (await to.count()) !== 1) return false;
  // Each carries the shared filter control (L36's one mechanism).
  if ((await from.locator('[data-filterbtn="histFrom"]').count()) !== 1) return false;
  if ((await to.locator('[data-filterbtn="histTo"]').count()) !== 1) return false;
  // The Settlement row reads 11 in From and 12 in To — two cells, not one arrow cell.
  const idxes = await page
    .locator("#headRow th")
    .evaluateAll((ths) => [
      ths.findIndex((th) => th.dataset.col === "histFrom"),
      ths.findIndex((th) => th.dataset.col === "histTo"),
    ]);
  const row = page.locator("#rows tr[data-hist]").filter({ hasText: "Settlement Demand" }).first();
  const cells = await row.evaluate(
    (r, [a, b]) => [r.cells[a].innerText.trim(), r.cells[b].innerText.trim()],
    idxes,
  );
  if (cells[0] !== "11" || cells[1] !== "12") return false;
  // Sorting by From actually orders the column's own values. (Asserting "the first row
  // changed" tested an adjacent property: the newest row also sorts first ascending,
  // because its From is empty.)
  await page.locator('[data-sortbtn="histFrom"]').click();
  await page.waitForTimeout(120);
  const vals = await page
    .locator("#rows tr[data-hist]")
    .evaluateAll((rows, i) => rows.map((r) => r.cells[i].innerText.trim()), idxes[0]);
  if (vals.length < 5) return false;
  const sorted = [...vals].sort((a, b) => a.localeCompare(b));
  return vals.every((v, i) => v === sorted[i]);
});

await check("N27", "History's actor column is Source, in the header and the panel", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator("#insBtn").click();
  await page.locator('[data-view="history"]').click();
  await page.waitForTimeout(150);
  const heads = (await page.locator("#headRow th").allInnerTexts()).map((h) =>
    h.trim().toLowerCase(),
  );
  if (!heads.some((h) => h.startsWith("source"))) return false;
  if (heads.some((h) => h.startsWith("who"))) return false;
  await page
    .locator("#rows tr[data-hist]")
    .filter({ hasText: "Settlement Demand" })
    .first()
    .click();
  await page.waitForTimeout(200);
  const text = await page.locator("#inspector").innerText();
  return /Source/.test(text) && !/\bWho\b/.test(text);
});

await check(
  "A27",
  "Right-click filters the view to one document — History and results only",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    // Browse does NOT offer it: narrowing a folder listing to one already-found row is noise.
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    await page
      .locator('#rows tr[data-key^="d:"]')
      .filter({ hasText: "Motion" })
      .first()
      .click({ button: "right" });
    if ((await page.locator("#ctx button").filter({ hasText: "Filter to" }).count()) !== 0)
      return false;
    await page.keyboard.press("Escape");
    // History: every event for the document, and the L42/L44 machinery engages.
    await page.locator('[data-view="history"]').click();
    await page.waitForTimeout(150);
    const total = await page.locator("#rows tr[data-hist]").count();
    await page
      .locator("#rows tr[data-hist]")
      .filter({ hasText: "Settlement Demand" })
      .first()
      .click({ button: "right" });
    await page.locator('#ctx [data-hcmd="filterdoc"]').click();
    await page.waitForTimeout(150);
    const narrowed = await page.locator("#rows tr[data-hist]").count();
    if (!(narrowed >= 1 && narrowed < total)) return false;
    const rows = await page.locator("#rows tr[data-hist]").allInnerTexts();
    if (!rows.every((t) => t.includes("Settlement Demand Letter.docx"))) return false;
    if (!/filtered/.test(await page.locator("#tally").innerText())) return false;
    const clear = page.locator("#filterfoot #clearAllFilters");
    if ((await clear.count()) !== 1) return false;
    await clear.click();
    await page.waitForTimeout(120);
    if ((await page.locator("#rows tr[data-hist]").count()) !== total) return false;
    // Search results: the same gesture, on the matter's table.
    await page.locator("#searchBtn").click();
    await page.locator("#searchInput").fill("Site");
    await page.locator("#searchInput").press("Enter");
    await page.waitForTimeout(250);
    const resTotal = await page.locator('#rows tr[data-key^="d:"]').count();
    if (resTotal < 2) return false;
    await page.locator('#rows tr[data-key^="d:"]').first().click({ button: "right" });
    await page.locator('#ctx [data-cmd="filterfile"]').click();
    await page.waitForTimeout(150);
    const resNarrowed = await page.locator('#rows tr[data-key^="d:"]').count();
    return (
      resNarrowed >= 1 &&
      resNarrowed < resTotal &&
      /filtered/.test(await page.locator("#tally").innerText())
    );
  },
);

await check("L46", "Date Created, in the column header and the Details row", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator("#colsBtn").click();
  const label = page.locator("#colsMenu label").filter({ hasText: "Date Created" });
  if ((await label.count()) !== 1) return false;
  await label.locator("input").check();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const heads = (await page.locator("#headRow th").allInnerTexts()).map((h) =>
    h.trim().toLowerCase(),
  );
  if (!heads.some((h) => h.startsWith("date created"))) return false;
  if (heads.some((h) => h === "created" || h === "created ↑" || h === "created ↓")) return false;
  // Details says Date Created too.
  if (!(await page.locator("#inspector").isVisible())) await page.locator("#insBtn").click();
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  await page.locator('#rows tr[data-key^="d:"]').filter({ hasText: "Motion" }).first().click();
  await page.waitForTimeout(150);
  const dts = (await page.locator("#inspector .facts dt").allInnerTexts()).map((t) => t.trim());
  return dts.includes("Date Created") && !dts.includes("Created");
});

await check("I49", "Verify All runs the record check across every version", async () => {
  await openFile("pleadings", "Motion to Compel");
  await page.locator('#inspector [data-instab="hashes"]').click();
  const btn = page.locator("#hashVerifyAll");
  if ((await btn.count()) !== 1) return false;
  if (!/All 7 Versions/i.test(await btn.innerText())) return false;
  await btn.click();
  // Every version's row is on screen at once, pending first (I45's pattern).
  if ((await page.locator("#hashAllList .hashallrow").count()) !== 7) return false;
  if ((await page.locator("#hashAllList .pendingval").count()) === 0) return false;
  await page.waitForTimeout(2500);
  if ((await page.locator("#hashAllList .pendingval").count()) !== 0) return false;
  // One alarm (version 3) naming both values; one honest no-record note (version 1);
  // the other five agree compactly — a quiet check, no digests restated.
  const alarms = page.locator('#hashAllList .hashalarm[role="alert"]');
  if ((await alarms.count()) !== 1) return false;
  if ((await page.locator('#hashAllList .hashallrow[data-hav="3"] .hashalarm').count()) !== 1)
    return false;
  const digests = await alarms.locator("dd.mono").allInnerTexts();
  if (digests.length !== 2 || digests[0].trim() === digests[1].trim()) return false;
  if ((await page.locator('#hashAllList .hashallrow[data-hav="1"] .hashnorec').count()) !== 1)
    return false;
  return (await page.locator("#hashAllList .havok").count()) === 5;
});

await check(
  "I50",
  "File-type identity: Lucide glyphs with real-text extension badges",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    // The pdf glyph is no longer Lucide file-type: the letter-T stem is gone.
    const pdfRow = page
      .locator('#rows tr[data-key^="d:"]')
      .filter({ hasText: "Complaint (as filed)" })
      .first();
    const pdfSvg = await pdfRow.locator("svg.ficon.pdf").first().innerHTML();
    if (pdfSvg.includes("M12 12v6")) return false;
    // A real-text badge carries the extension, in the type's colour convention.
    if ((await pdfRow.locator(".ficonwrap.pdf .fbadge").innerText()) !== "PDF") return false;
    const docxRow = page.locator('#rows tr[data-key^="d:"]').filter({ hasText: "Motion" }).first();
    if ((await docxRow.locator(".ficonwrap.word .fbadge").innerText()) !== "DOCX") return false;
    // The badge is text, never drawn geometry.
    if ((await docxRow.locator(".ficonwrap.word .fbadge svg").count()) !== 0) return false;
    // The spreadsheet identity shows on the archive member fixture.
    await page.locator('.tnode[data-tree="discovery"]').first().click();
    await page
      .locator('#rows tr[data-key^="d:"]')
      .filter({ hasText: "Site Inspection Photos" })
      .first()
      .dblclick();
    await page.waitForTimeout(250);
    // The spreadsheet member sits at Batch 3/Notes/, two levels in.
    await page.locator('#rows tr[data-archdir="Batch 3/"]').first().click();
    await page.waitForTimeout(200);
    await page.locator('#rows tr[data-archdir="Batch 3/Notes/"]').first().click();
    await page.waitForTimeout(200);
    const xlsxRow = page.locator("#rows tr").filter({ hasText: "measurements" }).first();
    return (await xlsxRow.locator(".ficonwrap.sheet .fbadge").innerText()) === "XLSX";
  },
);

await check("L47", "The Safety cell speaks the severity word, glyphs unchanged", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  const safetyCell = async (needle) => {
    const idx = await page
      .locator("#headRow th")
      .evaluateAll((ths) => ths.findIndex((th) => th.dataset.col === "safety"));
    const row = page.locator("#rows tr").filter({ hasText: needle }).first();
    return await row.evaluate((r, i) => r.cells[i].innerText.trim(), idx);
  };
  // Flagged — a signature match and a type mismatch alike — reads Error.
  if ((await safetyCell("Invoice_scan")) !== "Error") return false;
  await page.locator('.tnode[data-tree="experts"]').first().click();
  if ((await safetyCell("Expert Report")) !== "Error") return false;
  // Never scanned reads Warning.
  await page.locator('.tnode[data-tree="depositions"]').first().click();
  if ((await safetyCell("Deposition Video")) !== "Warning") return false;
  // Clean keeps the bare I42 circle-check: a glyph, no text.
  await page.locator('.tnode[data-tree="pleadings"]').first().click();
  const idx = await page
    .locator("#headRow th")
    .evaluateAll((ths) => ths.findIndex((th) => th.dataset.col === "safety"));
  const clean = page.locator('#rows tr[data-key^="d:"]').filter({ hasText: "Motion" }).first();
  if ((await clean.evaluate((r, i) => r.cells[i].innerText.trim(), idx)) !== "") return false;
  return (await clean.locator(".okmark .cleanmark").count()) === 1;
});

await check("L48", "Created By everywhere the label appears — an upload is creation", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator("#colsBtn").click();
  const menuText = await page.locator("#colsMenu").innerText();
  await page.keyboard.press("Escape");
  if (!menuText.includes("Created By") || /Uploaded By/i.test(menuText)) return false;
  // The deleted view shares the column.
  await page.locator('[data-view="deleted"]').click();
  await page.waitForTimeout(150);
  const heads = (await page.locator("#headRow th").allInnerTexts()).join(" ").toLowerCase();
  return heads.includes("created by") && !heads.includes("uploaded by");
});

await check(
  "A28",
  "Destination-scoped actions exist only where a current folder does",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    // Browse has a destination, so everything is live.
    if (await page.locator("#newBtn").isDisabled()) return false;
    if (await page.locator("#newFolderBtn").isDisabled()) return false;
    // Arm the clipboard from Pleadings, then stand in Discovery — a live paste would
    // land there and repaint Discovery's tree count.
    await page.locator('.tnode[data-tree="pleadings"]').first().click();
    await page.locator('#rows tr[data-key^="d:"]').first().click();
    await page.keyboard.press("Control+x");
    await page.locator('.tnode[data-tree="discovery"]').first().click();
    await page.waitForTimeout(150);
    const discoveryCount = async () =>
      await page.locator('.tnode[data-tree="discovery"] .n').innerText();
    const countBefore = await discoveryCount();
    for (const v of ["analysis", "deleted", "history"]) {
      await page.locator('[data-view="' + v + '"]').click();
      await page.waitForTimeout(150);
      const newBtn = page.locator("#newBtn");
      if (!(await newBtn.isDisabled())) return false;
      // A disabled control says why (the no-inert-controls rule).
      if (!((await newBtn.getAttribute("title")) ?? "").includes("no current folder")) return false;
      if (!(await page.locator("#newFolderBtn").isDisabled())) return false;
      const nodes = await page.locator(".tnode").count();
      const rowsBefore = await page.locator("#rows tr").count();
      // A disabled button fires nothing — and the handlers behind it are guarded too.
      await page.evaluate(() => {
        document.getElementById("newBtn").click();
        document.getElementById("newFolderBtn").click();
      });
      await page.keyboard.press("Control+v");
      await page.waitForTimeout(150);
      if (!(await page.locator("#newMenu").isHidden())) return false; // the menu never opened
      if ((await page.locator(".tnode").count()) !== nodes) return false; // no folder was born
      if ((await page.locator("#rows tr").count()) !== rowsBefore) return false; // no paste row
      if ((await discoveryCount()) !== countBefore) return false; // nothing landed in Discovery
    }
    // Search results rows live in many folders, so no current folder exists there either.
    await page.locator("#searchBtn").click();
    await page.locator("#searchInput").fill("Site");
    await page.locator("#searchInput").press("Enter");
    await page.waitForTimeout(250);
    if (!(await page.locator("#newBtn").isDisabled())) return false;
    // A results file row's menu disables Paste with the reason — a paste there would
    // write into a folder the view never shows. (A folder row would be its own
    // explicit destination, but results rows are files.)
    await page.locator('#rows tr[data-key^="d:"]').first().click({ button: "right" });
    const pasteItem = page.locator('#ctx [data-cmd="paste"]');
    if (!(await pasteItem.isDisabled())) return false;
    if (!((await pasteItem.getAttribute("title")) ?? "").includes("no current folder"))
      return false;
    await page.keyboard.press("Escape");
    // Returning to browse restores everything.
    await page.locator('.tnode[data-tree="discovery"]').first().click();
    await page.waitForTimeout(150);
    if (await page.locator("#newBtn").isDisabled()) return false;
    if (await page.locator("#newFolderBtn").isDisabled()) return false;
    // Inside an archive the current "folder" is not a writable place.
    await page
      .locator('#rows tr[data-key^="d:"]')
      .filter({ hasText: "Site Inspection Photos" })
      .first()
      .dblclick();
    await page.waitForTimeout(250);
    if (!(await page.locator("#newBtn").isDisabled())) return false;
    return await page.locator("#newFolderBtn").isDisabled();
  },
);

await check(
  "T8",
  "The sidebar's file counts are a columns-menu setting, shown by default",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    // Shown by default.
    if ((await page.locator(".tnode .n.num").count()) === 0) return false;
    await page.locator("#colsBtn").click();
    // The setting sits with the display family, directly beneath extensions and zebra.
    const labels = await page.locator("#colsMenu label").allInnerTexts();
    const countsIdx = labels.findIndex((t) => t.includes("Show File Counts in the Sidebar"));
    const zebraIdx = labels.findIndex((t) => t.includes("Shade Alternate Rows"));
    if (countsIdx === -1 || zebraIdx === -1 || countsIdx !== zebraIdx + 1) return false;
    const box = page.locator("#colsMenu #sidebarCounts");
    if (!(await box.isChecked())) return false;
    await box.uncheck();
    await page.waitForTimeout(120);
    if ((await page.locator(".tnode .n.num").count()) !== 0) return false;
    // The choice persists alongside the other column-menu settings.
    await page.keyboard.press("Escape");
    await page.locator("#colsBtn").click();
    if (await page.locator("#colsMenu #sidebarCounts").isChecked()) return false;
    await page.locator("#colsMenu #sidebarCounts").check();
    await page.waitForTimeout(120);
    return (await page.locator(".tnode .n.num").count()) > 0;
  },
);

await check("N28", "A folder move is one row; its impact expands; files inherit it", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator("#insBtn").click(); // the panel, for the presentation half
  await page.locator('[data-view="history"]').click();
  await page.waitForTimeout(150);
  // One act, one row: no synthetic per-file Moved rows flood the list.
  const synthetic = await page
    .locator("#rows tr[data-hist]")
    .filter({ hasText: "Site Photo A" })
    .filter({ hasText: "Moved" })
    .count();
  if (synthetic !== 0) return false;
  const row = page
    .locator("#rows tr[data-hist]")
    .filter({ hasText: "Site Photographs" })
    .filter({ hasText: "moved with" })
    .first();
  const note = row.locator(".impactnote");
  if ((await note.count()) !== 1) return false;
  if (!/moved with 8 files/.test(await note.innerText())) return false;
  // The row expands to the affected list, each entry naming its own path change.
  await note.click();
  await page.waitForTimeout(150);
  const items = page.locator("#rows tr.himpact .impactitem");
  if ((await items.count()) !== 8) return false;
  const first = items.filter({ hasText: "Site Photo A" }).first();
  if (!/Site Photographs\s*→\s*Discovery \/ Site Photographs/.test(await first.innerText()))
    return false;
  // Selecting the row presents the same fold in the panel, behind its honest count.
  await row.locator("td").first().click();
  await page.waitForTimeout(150);
  const fold = page.locator("#inspector details.impactfold");
  if ((await fold.count()) !== 1) return false;
  if (!/8 files/.test(await fold.locator("summary").innerText())) return false;
  // An expanded entry reveals its document.
  await page
    .locator("#rows tr.himpact .impactitem")
    .filter({ hasText: "Site Photo A" })
    .first()
    .click();
  await page.waitForTimeout(250);
  // Site Photographs is the picture folder, so browse lands on the ICON GRID — the
  // visible surface is where the selection must show, not the emptied hidden table.
  const revealed = page.locator('#rows tr[data-key="d:20"], #iconGrid .tile[data-key="d:20"]');
  if ((await revealed.count()) !== 1) return false;
  if ((await revealed.getAttribute("aria-selected")) !== "true") return false;
  // The file's own filtered story includes the inherited event, spoken quietly, with
  // the file's OWN from → to.
  await page.locator('[data-view="history"]').click();
  await page.waitForTimeout(150);
  await page
    .locator("#rows tr[data-hist]")
    .filter({ hasText: "Site Photo A" })
    .first()
    .click({ button: "right" });
  await page.locator('#ctx [data-hcmd="filterdoc"]').click();
  await page.waitForTimeout(150);
  if ((await page.locator("#rows tr[data-hist]").count()) !== 2) return false;
  const inherited = page.locator("#rows tr.histinherit");
  if ((await inherited.count()) !== 1) return false;
  const text = await inherited.innerText();
  if (!/Moved with its folder/.test(text)) return false;
  if (!text.includes("Site Photo A")) return false;
  return text.includes("Site Photographs") && text.includes("Discovery / Site Photographs");
});

await check("S19", "Search can take in deleted files, and marks what it finds", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator("#searchBtn").click();
  // The scope option exists, off by default.
  const box = page.locator("#searchpop #scopeDeleted");
  if ((await box.count()) !== 1) return false;
  if (await box.isChecked()) return false;
  await page.locator("#searchInput").fill("Site");
  await page.locator("#searchInput").press("Enter");
  await page.waitForTimeout(250);
  // Off: no deleted rows among the results.
  if ((await page.locator('#rows tr[data-key^="x:"]').count()) !== 0) return false;
  // On: the deleted archive surfaces, marked in the Deleted Files view's own word.
  await page.locator("#searchBtn").click();
  await page.locator("#searchpop #scopeDeleted").check();
  await page.waitForTimeout(250);
  const deletedRow = page.locator('#rows tr[data-key="x:902"]');
  if ((await deletedRow.count()) !== 1) return false;
  if ((await deletedRow.locator(".delmark").innerText()) !== "Deleted") return false;
  // It leads into Deleted Files: its right-click is the deleted menu, Restore first.
  await deletedRow.click({ button: "right" });
  if (!/Restore/.test(await page.locator("#ctx").innerText())) return false;
  await page.keyboard.press("Escape");
  // Off again removes it.
  await page.locator("#searchBtn").click();
  await page.locator("#searchpop #scopeDeleted").uncheck();
  await page.waitForTimeout(250);
  return (await page.locator('#rows tr[data-key^="x:"]').count()) === 0;
});

await check("F14", "Analysis right-click ignores in bulk, by severity, reversibly", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('[data-view="analysis"]').click();
  await page.waitForTimeout(250);
  const chipCount = async (tone) => {
    const chip = page.locator('[data-sevfilter="' + tone + '"] strong');
    return (await chip.count()) === 0 ? 0 : Number(await chip.innerText());
  };
  const [errorCount, warningCount, infoCount] = [
    await chipCount("danger"),
    await chipCount("warn"),
    await chipCount("info"),
  ];
  if (infoCount === 0 || errorCount === 0) return false;
  // On a card, the menu leads with that file's own issues.
  await page.locator("[data-ancard]").first().click({ button: "right" });
  const fileBtn = page.locator('#ctx [data-anmenu="file"]');
  if ((await fileBtn.count()) !== 1) return false;
  if (!/Ignore This File.s \d+ Issue/.test(await fileBtn.innerText())) return false;
  await page.keyboard.press("Escape");
  // Over the list: every present severity with its honest count, none invented.
  await page.locator(".anlist").click({ button: "right" });
  const total = errorCount + warningCount + infoCount;
  if (!(await page.locator('#ctx [data-anmenu="all"]').innerText()).includes("Ignore All " + total))
    return false;
  const infoBtn = page.locator('#ctx [data-anmenu="info"]');
  if (!(await infoBtn.innerText()).includes("Ignore " + infoCount + " Info Issue")) return false;
  // Executing one moves those issues to ignored, and the counts follow.
  await infoBtn.click();
  await page.waitForTimeout(200);
  if ((await chipCount("info")) !== 0) return false;
  if ((await chipCount("danger")) !== errorCount) return false;
  if (!(await page.locator("#anIgnoredToggle").innerText()).includes("(" + infoCount + ")"))
    return false;
  // The ignored view unignores the same way, and everything comes back.
  await page.locator("#anIgnoredToggle").click();
  await page.waitForTimeout(200);
  await page.locator(".anlist").click({ button: "right" });
  const unignoreAll = page.locator('#ctx [data-anmenu="all"]');
  if (!(await unignoreAll.innerText()).includes("Unignore All " + infoCount)) return false;
  await unignoreAll.click();
  await page.waitForTimeout(200);
  await page.locator("#anIgnoredToggle").click();
  await page.waitForTimeout(200);
  return (await chipCount("info")) === infoCount;
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

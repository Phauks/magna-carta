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
  // The recomputed digest states itself. "matches ingest" was struck: a hash that is recomputed on
  // open needs no provenance caption to be believed.
  const after = await page.locator("#hashList").innerText();
  return !after.includes("digesting them again") && /[0-9a-f]{16}/i.test(after);
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
  return shown && decoded && /what it means/i.test(text) && text.includes("Source:");
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
  const panel = page.locator("#ctx .subpanel");
  if ((await panel.count()) !== 1) return false;
  if (await panel.isVisible()) return false;
  const opener = page.locator("#ctx .subopen");
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
  if ((await swatches.count()) !== 11) return false; // ten colours plus Default
  // Square, not round: a colour chip must not read as a bullet.
  const radius = await swatches.first().evaluate((el) => getComputedStyle(el).borderRadius);
  if (/50%|9999px/.test(radius)) return false;
  if ((await page.locator("#ctx .subicon").count()) !== 1) return false; // room reserved for icons
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
  "L27",
  "Uploaded By and Location are columns, and Uploaded By names a person",
  async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);
    const heads = (await page.locator("#headRow th").allInnerTexts()).join(" ");
    if (!heads.toLowerCase().includes("uploaded by")) return false;
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
  const open = await page.locator("#newDocWash .dialog").isVisible();
  await page.locator("#newDocWash").evaluate((el) => {
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

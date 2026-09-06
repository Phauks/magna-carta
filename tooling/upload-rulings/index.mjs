// Checks the BUILT Upload dialog and upload tray against the owner's standing rulings (the R19
// round in docs/conventions/file-manager-rulings.md), by driving the dev gallery that runs the real
// components over the real upload queue with a timed stand-in for the network.
//
// WHY THE GALLERY AND NOT THE MOCKUP. tooling/file-manager-rulings/ pins the retired self-contained
// mockup, which never had this dialog; the built dialog lives in apps/web and can only be looked at
// where it renders. The gallery (/developer-console/upload-states) exists for exactly that, so a
// ruling that a later round silently undoes fails here instead of reaching the owner.
//
// Run with the web dev server up:  pnpm check:upload-rulings [http://localhost:5173/developer-console/upload-states]
import { chromium } from "@playwright/test";

const pageUrl = process.argv[2] ?? "http://localhost:5173/developer-console/upload-states";
const executablePath = process.env.MC_CHROMIUM_PATH;
const browser = await chromium.launch(
  executablePath === undefined || executablePath === "" ? {} : { executablePath },
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15_000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 60_000 });

const results = [];
const check = async (id, label, fn) => {
  try {
    const ok = await fn();
    results.push([ok ? "PASS" : "FAIL", id, label]);
  } catch (error) {
    results.push(["ERROR", id, `${label} — ${error.message}`]);
  }
};

const dialog = page.locator('[data-modal-shell="action-dialog"]').first();
const intakePane = dialog.locator(".mc-modal-frame-pane");
const sourcePane = dialog.locator(".mc-modal-frame-context");
const sourceTable = sourcePane.locator("table");

await page.getByRole("button", { name: "Open Holding the Fixture" }).click();
await dialog.waitFor();
await page.waitForTimeout(500);

await check("A20", "Intake on the left, source on the right", async () => {
  const intake = await intakePane.innerText();
  const source = await sourcePane.innerText();
  const intakeBox = await intakePane.boundingBox();
  const sourceBox = await sourcePane.boundingBox();
  return (
    /destination/i.test(intake) &&
    /on arrival/i.test(intake) &&
    /source/i.test(source) &&
    (await sourceTable.count()) === 1 &&
    intakeBox !== null &&
    sourceBox !== null &&
    intakeBox.x < sourceBox.x
  );
});

await check("A26", "The matter field holds the matter on screen at rest", async () => {
  const value = await intakePane.getByRole("combobox").first().inputValue();
  return value === "Pemberton v. Hale";
});

await check(
  "A27",
  "Date Created offers the file's own date and the upload date; the file's own leads",
  async () => {
    const own = intakePane.getByRole("radio", { name: /file's own date/i });
    const upload = intakePane.getByRole("radio", { name: /upload date/i });
    return (
      (await own.count()) === 1 &&
      (await upload.count()) === 1 &&
      (await own.getAttribute("aria-checked")) === "true"
    );
  },
);

await check("A21", "One Add control, offering files or a folder; no second chooser", async () => {
  const adds = sourcePane.getByRole("button", { name: /^add$/i });
  if ((await adds.count()) !== 1) return false;
  await adds.click();
  const items = page.getByRole("menuitem");
  const labels = (await items.allInnerTexts()).map((text) => text.trim().toLowerCase());
  await page.keyboard.press("Escape");
  return (
    labels.length === 2 &&
    labels.some((label) => label === "files") &&
    labels.some((label) => label.startsWith("a folder")) &&
    (await sourcePane.getByRole("button", { name: /choose a folder/i }).count()) === 0
  );
});

await check(
  "A22",
  "The source is the one grid, nested, with Status pinned to the trailing edge",
  async () => {
    const heads = (await sourceTable.locator("thead th").allInnerTexts()).map((text) =>
      text.trim().toLowerCase(),
    );
    const twisties = sourceTable.locator("tbody button[aria-expanded]");
    const statusHead = sourceTable.locator('thead th[data-pinned-end="true"]');
    const rows = await sourceTable.locator("tbody tr").count();
    return (
      heads.includes("name") &&
      heads.includes("status") &&
      !heads.includes("folder") &&
      (await twisties.count()) >= 2 &&
      (await statusHead.count()) === 1 &&
      /status/i.test(await statusHead.innerText()) &&
      rows >= 8
    );
  },
);

await check("A22b", "A folder row folds its children away and opens them again", async () => {
  const before = await sourceTable.locator("tbody tr").count();
  const twisty = sourceTable.locator("tbody button[aria-expanded]").first();
  await twisty.click();
  const folded = await sourceTable.locator("tbody tr").count();
  await twisty.click();
  const reopened = await sourceTable.locator("tbody tr").count();
  return folded < before && reopened === before;
});

const framesBefore = {
  dialog: await dialog.boundingBox(),
  table: await sourceTable.boundingBox(),
  addButton: await sourcePane.getByRole("button", { name: /^add$/i }).boundingBox(),
  matterField: await intakePane.getByRole("combobox").first().boundingBox(),
};

await page.getByRole("button", { name: "Upload", exact: true }).click();
await page.waitForTimeout(700);

await check("A23", "Nothing moves when Upload is pressed", async () => {
  const same = (a, b) =>
    a !== null &&
    b !== null &&
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1;
  const after = {
    dialog: await dialog.boundingBox(),
    table: await sourceTable.boundingBox(),
    addButton: await sourcePane.getByRole("button", { name: /^add$/i }).boundingBox(),
    matterField: await intakePane.getByRole("combobox").first().boundingBox(),
  };
  const controlsDisabled =
    (await intakePane.getByRole("combobox").first().isDisabled()) &&
    (await sourcePane.getByRole("button", { name: /^add$/i }).isDisabled());
  return (
    same(framesBefore.dialog, after.dialog) &&
    same(framesBefore.table, after.table) &&
    same(framesBefore.addButton, after.addButton) &&
    same(framesBefore.matterField, after.matterField) &&
    controlsDisabled
  );
});

await check(
  "A31a",
  "A file is read before it is sent, and the row says how far the read has got",
  async () => {
    // The stand-in plays the read over one beat once the file's folder exists.
    const reading = sourceTable.locator("tbody td:last-child", { hasText: /reading · \d+%/i });
    await reading.first().waitFor({ timeout: 6_000 });
    return true;
  },
);

await check(
  "A29",
  "A sending row says how far it has got, and the transfer can be cancelled",
  async () => {
    // The stand-in makes the folders and reserves before any byte moves; look once a row is sending.
    const sending = sourceTable.locator("tbody td:last-child", { hasText: /sending · \d+%/i });
    await sending.first().waitFor({ timeout: 8_000 });
    const cancel = sourcePane.getByRole("button", { name: /cancel upload/i });
    return (await cancel.count()) === 1;
  },
);

await check("A32", "The tally reads the rate while bytes move", async () => {
  // The rate needs two samples a moment apart with bytes between them; give the window a beat.
  const tally = sourcePane.locator('[role="status"]', { hasText: /\d(\.\d)? [KMG]?B\/s/ });
  await tally.first().waitFor({ timeout: 6_000 });
  return true;
});

// Let the stand-in finish: six files, four stages, at the gallery's default beat.
await page.waitForTimeout(9_000);

await check(
  "A18",
  "A file that did not go reads Upload failed; one that did reads Uploaded",
  async () => {
    const statuses = (await sourceTable.locator("tbody td:last-child").allInnerTexts()).map(
      (text) => text.trim(),
    );
    return statuses.includes("Upload failed") && statuses.includes("Uploaded");
  },
);

await check(
  "A31b",
  "A file the matter already holds reads Already here, and nothing was sent for it",
  async () => {
    const statuses = (await sourceTable.locator("tbody td:last-child").allInnerTexts()).map(
      (text) => text.trim(),
    );
    const line = await sourcePane.locator('[role="status"]').first().innerText();
    return statuses.includes("Already here") && /1 already here/.test(line);
  },
);

await check("A24a", "The way to try again sits beside the failure, in the panel", async () => {
  return (await sourcePane.getByRole("button", { name: /retry failed/i }).count()) === 1;
});

await check(
  "A24b",
  "Close leaves the batch to the tray, which shows it with Retry and Open Folder",
  async () => {
    await dialog.locator('[data-action-dialog-action="dismiss"]').click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Uploads" }).click();
    const tray = page.locator(".mc-popover-content").filter({ hasText: "Uploads" }).first();
    await tray.waitFor();
    const text = await tray.innerText();
    const ok =
      /pemberton v\. hale/i.test(text) &&
      /3 of 6 uploaded · 1 already here · 2 failed/i.test(text) &&
      (await tray.getByRole("button", { name: /retry failed/i }).count()) === 1 &&
      (await tray.getByRole("link", { name: /open folder/i }).count()) === 1;
    await page.keyboard.press("Escape");
    return ok;
  },
);

await check("A25", "Leaving the panel with files chosen asks first", async () => {
  await page.getByRole("button", { name: "Open Holding the Fixture" }).click();
  await dialog.waitFor();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  const question = page.locator('[data-modal-shell="discard-question"]');
  await question.waitFor();
  const asks = (await question.getByRole("button", { name: /discard changes/i }).count()) === 1;
  await question.getByRole("button", { name: /keep editing/i }).click();
  return asks;
});

await browser.close();

for (const [status, id, label] of results)
  console.log(`${status.padEnd(5)} ${id.padEnd(5)} ${label}`);
const failed = results.filter(([status]) => status !== "PASS");
if (pageErrors.length > 0) {
  console.log("\nPage errors:");
  for (const error of pageErrors) console.log(`  ${error}`);
}
console.log(
  `\n${String(results.length - failed.length)} of ${String(results.length)} rulings hold.`,
);
process.exit(failed.length === 0 && pageErrors.length === 0 ? 0 : 1);

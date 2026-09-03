import { expect, type Page, test } from "@playwright/test";
import { readSeededTenant } from "./seeded-credentials.ts";

/*
 * The matter Activity section, driven against the real Worker.
 *
 * This is the one screen whose whole point is that fourteen subsystems reach it through one read, so
 * it is also the one screen a node-environment test cannot say anything useful about: the assertion
 * that matters is that a matter with real files, real notes and a real opening renders them together,
 * in order, under one request.
 */

let email = "";
let password = "";
let seededMatterId = "";
test.beforeAll(() => {
  const tenant = readSeededTenant();
  ({ email, password } = tenant.credentials);
  seededMatterId = tenant.matterId;
});

/** A note of this run's own on the seeded matter, so a second subsystem is certain to be there. */
async function writeNote(page: Page, body: string): Promise<void> {
  const written = await page.request.post(`/api/v1/matters/${seededMatterId}/notes`, {
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    data: { body },
  });
  expect(written.status(), await written.text()).toBe(201);
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email Address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
}

test("the matter's activity reads every subsystem in one request", async ({ page }) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(`pageerror: ${error.message}`));

  const timelineReads: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/timeline")) {
      timelineReads.push(`${String(response.status())} ${response.url()}`);
    }
  });

  const line = `Reviewed the file before the hearing. ${crypto.randomUUID().slice(0, 8)}`;
  await signIn(page);
  await writeNote(page, line);
  await page.goto(`/matters/${seededMatterId}/activity`);

  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();

  // The seeded matter carries files and now carries a note, so two subsystems that share no table
  // reach this screen through the one federated read. Each row leads with what its own subsystem
  // calls it — named by that subsystem's own describe statement on the server, behind its own read
  // capability — a file by its name, a note by its opening line.
  await expect(page.getByRole("cell", { name: "Client Letter.txt" })).toBeVisible({
    timeout: 15_000,
  });
  // A note opens in its window on this screen, so its name is a button rather than a link out.
  await expect(page.getByRole("button", { name: line })).toBeVisible();

  expect(
    timelineReads,
    "the whole screen is one federated read that also names its rows, so exactly one request answers it",
  ).toHaveLength(1);
  expect(clientErrors).toEqual([]);
});

test("the register is the product's table: it sorts, and a column's controls are on the column", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/matters/${seededMatterId}/activity`);
  await expect(page.getByRole("cell", { name: "Client Letter.txt" })).toBeVisible({
    timeout: 15_000,
  });

  // The chronology opens newest first, so the first row is the newest day. Pressing Date turns it
  // round — the shared grid's sorting, not a control this screen wrote for itself.
  const firstDate = () => page.getByRole("row").nth(1).getByRole("cell").first();
  const newestFirst = ((await firstDate().textContent()) ?? "").trim();
  // Exact: a note whose opening line mentions a date is a button too, now that notes open here.
  await page.getByRole("button", { name: "Date", exact: true }).click();
  await expect
    .poll(async () => ((await firstDate().textContent()) ?? "").trim())
    .not.toBe(newestFirst);

  // And a column's controls are summoned from the column: right-clicking its heading opens the
  // shared grid's own head menu, and hiding the column through it actually hides the column.
  // There is no Columns button anywhere on the surface.
  await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);
  await page.getByRole("columnheader", { name: "Details" }).click({ button: "right" });
  const headMenu = page.getByRole("menu");
  await expect(headMenu).toBeVisible();
  await headMenu.getByRole("menuitem", { name: "Hide Details" }).click();
  await expect(page.getByRole("columnheader", { name: "Details" })).toHaveCount(0);
});

test("a document row is named by its file and typed by what the file manager says it is", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/matters/${seededMatterId}/activity`);

  // Not "Document" on every row, and not a name suffix either: the file manager identifies the file
  // from its content type and its name, and the Activity section shows that identification. The
  // Section column says which part of the matter the row belongs to.
  const row = page.getByRole("row", { name: /Case Documents\.zip/ });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole("cell", { name: "Files", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "Archive", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: /2\.1 KB/ })).toBeVisible();
});

test("a note is written from the Activity section and appears on it", async ({ page }) => {
  await signIn(page);
  await page.goto(`/matters/${seededMatterId}/activity`);
  await expect(page.getByRole("cell", { name: "Client Letter.txt" })).toBeVisible({
    timeout: 15_000,
  });

  // The screen lists everything, so it can make the records a contribution offers a window for —
  // today, a note, in the same window the Notes section opens.
  const line = `Written from the chronology. ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: "New Note" }).click();
  const window = page.getByRole("dialog");
  await expect(window).toBeVisible();
  await window.getByRole("textbox", { name: /note/i }).first().fill(line);
  await window.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: line })).toBeVisible({ timeout: 15_000 });
});

test("a row opens onto the record: a file in its inspector, a note in its window", async ({
  page,
}) => {
  const line = `Opened from the chronology. ${crypto.randomUUID().slice(0, 8)}`;
  await signIn(page);
  await writeNote(page, line);
  await page.goto(`/matters/${seededMatterId}/activity`);
  await expect(page.getByRole("cell", { name: "Client Letter.txt" })).toBeVisible({
    timeout: 15_000,
  });

  // A note opens in the note window, right here, read by its id: the window's Note field holds
  // the words the row was named by.
  await page.getByRole("button", { name: line }).click();
  const window = page.getByRole("dialog");
  await expect(window).toBeVisible();
  await expect(window.getByRole("textbox", { name: /note/i }).first()).toHaveValue(line, {
    timeout: 10_000,
  });
  await page.keyboard.press("Escape");

  // A file follows its deep link into the Files section, which honours the entry it was handed:
  // the file's row is selected and the inspector shows it, rather than the reader landing on a
  // list and finding the file again.
  await page.getByRole("link", { name: "Case Documents.zip" }).click();
  await expect(page).toHaveURL(/\/files\?entry=/);
  await expect(
    page.locator('[data-state="selected"]', { hasText: "Case Documents.zip" }).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("the Overview's Recent activity is the same register, one step from the whole chronology", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/matters/${seededMatterId}/overview`);
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();

  // The tile is the register with a row budget: rows appear, and never more than eight of them.
  // WHICH rows is the timeline's own order — a note sorts by the day it is about, so among the
  // many same-day notes the walks before this one wrote, no one of them is certain to be on top.
  const tile = page.getByRole("table", { name: "The newest entries recorded on this matter" });
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => tile.getByRole("row").count(), { timeout: 15_000 })
    .toBeGreaterThan(1);
  expect(await tile.getByRole("row").count()).toBeLessThanOrEqual(9);

  await page.getByRole("link", { name: "See all activity" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
});

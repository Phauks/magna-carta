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
  // calls it, read back through that subsystem's own access gate — a file by its name, a note by
  // its opening line.
  await expect(page.getByRole("cell", { name: "Client Letter.txt" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("link", { name: line })).toBeVisible();

  expect(
    timelineReads,
    "the whole screen is one federated read, so exactly one request answers it",
  ).toHaveLength(1);
  expect(clientErrors).toEqual([]);
});

test("the register is the product's table: it sorts, and the columns menu is its own", async ({
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
  await page.getByRole("button", { name: "Date" }).click();
  await expect
    .poll(async () => ((await firstDate().textContent()) ?? "").trim())
    .not.toBe(newestFirst);

  // And the columns are the reader's to arrange — by right-clicking the register, which is the
  // gesture this product teaches everywhere else an act belongs to a list. There is no button.
  await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);
  await page.getByRole("columnheader", { name: "Kind" }).click({ button: "right" });
  const columnsMenu = page.getByRole("menu");
  await expect(columnsMenu).toBeVisible();
  await expect(columnsMenu.getByRole("menuitemcheckbox", { name: "Details" })).toBeVisible();

  // Hiding a column through it actually hides the column.
  await columnsMenu.getByRole("menuitemcheckbox", { name: "Details" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("columnheader", { name: "Details" })).toHaveCount(0);
});

test("a document row is named by its file and typed by its real extension", async ({ page }) => {
  await signIn(page);
  await page.goto(`/matters/${seededMatterId}/activity`);

  // Not "Document" on every row: the file manager's settled convention is that a file's type is its
  // real extension, and the same helper decides it on both surfaces.
  const row = page.getByRole("row", { name: /Case Documents\.zip/ });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole("cell", { name: "zip", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "2.1 KB" })).toBeVisible();
});

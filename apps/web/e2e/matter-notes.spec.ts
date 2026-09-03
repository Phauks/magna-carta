import { expect, type Page, test } from "@playwright/test";
import { readSeededTenant } from "./seeded-credentials.ts";

/*
 * The matter Notes section, driven against the real Worker.
 *
 * Two things are asserted here that no node-environment test can reach. The list must SETTLE — the
 * skeleton means "the first read is in flight", so a section that never leaves it is
 * indistinguishable from a firm whose record cannot be read at all — and a note must be writable
 * end to end through the window it opens in, attachments and all, because that path crosses the
 * browser, the SPA router, the chokepoint and three writes.
 *
 * Each test that needs an empty matter creates its own: the seeded tenant is resumed between runs,
 * so a test that asserted "no notes" against the shared matter would pass once and fail forever.
 */

let email = "";
let password = "";
let seededMatterId = "";
test.beforeAll(() => {
  const tenant = readSeededTenant();
  ({ email, password } = tenant.credentials);
  seededMatterId = tenant.matterId;
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email Address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
}

/*
 * A matter of this run's own, so "this matter has no notes" stays true on a re-run.
 *
 * Opened as a PROSPECTIVE consultation rather than an open matter: opening one draws the firm's
 * next matter number, and the dev tenant is seeded without a numbering scheme. A note does not care
 * which of the two it sits on.
 */
async function createMatter(page: Page, title: string): Promise<string> {
  const session = await page.request.get("/api/v1/me");
  expect(session.ok(), await session.text()).toBeTruthy();
  const { user } = (await session.json()) as { user: { id: string } };

  const created = await page.request.post("/api/v1/matters", {
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    data: { title, status: "prospective", responsibleMemberId: user.id },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { matterId: string }).matterId;
}

test("a matter with no notes settles on the empty state", async ({ page }) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(`pageerror: ${error.message}`));

  const noteReads: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/notes")) {
      noteReads.push(`${String(response.status())} ${response.url()}`);
    }
  });

  await signIn(page);
  const matterId = await createMatter(page, `Quiet Matter ${crypto.randomUUID().slice(0, 8)}`);
  await page.goto(`/matters/${matterId}/notes`);

  await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
  await expect(page.getByText("No notes on this matter yet.")).toBeVisible({ timeout: 15_000 });

  expect(noteReads, "the section must actually read the matter's notes").not.toHaveLength(0);
  expect(clientErrors).toEqual([]);
});

test("a matter's existing notes are listed", async ({ page }) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(`pageerror: ${error.message}`));

  await signIn(page);
  const matterId = await createMatter(page, `Recorded Matter ${crypto.randomUUID().slice(0, 8)}`);

  const written = await page.request.post(`/api/v1/matters/${matterId}/notes`, {
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    data: { body: "Called the client about the hearing date.", occurredOn: "2026-08-30" },
  });
  expect(written.status(), await written.text()).toBe(201);

  await page.goto(`/matters/${matterId}/notes`);
  await expect(page.getByText("Called the client about the hearing date.")).toBeVisible({
    timeout: 15_000,
  });
  expect(clientErrors).toEqual([]);
});

test("New Note opens the record window, states what will be stored, and writes the note", async ({
  page,
}) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(`pageerror: ${error.message}`));

  await signIn(page);
  const matterId = await createMatter(page, `Composed Matter ${crypto.randomUUID().slice(0, 8)}`);
  await page.goto(`/matters/${matterId}/notes`);
  await expect(page.getByText("No notes on this matter yet.")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "New Note" }).click();

  // Every generated field the note will carry is on screen before anything is typed.
  const window = page.getByRole("dialog");
  await expect(window.getByText("Matter", { exact: true })).toBeVisible();
  await expect(window.getByText("Written By", { exact: true })).toBeVisible();
  await expect(window.getByText("Written", { exact: true })).toBeVisible();

  await window
    .getByRole("textbox", { name: "Note" })
    .fill("Left a voicemail for opposing counsel.");
  await window.getByLabel("Date", { exact: true }).fill("2026-08-28");
  await window.getByLabel("Time", { exact: true }).fill("14:30");
  await window.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Left a voicemail for opposing counsel.")).toBeVisible({
    timeout: 15_000,
  });
  expect(clientErrors).toEqual([]);
});

test("a document is attached in the window before the note exists, and rides the saved note", async ({
  page,
}) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(`pageerror: ${error.message}`));

  await signIn(page);
  // The seeded matter is the one that holds files, so it is the one that can prove this.
  await page.goto(`/matters/${seededMatterId}/notes`);
  await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New Note" }).click();
  const window = page.getByRole("dialog");
  const body = `Reviewed the filed document. ${crypto.randomUUID().slice(0, 8)}`;
  await window.getByRole("textbox", { name: "Note" }).fill(body);

  // The picker offers the matter's own documents while the note is still a draft.
  await window.getByRole("button", { name: "From the Matter" }).click();
  const firstDocument = page.getByRole("option").first();
  await expect(firstDocument).toBeVisible({ timeout: 10_000 });
  const documentName = ((await firstDocument.textContent()) ?? "").trim();
  await firstDocument.click();

  // Held, not written: the note does not exist yet, so nothing has been attached to anything.
  await expect(window.getByText(documentName, { exact: false })).toBeVisible();

  await window.getByRole("button", { name: "Save", exact: true }).click();

  const row = page.locator("button", { hasText: body });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByRole("dialog").getByText(documentName, { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  expect(clientErrors).toEqual([]);
});

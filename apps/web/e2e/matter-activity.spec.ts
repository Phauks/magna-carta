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
  // calls it, read back through that subsystem's own access gate.
  await expect(page.getByText("Document", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(line)).toBeVisible();

  expect(
    timelineReads,
    "the whole screen is one federated read, so exactly one request answers it",
  ).toHaveLength(1);
  expect(clientErrors).toEqual([]);
});

test("a band narrows the read itself, and All puts it back", async ({ page }) => {
  const line = `Called opposing counsel about the schedule. ${crypto.randomUUID().slice(0, 8)}`;
  await signIn(page);
  await writeNote(page, line);
  await page.goto(`/matters/${seededMatterId}/activity`);
  await expect(page.getByText("Document", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  const narrowed = page.waitForRequest(
    (request) => request.url().includes("/timeline") && request.url().includes("kind="),
  );
  await page.getByRole("button", { name: "Written Record" }).click();
  // Narrowing is a NEW read with the sources named, not a filter applied to rows already on screen:
  // the server narrows its registry before it builds a statement.
  await narrowed;
  await expect(page.getByText(line)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Document", { exact: true })).toHaveCount(0);

  // All is a pressed control rather than an absence, and pressing it puts every band back.
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText("Document", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
});

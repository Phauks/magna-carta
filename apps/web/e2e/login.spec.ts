import { expect, type Page, test } from "@playwright/test";
import { readSeededTenant } from "./seeded-credentials.ts";

// The login flow and the (app) session guard, driven against the real Worker. Each test gets its own
// browser context (Playwright's default isolation), so the unauthenticated guard test never inherits a
// session from a sign-in test. Credentials come from the seed setup via the on-disk tenant.

// Read inside beforeAll, not at module scope: Playwright collects (imports) every spec before the
// "setup" project runs, and the tenant file does not exist until setup has seeded it.
let email = "";
let password = "";
test.beforeAll(() => {
  ({ email, password } = readSeededTenant().credentials);
});

async function fillAndSubmit(
  page: Page,
  values: { email: string; password: string },
): Promise<void> {
  await page.locator("#login-email").fill(values.email);
  await page.locator("#login-password").fill(values.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an unauthenticated visit to an (app) route redirects to /login carrying the return path", async ({
  page,
}) => {
  await page.goto("/home");
  // The guard (apps/web/src/routes/(app)/+layout.ts) sees a 401 from /api/v1/me and redirects to
  // /login with the attempted path url-encoded as `next` (encodeURIComponent("/home") === "%2Fhome").
  await expect(page).toHaveURL(/\/login\?next=%2Fhome$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("valid credentials sign in, land in the app, and set the session cookie", async ({ page }) => {
  await page.goto("/login");
  await fillAndSubmit(page, { email, password });
  // No `next`, so sign-in lands on the default return path.
  await expect(page).toHaveURL(/\/home$/);
  const cookies = await page.context().cookies();
  expect(
    cookies.some((cookie) => cookie.name.includes("session_token")),
    "expected a Better Auth session cookie after sign-in",
  ).toBeTruthy();
});

test("a wrong password keeps the user on /login and shows the credentials error", async ({
  page,
}) => {
  await page.goto("/login");
  await fillAndSubmit(page, { email, password: `${password}-wrong` });
  await expect(
    page.getByText("That email and password do not match", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("an off-origin `next` is rejected — sign-in lands on a local path, never off-origin", async ({
  page,
}) => {
  // A protocol-relative `next` (//evil.example) would, if honoured raw, bounce a just-authenticated
  // user off-site. safeReturnPath must collapse it to the local default; this proves the guard is
  // actually wired to it (the return-path unit test proves the function in isolation).
  await page.goto("/login?next=//evil.example");
  await fillAndSubmit(page, { email, password });
  await expect(page).toHaveURL(/\/home$/);
  const landed = new URL(page.url());
  expect(landed.host).toBe("localhost:8787");
  expect(landed.pathname).toBe("/home");
});

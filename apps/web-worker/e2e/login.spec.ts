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

// Sign-in is identifier-first: the email step hands off to the password step in the SAME route, so
// every sign-in walks both steps and the URL never moves.
async function fillAndSubmit(
  page: Page,
  values: { email: string; password: string },
): Promise<void> {
  await page.locator("#login-email").fill(values.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#login-password").fill(values.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an unauthenticated visit to an (app) route redirects to /login carrying the return path", async ({
  page,
}) => {
  await page.goto("/home");
  // The guard (apps/web-worker/src/routes/(app)/+layout.ts) sees a 401 from /api/v1/me and redirects to
  // /login with the attempted path url-encoded as `next` (encodeURIComponent("/home") === "%2Fhome").
  await expect(page).toHaveURL(/\/login\?next=%2Fhome$/);
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
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

test("a wrong password keeps the user on /login and shows the unspecific credentials error", async ({
  page,
}) => {
  await page.goto("/login");
  await fillAndSubmit(page, { email, password: `${password}-wrong` });
  await expect(
    page.getByText("That email and password combination doesn't match our records", {
      exact: false,
    }),
  ).toBeVisible();
  // The URL never moves between steps, so it cannot report which step the visitor reached.
  await expect(page).toHaveURL(/\/login$/);
  // The message says to check both, so both halves of the credential are marked invalid — the
  // password here, and the email when the visitor steps back to it.
  await expect(page.locator("#login-password")).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.locator("#login-email")).toHaveAttribute("aria-invalid", "true");
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

test("there is no way to register — the door says so and offers no link", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Access is provisioned by your firm's administrator.")).toBeVisible();
  await expect(page.getByText("No self-service registration.")).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up|register|create account/i })).toHaveCount(0);
});

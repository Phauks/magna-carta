import { expect, type Page, test } from "@playwright/test";
import { readSeededTenant } from "./seeded-credentials.ts";

/*
 * The header's Build Information panel, driven against the real Worker.
 *
 * WHY THIS EXISTS AT ALL. Every other test of this panel reads its SOURCE — the node pool cannot
 * mount a design-system component, because a deliberate boundary gate keeps bits-ui out of every
 * config outside the design system, so `test/version-overlay.test.ts` asserts the component's rules
 * by regex over the file. That is the right trade for the rules it pins (that a signed-out panel
 * issues no authenticated request at all, for every path into the call, not just the one a render
 * happened to exercise) and it is worth being honest about its limit: a source scan cannot tell you
 * the panel OPENS. It cannot tell you the sections render, that a fold survives a reload, or that
 * the reads land — all of which are what a reader means when they say the panel works.
 *
 * So the behaviour that needs a browser is asserted here, and nothing that a pure model test already
 * covers is repeated: the wording of every row, every state's label and every copy line stay in the
 * node-pool tests where they run in milliseconds.
 */

let email = "";
let password = "";
test.beforeAll(() => {
  ({ email, password } = readSeededTenant().credentials);
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email Address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
}

/** The chip, by the accessible name it carries on every screen — the build is part of that name. */
function chip(page: Page) {
  return page.getByRole("button", { name: /^Build Information:/ });
}

test("the panel opens and its sections settle", async ({ page }) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(`pageerror: ${error.message}`));

  await signIn(page);
  await chip(page).click();

  // Deployment and Database are the two subjects every signed-in panel has. Upload readiness is
  // gated on a permission and Workers on a fleet that answered, so neither is asserted here.
  await expect(page.getByRole("button", { name: "Deployment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Database" })).toBeVisible();

  // SETTLING is the property. A section that never leaves its skeleton is indistinguishable, to a
  // reader, from a deployment that cannot be read at all — and the skeleton is `inert`, so the rows
  // arriving is what makes the region interactive.
  await expect(page.getByText("magna-carta", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  expect(clientErrors).toEqual([]);
});

test("a fold is remembered across a reload", async ({ page }) => {
  await signIn(page);
  await chip(page).click();

  const databaseHeading = page.getByRole("button", { name: "Database" });
  await expect(databaseHeading).toHaveAttribute("aria-expanded", "true");
  await databaseHeading.click();
  await expect(databaseHeading).toHaveAttribute("aria-expanded", "false");

  // The fold rides a persisted preference, so it must survive the tab and not merely the popover.
  await page.reload();
  await chip(page).click();
  await expect(page.getByRole("button", { name: "Database" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Put it back, so a re-run starts where this one did.
  await page.getByRole("button", { name: "Database" }).click();
});

test("the command palette opens the panel, because the registry is what makes it reachable", async ({
  page,
}) => {
  await signIn(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/search/i).fill("build information");
  await page.getByRole("option", { name: "Build Information" }).click();

  // The panel's own header, which only exists once the popover is open.
  await expect(page.getByText("Build Versions")).toBeVisible();
});

test("the signed-out panel states the boundary instead of reporting an outage", async ({
  page,
}) => {
  const authenticatedReads: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/v1\/meta\/(versions|database-health)/.test(request.url())) {
      authenticatedReads.push(request.url());
    }
  });

  await page.goto("/login");
  await chip(page).click();

  await expect(page.getByText(/report their versions once you are signed in/)).toBeVisible();
  // The negative is the one that matters: a signed-out panel has no path to the aggregate at all,
  // so it must not even attempt the call and render the rejection as a fault.
  expect(authenticatedReads).toEqual([]);
});

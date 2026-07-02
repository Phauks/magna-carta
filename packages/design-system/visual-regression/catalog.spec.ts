/*
 * The visual-regression sweep: one screenshot per story x theme x mode over the static catalog
 * build (storybook-static/), compared against the committed container-authoritative baselines
 * in ./baselines (discipline: ./README.md).
 *
 * The matrix is DYNAMIC on both axes: stories come from the static build's index.json (a new
 * story is covered automatically on the next run), themes/modes come from
 * .storybook/catalog-matrix.ts (the same single source the Storybook toolbar uses — a new theme
 * extends this sweep with no changes here).
 *
 * Theme and mode reach the preview through Storybook's globals-in-URL syntax:
 *   iframe.html?id=<story>&viewMode=story&globals=theme:slate;mode:dark
 * (key:value pairs, semicolon-separated — storybook.js.org "Args"/"Globals", same `;`/`:`
 * delimiting as the args param). The syntax is PINNED empirically below: each test asserts the
 * decorator actually applied `data-theme` and the `dark` class before screenshotting, so a
 * Storybook upgrade that changes URL parsing fails loudly instead of shipping identical
 * light-mode screenshots under every name.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { CATALOG_MODES, CATALOG_THEMES } from "../.storybook/catalog-matrix.ts";

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticBuildDirectory = path.join(harnessDirectory, "..", "storybook-static");
const baselinesDirectory = path.join(harnessDirectory, "baselines");

interface StorybookIndexEntry {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly name: string;
}

interface StorybookIndex {
  readonly v: number;
  readonly entries: Record<string, StorybookIndexEntry>;
}

const indexPath = path.join(staticBuildDirectory, "index.json");
if (!existsSync(indexPath)) {
  throw new Error(
    "storybook-static/index.json not found — build the static catalog first:\n" +
      "  pnpm --filter @magna-carta/design-system run storybook-build",
  );
}

const storybookIndex = JSON.parse(readFileSync(indexPath, "utf8")) as StorybookIndex;
const stories = Object.values(storybookIndex.entries).filter((entry) => entry.type === "story");

// Vacuity guard: an empty matrix must fail, never green-pass. Zero stories means the static
// build is broken (or the index format changed) — either way, "0 screenshots compared" is a
// finding, not a pass.
if (stories.length === 0) {
  throw new Error(
    `visual regression found ZERO stories in ${indexPath} (index version ${storybookIndex.v}) — ` +
      "broken static build or a changed index format; refusing to vacuously pass.",
  );
}

// Committed baselines present? When none exist the comparison is meaningless, so the suite
// SKIPS explicitly (named reason, visible in the report) instead of failing on every story or
// silently minting local baselines. Update runs (--update-snapshots) still proceed — that is
// how the first baselines get created, inside the pinned container (./README.md).
const baselinesExist =
  existsSync(baselinesDirectory) &&
  readdirSync(baselinesDirectory).some((fileName) => fileName.endsWith(".png"));

for (const story of stories) {
  for (const theme of CATALOG_THEMES) {
    for (const mode of CATALOG_MODES) {
      test(`${story.id} — ${theme} — ${mode}`, async ({ page }) => {
        const updateSnapshotsMode = test.info().config.updateSnapshots;
        const isBaselineUpdateRun =
          updateSnapshotsMode === "all" || updateSnapshotsMode === "changed";
        test.skip(
          !baselinesExist && !isBaselineUpdateRun,
          "no committed baselines in visual-regression/baselines yet — authoritative baselines " +
            "come from the pinned Playwright container (run update-baselines.cmd/.sh, or CI " +
            "generates them); see visual-regression/README.md",
        );

        await page.goto(
          `/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme};mode:${mode}`,
          { waitUntil: "networkidle" },
        );

        // The story must actually render — Storybook swaps in an error display (body class
        // sb-show-errordisplay) when a story throws, and a screenshot of that page would
        // otherwise become a "valid" baseline.
        await page.locator("#storybook-root > *").first().waitFor({ state: "attached" });
        await expect(page.locator("body")).not.toHaveClass(/sb-show-errordisplay/);

        // Pin the globals-URL syntax empirically: the preview decorator applies the theme via
        // data-theme + the dark class (applyThemeToDocument). If a Storybook upgrade changes
        // globals parsing, this fails loudly here, not as N identical screenshots.
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const darkClassApplied = await page.evaluate(() =>
          document.documentElement.classList.contains("dark"),
        );
        expect(darkClassApplied, `dark class must track mode "${mode}"`).toBe(mode === "dark");

        // Pin the config's contextOptions.reducedMotion shape empirically: every capture must
        // happen under prefers-reduced-motion (the motion-reduce token gate), so a Playwright
        // upgrade that moves the option cannot silently re-enable motion.
        const prefersReducedMotion = await page.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        );
        expect(prefersReducedMotion, "context must force prefers-reduced-motion").toBe(true);

        // Fonts must be loaded before capture — a screenshot mid font-swap is pure flake.
        await page.evaluate(() => document.fonts.ready);

        await expect(page).toHaveScreenshot(`${story.id}-${theme}-${mode}.png`, {
          maxDiffPixelRatio: 0.001,
          fullPage: true,
        });
      });
    }
  }
}

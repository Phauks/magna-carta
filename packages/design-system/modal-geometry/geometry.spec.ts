/*
 * The modal geometry sweep: every modal specimen in the catalog, loaded at every screen size in
 * matrix.ts, measured against the one rule the stage promises — a windowed panel keeps the gutter
 * on every side, and an expanded one touches every edge. Each row prints its size and edges, and
 * leaves a screenshot in test-results/, so the sweep is as much a way of LOOKING at the panels on a
 * screen you do not own as it is a gate. README.md says how to run and read it.
 *
 * The specimens open on render (src/stories/modal-geometry.stories.svelte), so a measurement is a
 * page load and a wait for the panel: nothing here presses anything.
 */
import { expect, test } from "@playwright/test";
import { edgesOf, expandedViolations, formatEdges, windowedViolations } from "./geometry.ts";
import { SPECIMENS, VIEWPORTS } from "./matrix.ts";

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name}, ${viewport.stands_for}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const specimen of SPECIMENS) {
      test(specimen.name, async ({ page }, testInfo) => {
        await page.goto(`/iframe.html?id=${specimen.storyId}&viewMode=story`);
        const panel = page.locator('[role="dialog"], [role="alertdialog"]').first();
        // Generous, because the first load of a story may wait on the dev server compiling it.
        await expect(panel).toBeVisible({ timeout: 30_000 });
        // Let the entrance settle: a box measured mid scale-fade is a few pixels in.
        await page.waitForTimeout(400);

        const box = await panel.boundingBox();
        expect(box, "the panel has a box").not.toBeNull();
        const edges = edgesOf(box!, viewport);
        const gutter = await panel.evaluate((element) => {
          const stage = element.closest<HTMLElement>("[data-modal-stage]");
          return stage === null
            ? Number.NaN
            : Number.parseFloat(getComputedStyle(stage).insetBlockStart);
        });

        const line =
          `${viewport.name} ${specimen.name}: ${Math.round(box!.width)} x ${Math.round(box!.height)}` +
          ` edges ${formatEdges(edges)}`;
        console.log(line);
        testInfo.annotations.push({ type: "geometry", description: line });
        await page.screenshot({
          path: testInfo.outputPath(`${viewport.name}--${specimen.name}.png`),
        });

        const violations = specimen.expanded
          ? expandedViolations(edges)
          : windowedViolations(edges, gutter);
        expect(violations, line).toEqual([]);
      });
    }
  });
}

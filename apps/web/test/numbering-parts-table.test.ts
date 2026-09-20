import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * THE PARTS TABLE FITS THE SETTINGS COLUMN.
 *
 * On 2026-09-18 the scheme editor shipped with five of its cells fixed at a container-scale width
 * (`w-3xs`, 16rem each). The table came out around twice the width of the settings column, so the
 * product's table drew its own horizontal scrollbar inside the page's vertical one — two bars for
 * one list — and the row's own controls sat off the right edge, which read on the screen as there
 * being no way to remove a part at all.
 *
 * `pnpm run lint:settings-scroll` holds the general ruling (one scroll region under Settings) and
 * carries this table as a stated allowance, because the editor reaches the data-table barrel at
 * all. What that allowance STANDS ON is this test: the cells size to their content, so the
 * sanctioned horizontal scroller never has anything to scroll.
 */
const EDITOR = "src/lib/matters/numbering-scheme-editor.svelte";

// Tailwind's container scale, which is where a cell width starts being wider than a column of a
// five-column table can afford. The product's own spacing scale is in pixels, so `w-96` is 96px
// and belongs in a cell; `w-3xs` is 16rem and does not.
const CONTAINER_SCALE_WIDTH = /\bw-(?:\d*xs|sm|md|lg|xl|\d+xl)\b/g;

describe("the numbering parts table", () => {
  const source = readFileSync(new URL(`../${EDITOR}`, import.meta.url), "utf8");

  it("gives no cell a container-scale width, so the table fits its plate", () => {
    expect(source.match(CONTAINER_SCALE_WIDTH) ?? []).toEqual([]);
  });

  it("keeps the row's own controls in the row, so none of them can be pushed out of view", () => {
    // Move up, move down and remove are one cell at the end of the row (owner ruling, 2026-09-19).
    for (const label of [
      "Move part {index + 1} up",
      "Move part {index + 1} down",
      "Remove part {index + 1}",
    ]) {
      expect(source).toContain(label);
    }
  });
});

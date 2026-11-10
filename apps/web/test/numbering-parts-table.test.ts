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
 * Taking those widths off was not enough, and only a rendered page showed it: each of the two
 * pickers still asked for a text input's default width (about twenty characters), and a table that
 * sizes its columns from their content took that as the columns' floor. Rendered at 1440px the
 * table was still 1038px in an 848px column, so the bar stayed and so did the hidden controls, at
 * every window narrower than about 1650px. What makes it fit is three things together: a picker in
 * a cell claims no width of its own (`fillsCell`), Part is the one column that takes the space
 * left over, and the one long heading may wrap. Checked rendered at 1280px (688px of column) and
 * 1440px; these assertions hold the three in place.
 *
 * `pnpm run lint:settings-scroll` holds the general ruling (one scroll region under Settings) and
 * carries this table as a stated allowance, because the editor reaches the data-table barrel at
 * all. What that allowance STANDS ON is this test.
 */
const EDITOR = "src/lib/matters/numbering-scheme-editor.svelte";

// Tailwind's container scale, which is where a cell width starts being wider than a column of a
// six-column table can afford. The product's own spacing scale is in pixels, so `w-64` is 64px
// and belongs in a cell; `w-3xs` is 16rem and does not. Only a WIDTH is refused: a `max-w-3xs`
// is a cap on a field inside a column that can shrink, which is the opposite of a floor.
const CONTAINER_SCALE_WIDTH = /(?<![\w-])w-(?:\d*xs|sm|md|lg|xl|\d+xl)\b/g;

describe("the numbering parts table", () => {
  const source = readFileSync(new URL(`../${EDITOR}`, import.meta.url), "utf8");

  it("gives no cell a container-scale width, so the table fits its plate", () => {
    expect(source.match(CONTAINER_SCALE_WIDTH) ?? []).toEqual([]);
  });

  it("lets no picker in the table claim a width of its own", () => {
    // Every ChoicePicker inside the table body fills its cell, the separator picker included.
    const table = source.slice(source.indexOf("<DataTable.Body>"), source.indexOf("Add Part"));
    const pickers = table.match(/<ChoicePicker[\s\S]*?\/>/g) ?? [];
    expect(pickers.length).toBeGreaterThan(0);
    for (const picker of pickers) expect(picker).toContain("fillsCell");
  });

  it("gives the spare width to Part and lets the long heading wrap", () => {
    expect(source).toContain('<DataTable.Head class="w-full">Part</DataTable.Head>');
    expect(source).toContain(
      '<DataTable.Head class="whitespace-normal">Separate Count</DataTable.Head>',
    );
  });

  it("keeps the row's own controls in the row, so none of them can be pushed out of view", () => {
    // The grip leads the row and removing ends it (owner ruling, 2026-11-09, which replaced the
    // up and down arrows with dragging); the grip keeps a keyboard path of its own.
    expect(source).toContain("Drag, or press Alt with Arrow Up or Arrow Down, to move it");
    expect(source).toContain("Remove part {index + 1}");
    expect(source).not.toContain("Move part {index + 1} up");
  });
});

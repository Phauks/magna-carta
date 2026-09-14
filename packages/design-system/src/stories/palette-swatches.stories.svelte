<script module lang="ts">
  /*
   * PaletteSwatches — the row of colour squares a member picks from when they colour something they
   * own: a folder in the file manager, a calendar on the firm's grid.
   *
   * The stories are the three things a reader can meet: the whole palette with nothing chosen, the
   * palette with a choice marked, and the SUBSET a calendar offers — which is the one thing a
   * caller varies, and the reason the component takes a list rather than drawing all eleven.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, fn, userEvent } from "storybook/test";
  import PaletteSwatches from "../lib/palette/palette-swatches.svelte";
  import { PALETTE_COLORS } from "../lib/palette/index.ts";
  import { CALENDAR_COLORS } from "../lib/components/calendar-grid/colors.ts";

  const { Story } = defineMeta({
    title: "Inputs/PaletteSwatches",
    component: PaletteSwatches,
    parameters: {
      controls: { include: ["colors", "value", "label", "disabled"] },
    },
  });

  const choose = fn();
</script>

{#snippet wholePalette()}
  <PaletteSwatches label="Folder colour" onchoose={choose} />
{/snippet}

<Story
  name="Default"
  template={wholePalette}
  play={async ({ canvas, step }) => {
    const group = canvas.getByRole("group", { name: "Folder colour" });

    await step("Every colour the product offers, named, in the palette's own order", async () => {
      const swatches = canvas.getAllByRole("button");
      await expect(swatches).toHaveLength(PALETTE_COLORS.length);
      await expect(swatches.map((swatch) => swatch.getAttribute("aria-label"))).toEqual(
        PALETTE_COLORS.map((color) => color.label),
      );
      await expect(group).toBeVisible();
    });

    await step("Nothing is chosen until something is, and choosing reports the name", async () => {
      for (const swatch of canvas.getAllByRole("button")) {
        await expect(swatch).toHaveAttribute("aria-pressed", "false");
      }
      await userEvent.click(canvas.getByRole("button", { name: "Purple" }));
      await expect(choose).toHaveBeenLastCalledWith("purple");
    });
  }}
/>

{#snippet chosen()}
  <PaletteSwatches label="Folder colour" value="green" onchoose={choose} />
{/snippet}

<Story
  name="Chosen"
  template={chosen}
  play={async ({ canvas, step }) => {
    await step("The chosen swatch says so, and it is the only one that does", async () => {
      await expect(canvas.getByRole("button", { name: "Green" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(canvas.getByRole("button", { name: "Red" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  }}
/>

{#snippet calendarSubset()}
  <PaletteSwatches colors={CALENDAR_COLORS} label="Calendar colour" value="blue" onchoose={choose} />
{/snippet}

<Story
  name="CalendarSubset"
  template={calendarSubset}
  play={async ({ canvas, step }) => {
    await step("A caller offering fewer keeps the palette's own order", async () => {
      const swatches = canvas.getAllByRole("button");
      await expect(swatches.map((swatch) => swatch.getAttribute("aria-label"))).toEqual(
        CALENDAR_COLORS.map((color) => color.label),
      );
    });

    await step("Black and white are left out: neither reads on a chip's leading rule", async () => {
      await expect(canvas.queryByRole("button", { name: "White" })).toBeNull();
      await expect(canvas.queryByRole("button", { name: "Black" })).toBeNull();
    });
  }}
/>

{#snippet refused()}
  <PaletteSwatches label="Calendar colour" value="blue" disabled onchoose={choose} />
{/snippet}

<Story
  name="Disabled"
  template={refused}
  play={async ({ canvas, step }) => {
    await step("A refused row is muted at rest, not only under the pointer", async () => {
      for (const swatch of canvas.getAllByRole("button")) {
        await expect(swatch).toBeDisabled();
      }
    });
  }}
/>

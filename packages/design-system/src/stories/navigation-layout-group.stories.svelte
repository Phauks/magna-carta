<script module lang="ts">
  /*
   * NavigationLayout.Group — Layout (Tier 2, native). A heading in the navigation column that folds
   * what it holds. The variant axis is the LEVEL — a band (the column's top level, a glyph on the
   * column's rule) or a group (a cluster inside one) — because that is what decides the voice, the
   * seat and the indent of everything beneath it. `expanded` and `label` are deliberately NOT
   * Controls: the fold is the consumer's
   * state, held in each story the way the app holds a member's preference, and the name is what each
   * story is a picture OF — a knob over either would be one that moves nothing, because the template
   * sets it. Press the heading instead, which is the whole point of the part.
   *
   * Every story stands the part inside a box the width of the navigation column, because the two
   * judgments it exists to hold — the three-level stagger, and a heading that reads as a heading
   * rather than a button — only show at that measure. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps, Snippet } from "svelte";
  import { expect, userEvent, within } from "storybook/test";
  import { Group, Row } from "../lib/components/navigation-layout/index.ts";
  import Badge from "../lib/components/badge/badge.svelte";
  import Building2 from "@lucide/svelte/icons/building-2";
  import UserRound from "@lucide/svelte/icons/user-round";

  const { Story } = defineMeta({
    title: "Layout/NavigationLayoutGroup",
    component: Group,
    args: { level: "group" },
    argTypes: {
      level: { control: "select", options: ["band", "group"] },
    },
    parameters: { controls: { include: ["level"] } },
  });

  type GroupStoryArgs = Omit<
    ComponentProps<typeof Group>,
    "children" | "icon" | "onToggle" | "expanded"
  >;
</script>

<script lang="ts">
  // The fold is the CONSUMER's — the part holds nothing — so the stories hold it here, exactly as
  // the app holds a member's folds as a preference.
  let groupOpen = $state(true);
  let bandOpen = $state(true);
  let practiceOpen = $state(true);
</script>

{#snippet column(inner: Snippet)}
  <!-- The navigation column's measure: the popover width plus the standard gutter a side, which is
       what NavigationLayout gives the column. Headings are judged at this width or not at all. -->
  <div class="mc-navigation-layout-navigation mc-scrollbar bg-surface-default">
    {@render inner()}
  </div>
{/snippet}

<!-- A group: a cluster of rows inside a band, quieter and one step in. -->
<Story
  name="Group"
  play={async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("button", { name: "Appearance" });

    await step("The heading IS the control, and it says which way it will go", async () => {
      await expect(heading).toHaveAttribute("aria-expanded", "true");
      expect(canvas.getByRole("link", { name: "Theme" })).toBeVisible();
    });

    await step("Pressing it folds the rows away", async () => {
      await userEvent.click(heading);
      await expect(heading).toHaveAttribute("aria-expanded", "false");
      expect(canvas.queryByRole("link", { name: "Theme" })).toBeNull();
    });

    await step("Pressing it again brings them back", async () => {
      await userEvent.click(heading);
      await expect(heading).toHaveAttribute("aria-expanded", "true");
      expect(canvas.getByRole("link", { name: "Theme" })).toBeVisible();
    });
  }}
>
  {#snippet template(args: GroupStoryArgs)}
    {#snippet inner()}
      <Group
        {...args}
        label="Appearance"
        expanded={groupOpen}
        onToggle={() => (groupOpen = !groupOpen)}
      >
        <ul class="flex flex-col gap-4">
          <li><Row href="#theme" current>Theme</Row></li>
          <li><Row href="#accessibility">Accessibility</Row></li>
          <li><Row href="#text">Text</Row></li>
        </ul>
      </Group>
    {/snippet}
    {@render column(inner)}
  {/snippet}
</Story>

<!--
  A band holding groups: the whole three-level stagger in one picture — the band's glyph and rule,
  the group headings indented one step from its cap-line, and the rows a step further. Folding the
  band takes its groups with it, which is the reason a column of ten groups can be read at all.
-->
<Story
  name="Band"
  args={{ level: "band" }}
  play={async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const band = canvas.getByRole("button", { name: "Firm Settings" });
    const group = canvas.getByRole("button", { name: "Practice" });

    await step("The stagger is three levels, each one step in from the last", async () => {
      // The headings are full-width hit targets, so what staggers is where each level's content
      // STARTS — the band's glyph, then the group's name, then the row's. Measuring the buttons
      // would compare three elements that all begin at the column's edge, which is what a hit
      // target is for.
      const startOf = (element: Element | null): number => {
        if (element === null) throw new Error("the stagger has nothing to measure");
        return element.getBoundingClientRect().left;
      };
      const bandStart = startOf(band.querySelector(".mc-navigation-layout-group-heading-icon"));
      const groupStart = startOf(group.querySelector(".mc-navigation-layout-group-heading-label"));
      const rowStart = startOf(
        canvas.getByRole("link", { name: "Matter Numbering" }).querySelector("span"),
      );
      expect(groupStart).toBeGreaterThan(bandStart);
      expect(rowStart).toBeGreaterThan(groupStart);
    });

    await step("Folding the band takes its groups with it", async () => {
      await userEvent.click(band);
      await expect(band).toHaveAttribute("aria-expanded", "false");
      expect(canvas.queryByRole("button", { name: "Practice" })).toBeNull();
      expect(canvas.queryByRole("link", { name: "Matter Numbering" })).toBeNull();
      await userEvent.click(band);
      expect(canvas.getByRole("button", { name: "Practice" })).toBeVisible();
    });

    await step("A group folds on its own, inside a band that stays open", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Practice" }));
      expect(canvas.queryByRole("link", { name: "Matter Numbering" })).toBeNull();
      expect(canvas.getByRole("button", { name: "Firm Settings" })).toBeVisible();
    });
  }}
>
  {#snippet template(args: GroupStoryArgs)}
    {#snippet inner()}
      <Group
        {...args}
        label="Firm Settings"
        expanded={bandOpen}
        onToggle={() => (bandOpen = !bandOpen)}
      >
        {#snippet icon()}<Building2 />{/snippet}
        <Group
          label="Practice"
          expanded={practiceOpen}
          onToggle={() => (practiceOpen = !practiceOpen)}
        >
          <ul class="flex flex-col gap-4">
            <li><Row href="#matter-numbering">Matter Numbering</Row></li>
            <li>
              <Row href="#conflicts">
                Conflicts
                {#snippet trailing()}<Badge variant="outline" caps>View</Badge>{/snippet}
              </Row>
            </li>
          </ul>
        </Group>
      </Group>
    {/snippet}
    {@render column(inner)}
  {/snippet}
</Story>

<!--
  The folded band, at rest. Hidden from the catalog (it would stack a third copy of the part on the
  Docs page); run by the test addon, because "folded" is a state the eye has to be able to read from
  the chevron alone — the heading is all that is left.
-->
<Story
  name="Folded"
  tags={["!dev", "!autodocs"]}
  args={{ level: "band" }}
  play={async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const band = canvas.getByRole("button", { name: "My Settings" });

    await step("A folded band is its heading and nothing else", async () => {
      await expect(band).toHaveAttribute("aria-expanded", "false");
      expect(band).toHaveAttribute("data-expanded", "false");
      expect(canvas.queryByRole("link")).toBeNull();
    });
  }}
>
  {#snippet template(args: GroupStoryArgs)}
    {#snippet inner()}
      <Group {...args} label="My Settings" expanded={false} onToggle={() => {}}>
        {#snippet icon()}<UserRound />{/snippet}
        <ul class="flex flex-col gap-4">
          <li><Row href="#theme">Theme</Row></li>
        </ul>
      </Group>
    {/snippet}
    {@render column(inner)}
  {/snippet}
</Story>

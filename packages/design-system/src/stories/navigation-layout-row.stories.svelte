<script module lang="ts">
  /*
   * NavigationLayout.Row — Layout (Tier 2, native). One choice inside the navigation column of a
   * two-sided screen. The variant axis is WHAT THE ROW IS — a destination, an act, or an entry
   * designed with nowhere to go yet — because that is what decides the element it renders and how
   * quiet it reads; `current` is the state axis and rides both interactive stories as a Control.
   *
   * Every story stands the rows inside a box the width of the navigation column, because the two
   * judgments this part exists to hold — a name WRAPS rather than truncating, and a trailing mark
   * never shrinks — only show at that measure. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps, Snippet } from "svelte";
  import { expect, within } from "storybook/test";
  import { Row } from "../lib/components/navigation-layout/index.ts";
  import Badge from "../lib/components/badge/badge.svelte";
  import MaturityBadge from "../lib/components/maturity/maturity-badge.svelte";
  import FieldLabel from "../lib/components/field-label/field-label.svelte";
  import FileText from "@lucide/svelte/icons/file-text";
  import Gavel from "@lucide/svelte/icons/gavel";
  import Landmark from "@lucide/svelte/icons/landmark";
  import Scale from "@lucide/svelte/icons/scale";

  const { Story } = defineMeta({
    title: "Layout/NavigationLayoutRow",
    component: Row,
    args: { current: false },
    parameters: { controls: { include: ["current", "href"] } },
  });

  type RowStoryArgs = Omit<ComponentProps<typeof Row>, "children" | "icon" | "trailing">;

  /** The row's own inset box-shadow, read back from the rendered row. */
  function startEdgeBar(row: HTMLElement): string {
    return getComputedStyle(row).boxShadow;
  }
</script>

{#snippet column(inner: Snippet)}
  <!-- The navigation column's measure: the popover width plus the standard gutter a side, which is
       what NavigationLayout gives the column. Rows are judged at this width or not at all. -->
  <div class="mc-navigation-layout-navigation mc-scrollbar bg-surface-default">
    <ul class="flex flex-col gap-4">
      {@render inner()}
    </ul>
  </div>
{/snippet}

<!-- A destination: the settings nav's row, and the shape most columns are made of. -->
<Story
  name="Destination"
  args={{ href: "#profile" }}
  play={async ({ canvasElement, step }) => {
    const row = within(canvasElement).getByRole("link", { name: "Matter numbering" });

    await step("A row with somewhere to go is an anchor", async () => {
      expect(row.tagName).toBe("A");
      expect(row.getAttribute("href")).toBe("#profile");
    });

    await step("A row at rest claims neither the page nor the accent", async () => {
      expect(row).not.toHaveAttribute("aria-current");
      expect(row).not.toHaveAttribute("data-current");
      expect(startEdgeBar(row)).toBe("none");
    });
  }}
>
  {#snippet template(args: RowStoryArgs)}
    {#snippet inner()}
      <li><Row {...args}>Matter numbering</Row></li>
      <li>
        <Row href="#offices">
          Offices
          {#snippet trailing()}<Badge variant="outline" caps>View</Badge>{/snippet}
        </Row>
      </li>
    {/snippet}
    {@render column(inner)}
  {/snippet}
</Story>

<!-- The chosen row: the selected fill, the firmer ink, and the gilt bar down its start edge. -->
<Story
  name="Current"
  args={{ href: "#profile", current: true }}
  play={async ({ canvasElement, step }) => {
    const row = within(canvasElement).getByRole("link", { name: "Matter numbering" });

    await step("The lit row says so to a screen reader and to the eye", async () => {
      await expect(row).toHaveAttribute("aria-current", "page");
      expect(row).toHaveAttribute("data-current", "true");
      expect(startEdgeBar(row)).toContain("inset");
    });

    await step("Exactly one row is lit", async () => {
      expect(canvasElement.querySelectorAll('[data-current="true"]')).toHaveLength(1);
    });
  }}
>
  {#snippet template(args: RowStoryArgs)}
    {#snippet inner()}
      <li><Row {...args}>Matter numbering</Row></li>
      <li><Row href="#offices">Offices</Row></li>
    {/snippet}
    {@render column(inner)}
  {/snippet}
</Story>

<!-- An act rather than a destination: the shape a conversation rail takes, where choosing a row
     changes what stands beside it without changing the address. -->
<Story
  name="Act"
  play={async ({ canvasElement, step }) => {
    const row = within(canvasElement).getByRole("button", { name: "Fee agreement, second draft" });

    await step("A row with no href is a button, and the part decides nothing else", async () => {
      expect(row.tagName).toBe("BUTTON");
      expect(row).toHaveAttribute("type", "button");
    });
  }}
>
  {#snippet template(args: RowStoryArgs)}
    {#snippet inner()}
      <li>
        <Row {...args} href={undefined}>
          {#snippet icon()}<FileText />{/snippet}
          Fee agreement, second draft
        </Row>
      </li>
      <li>
        <Row href={undefined} current>
          {#snippet icon()}<Scale />{/snippet}
          Limitation period for the Harker claim
        </Row>
      </li>
    {/snippet}
    {@render column(inner)}
  {/snippet}
</Story>

<!--
  The whole column, as a catalogue draws one: a group header, rows that lead somewhere, and an
  entry designed with nowhere to go yet standing in its place wearing its Soon mark. The long name
  is the point — it WRAPS to a second line and the row grows, because "Property Listin... Soon" has
  stopped naming the tool.
-->
<Story
  name="Column"
  play={async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    const unreachable = canvasElement.querySelector<HTMLElement>('[aria-disabled="true"]');
    if (!unreachable) throw new Error("the unreachable row did not render");

    await step("An entry with nowhere to go is a row, not a link and not a disabled control", async () => {
      expect(unreachable.tagName).toBe("SPAN");
      expect(unreachable.textContent).toContain("Property Listing and Title Abstract");
      expect(canvas.queryByRole("link", { name: /Property Listing/ })).toBeNull();
      expect(canvas.queryByRole("button", { name: /Property Listing/ })).toBeNull();
    });

    await step("The long name wraps, so the row is taller than a one-line row", async () => {
      const short = canvas.getByRole("link", { name: "WHOIS Lookup" });
      expect(unreachable.getBoundingClientRect().height).toBeGreaterThan(
        short.getBoundingClientRect().height,
      );
      expect(getComputedStyle(unreachable).whiteSpace).not.toBe("nowrap");
    });
  }}
>
  {#snippet template(args: RowStoryArgs)}
    {#snippet inner()}
      <li><FieldLabel as="p" class="px-12">Research</FieldLabel></li>
      <li>
        <Row {...args} href="#whois" current>
          {#snippet icon()}<Landmark />{/snippet}
          WHOIS Lookup
        </Row>
      </li>
      <li>
        <Row href="#docket">
          {#snippet icon()}<Gavel />{/snippet}
          Court Docket Search
        </Row>
      </li>
      <li>
        <Row href={null} title="Not built yet: county records.">
          {#snippet icon()}<FileText />{/snippet}
          Property Listing and Title Abstract
          {#snippet trailing()}<MaturityBadge stage="soon" />{/snippet}
        </Row>
      </li>
    {/snippet}
    {@render column(inner)}
  {/snippet}
</Story>

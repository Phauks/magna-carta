<script module lang="ts">
  /*
   * Breadcrumb — Layout. A data-driven path with graceful middle-collapse. One controllable Primary
   * (a shallow path, no collapse) plus a "Collapsed deep path" story that exercises the overflow
   * affordance. The collapse logic and the accessibility contract (nav landmark, aria-current leaf,
   * expand-in-place) ride the play functions. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Breadcrumb from "../lib/components/breadcrumb/index.ts";
  import type { BreadcrumbEntry } from "../lib/components/breadcrumb/index.ts";

  const SHALLOW: BreadcrumbEntry[] = [
    { label: "Matters", href: "#matters" },
    { label: "ACME-2026-014", href: "#acme" },
    { label: "Depositions" },
  ];

  const DEEP: BreadcrumbEntry[] = [
    { label: "Matters", href: "#matters" },
    { label: "ACME-2026-014", href: "#acme" },
    { label: "Discovery", href: "#discovery" },
    { label: "Depositions", href: "#depositions" },
    { label: "Transcripts", href: "#transcripts" },
    { label: "Volume III" },
  ];

  const { Story } = defineMeta({
    title: "Layout/Breadcrumb",
    component: Breadcrumb,
    args: { items: SHALLOW, maxItems: 4, itemsBeforeCollapse: 1, itemsAfterCollapse: 1 },
    argTypes: {
      maxItems: { control: "number" },
      itemsBeforeCollapse: { control: "number" },
      itemsAfterCollapse: { control: "number" },
    },
  });

  type BreadcrumbStoryArgs = ComponentProps<typeof Breadcrumb>;
</script>

{#snippet template(args: BreadcrumbStoryArgs)}
  <Breadcrumb {...args} />
{/snippet}

<Story
  name="Default"
  args={{ items: SHALLOW }}
  {template}
  play={async ({ canvas, step }) => {
    await step("Exposes a navigation landmark named Breadcrumb", async () => {
      await expect(canvas.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    });
    await step("The current folder is the aria-current leaf", async () => {
      await expect(canvas.getByText("Depositions")).toHaveAttribute("aria-current", "page");
    });
    await step("Ancestors are links", async () => {
      await expect(canvas.getByRole("link", { name: "Matters" })).toBeInTheDocument();
      await expect(canvas.getByRole("link", { name: "ACME-2026-014" })).toBeInTheDocument();
    });
  }}
/>

<!-- A path deeper than maxItems collapses its MIDDLE behind the ellipsis — the root and the current
     folder stay visible, and the ellipsis reveals the rest in place. -->
<Story
  name="Collapsed deep path"
  args={{ items: DEEP, maxItems: 4 }}
  {template}
  play={async ({ canvas, step }) => {
    await step("Collapses the middle behind an ellipsis affordance", async () => {
      await expect(canvas.queryByText("Discovery")).toBeNull();
      await expect(canvas.queryByText("Depositions")).toBeNull();
      await expect(
        canvas.getByRole("button", { name: "Show the collapsed folders" }),
      ).toBeInTheDocument();
    });
    await step("Keeps the root and the current folder readable", async () => {
      await expect(canvas.getByRole("link", { name: "Matters" })).toBeInTheDocument();
      await expect(canvas.getByText("Volume III")).toHaveAttribute("aria-current", "page");
    });
    await step("The ellipsis reveals the full path in place", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Show the collapsed folders" }));
      await expect(canvas.getByText("Discovery")).toBeInTheDocument();
      await expect(canvas.getByText("Depositions")).toBeInTheDocument();
      await expect(canvas.queryByRole("button", { name: "Show the collapsed folders" })).toBeNull();
    });
  }}
/>

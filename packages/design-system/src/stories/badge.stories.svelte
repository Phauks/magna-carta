<script module lang="ts">
  /*
   * Badge — Tier 1 batch. One story per variant (each a genuinely different display). The
   * non-interactive-span check rides the Default story's play function (run automatically), so
   * there is no separate behavior-only story re-rendering the same badge. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import Badge from "../lib/components/badge/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/Badge",
    component: Badge,
    args: { variant: "primary" },
    argTypes: {
      variant: {
        control: "select",
        options: [
          "primary",
          "secondary",
          "destructive",
          "outline",
          "neutral",
          "success",
          "warning",
          "danger",
          "info",
          "accent",
        ],
      },
    },
  });

  type BadgeStoryArgs = ComponentProps<typeof Badge>;
</script>

{#snippet template(args: BadgeStoryArgs)}
  <Badge {...args}>Active</Badge>
{/snippet}

<Story
  name="Primary"
  args={{ variant: "primary" }}
  {template}
  play={async ({ canvas, step }) => {
    await step("Renders as a non-interactive <span>", async () => {
      const badge = canvas.getByText("Active");
      await expect(badge.tagName).toBe("SPAN");
    });
  }}
/>
<Story name="Secondary" args={{ variant: "secondary" }} {template} />
<Story name="Destructive" args={{ variant: "destructive" }} {template} />
<Story name="Outline" args={{ variant: "outline" }} {template} />

<!-- The pale-tint status register, shown as a set — the calm chips a work surface uses (a matter's
     Open/Pending/Closed, the gold "Trust held"). Compared together so the same-hue tints read as a family. -->
<Story name="Status pills">
  {#snippet template()}
    <div class="flex flex-wrap items-center gap-8">
      <Badge variant="success">Open</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="danger">Overdue</Badge>
      <Badge variant="info">Filed</Badge>
      <Badge variant="neutral">Closed</Badge>
      <Badge variant="accent">Trust held</Badge>
    </div>
  {/snippet}
</Story>

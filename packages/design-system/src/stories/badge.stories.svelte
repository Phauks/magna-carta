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
        options: ["primary", "secondary", "destructive", "outline"],
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

<script module lang="ts">
  /*
   * Badge — Tier 1 batch (the Button exemplar pattern: native element + mc-* recipe keyed by a
   * typed variant record). Stories cover every variant and double as per-story axe checks
   * (.storybook/preview.ts sets a11y.test = "error"). The play function asserts the rendered
   * element is a non-interactive <span> carrying its label. svelte-csf v5 API (defineMeta + Story).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import Badge from "../lib/components/badge/index.ts";

  const { Story } = defineMeta({
    title: "Components/Badge",
    component: Badge,
    args: { variant: "default" },
    argTypes: {
      variant: {
        control: "select",
        options: ["default", "secondary", "destructive", "outline"],
      },
    },
  });

  type BadgeStoryArgs = ComponentProps<typeof Badge>;
</script>

{#snippet template(args: BadgeStoryArgs)}
  <Badge {...args}>Active</Badge>
{/snippet}

<Story name="Default" args={{ variant: "default" }} {template} />
<Story name="Secondary" args={{ variant: "secondary" }} {template} />
<Story name="Destructive" args={{ variant: "destructive" }} {template} />
<Story name="Outline" args={{ variant: "outline" }} {template} />

<Story
  name="Renders a non-interactive span"
  play={async ({ canvas }) => {
    const badge = canvas.getByText("Active");
    await expect(badge.tagName).toBe("SPAN");
  }}
>
  {#snippet template(args: BadgeStoryArgs)}
    <Badge {...args}>Active</Badge>
  {/snippet}
</Story>

<script module lang="ts">
  /*
   * Kbd — Tier 1 batch (the Button exemplar pattern: native element + mc-* recipe). The play
   * function asserts the rendered element is a native <kbd> (so it is announced and styled as a
   * keyboard key). Per-story axe runs clean. svelte-csf v5 API (defineMeta + Story).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import Kbd from "../lib/components/kbd/index.ts";

  const { Story } = defineMeta({
    title: "Components/Kbd",
    component: Kbd,
  });

  type KbdStoryArgs = ComponentProps<typeof Kbd>;
</script>

{#snippet template(args: KbdStoryArgs)}
  <Kbd {...args}>Ctrl</Kbd>
{/snippet}

<Story name="Default" {template} />

<!-- A chord: several keys composed side by side. -->
<Story name="Shortcut">
  {#snippet template()}
    <span class="inline-flex items-center gap-1">
      <Kbd>Ctrl</Kbd>
      <Kbd>K</Kbd>
    </span>
  {/snippet}
</Story>

<Story
  name="Renders a native kbd element"
  play={async ({ canvas }) => {
    const key = canvas.getByText("Ctrl");
    await expect(key.tagName).toBe("KBD");
  }}
  {template}
/>

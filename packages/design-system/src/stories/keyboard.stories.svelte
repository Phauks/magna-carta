<script module lang="ts">
  /*
   * Keyboard — Tier 1 batch. Two genuinely different displays: a single key and a composed chord.
   * The native-<kbd> check rides the Default story's play function (it runs automatically — no
   * separate behavior-only story to duplicate the render). Per-story axe runs clean. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import Keyboard from "../lib/components/keyboard/index.ts";

  const { Story } = defineMeta({
    title: "Components/Keyboard",
    component: Keyboard,
  });

  type KeyboardStoryArgs = ComponentProps<typeof Keyboard>;
</script>

<Story
  name="Default"
  play={async ({ canvas }) => {
    const key = canvas.getByText("Ctrl");
    await expect(key.tagName).toBe("KBD");
  }}
>
  {#snippet template(args: KeyboardStoryArgs)}
    <Keyboard {...args}>Ctrl</Keyboard>
  {/snippet}
</Story>

<!-- A chord: several keys composed side by side. -->
<Story name="Shortcut">
  {#snippet template()}
    <span class="inline-flex items-center gap-1">
      <Keyboard>Ctrl</Keyboard>
      <Keyboard>K</Keyboard>
    </span>
  {/snippet}
</Story>

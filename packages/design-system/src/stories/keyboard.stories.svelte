<script module lang="ts">
  /*
   * Keyboard — Tier 1 batch. The component is ONE keycap, so the story shows one key (composing a
   * chord — keycaps side by side — is the consumer's job, not a second story). The native-<kbd>
   * check rides the play function. Per-story axe runs clean. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import Keyboard from "../lib/components/keyboard/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/Keyboard",
    component: Keyboard,
  });

  type KeyboardStoryArgs = ComponentProps<typeof Keyboard>;
</script>

<Story
  name="Default"
  play={async ({ canvas, step }) => {
    await step("Renders a native <kbd> keycap", async () => {
      await expect(canvas.getByText("Esc").tagName).toBe("KBD");
    });
  }}
>
  {#snippet template(args: KeyboardStoryArgs)}
    <Keyboard {...args}>Esc</Keyboard>
  {/snippet}
</Story>

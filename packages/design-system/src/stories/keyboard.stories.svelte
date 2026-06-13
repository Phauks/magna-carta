<script module lang="ts">
  /*
   * Keyboard — Tier 1 batch. A single story: a shortcut chord (which shows both the single-key
   * styling and how keys compose side by side — no need for a separate single-key story). The
   * native-<kbd> check rides the play function. Per-story axe runs clean. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Keyboard from "../lib/components/keyboard/index.ts";

  const { Story } = defineMeta({
    title: "Components/Keyboard",
    component: Keyboard,
  });
</script>

<Story
  name="Default"
  play={async ({ canvas }) => {
    await expect(canvas.getByText("Ctrl").tagName).toBe("KBD");
    await expect(canvas.getByText("K").tagName).toBe("KBD");
  }}
>
  <span class="inline-flex items-center gap-1">
    <Keyboard>Ctrl</Keyboard>
    <Keyboard>K</Keyboard>
  </span>
</Story>

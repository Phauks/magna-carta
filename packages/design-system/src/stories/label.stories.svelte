<script module lang="ts">
  /*
   * Label — Tier 1 batch. Use case: a Label captions a form control; its job is the native for/id
   * link, so the showcase pairs it with the control it names — here on a single inline row (a
   * Label is one line of text, it does not need its own column). Both checks ride the play
   * function: the element is a native <label>, and clicking it focuses the control. Per-story axe
   * runs clean. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent } from "storybook/test";
  import Label from "../lib/components/label/index.ts";

  const { Story } = defineMeta({
    title: "Components/Label",
    component: Label,
  });
</script>

<Story
  name="Default"
  play={async ({ canvas }) => {
    const label = canvas.getByText("Matter reference");
    await expect(label.tagName).toBe("LABEL");
    const field = canvas.getByRole("textbox");
    await expect(field).not.toHaveFocus();
    await userEvent.click(label);
    await expect(field).toHaveFocus();
  }}
>
  <div class="flex items-center gap-3">
    <Label for="matter-reference">Matter reference</Label>
    <input id="matter-reference" type="text" class="mc-input max-w-xs" />
  </div>
</Story>

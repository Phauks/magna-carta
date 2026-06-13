<script module lang="ts">
  /*
   * Label — Tier 1 batch. A single story showing the label in its real context (bound to a control
   * via for/id). Both checks ride the play function (run automatically): the element is a native
   * <label>, and clicking it focuses the control it names. Per-story axe runs clean. svelte-csf v5.
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
  <div class="flex flex-col gap-2">
    <Label for="matter-reference">Matter reference</Label>
    <input id="matter-reference" type="text" class="mc-input w-full max-w-xs" />
  </div>
</Story>

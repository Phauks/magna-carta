<script module lang="ts">
  /*
   * Label — Tier 1 batch. Use case: a Label captions a form control; its job is the native for/id
   * link, so the showcase pairs it with the control it names — here on a single inline row (a
   * Label is one line of text, it does not need its own column). Both checks ride the play
   * function: the element is a native <label>, and clicking it focuses the control. Per-story axe
   * runs clean. svelte-csf v5.
   *
   * The render MUST be an explicit `{template}` snippet, NOT bare `<Story>` children: with
   * `component` set, svelte-csf renders that component with args and slots bare children inside it
   * — which would wrap this row in a second, outer `<label>` (Label renders its children), nesting
   * a label around the input. The template snippet IS the render, so no wrapping happens.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent } from "storybook/test";
  import Label from "../lib/components/label/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/Label",
    component: Label,
  });
</script>

{#snippet template()}
  <div class="flex items-center gap-3">
    <Label for="matter-reference">Matter reference</Label>
    <input id="matter-reference" type="text" class="mc-input max-w-xs" />
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const label = canvas.getByText("Matter reference");
    const field = canvas.getByRole("textbox");
    await step("Is a native <label>", async () => {
      await expect(label.tagName).toBe("LABEL");
    });
    await step("Clicking it focuses the linked field", async () => {
      await expect(field).not.toHaveFocus();
      await userEvent.click(label);
      await expect(field).toHaveFocus();
    });
  }}
/>

<script module lang="ts">
  /*
   * Label — Tier 1 batch (the Button exemplar pattern: native element + mc-* recipe).
   *
   * A styled native <label>. The behavior worth asserting is the native for/id association:
   * clicking the label moves focus to the control it names (a plain <input> stands in here —
   * the design-system Input is its own component/story). Stories double as per-story axe checks
   * (.storybook/preview.ts sets a11y.test = "error"). Visual styling is the mc-label recipe in
   * src/lib/styles/components.css. svelte-csf v5 API (defineMeta + Story), as in button.stories.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Label from "../lib/components/label/index.ts";

  const { Story } = defineMeta({
    title: "Components/Label",
    component: Label,
  });

  type LabelStoryArgs = ComponentProps<typeof Label>;
</script>

{#snippet template(args: LabelStoryArgs)}
  <Label {...args}>Matter reference</Label>
{/snippet}

<!-- The label on its own. -->
<Story name="Default" {template} />

<!-- Label bound to a control via for/id: the rendered element is a real <label>. -->
<Story
  name="Renders a native label"
  play={async ({ canvas }) => {
    const label = canvas.getByText("Matter reference");
    await expect(label.tagName).toBe("LABEL");
  }}
>
  {#snippet template(args: LabelStoryArgs)}
    <Label {...args}>Matter reference</Label>
  {/snippet}
</Story>

<!-- for/id association: clicking the label focuses the control it names. -->
<Story
  name="Clicking the label focuses its control"
  play={async ({ canvas }) => {
    const label = canvas.getByText("Matter reference");
    const field = canvas.getByRole("textbox");
    await expect(field).not.toHaveFocus();
    await userEvent.click(label);
    await expect(field).toHaveFocus();
  }}
>
  {#snippet template()}
    <Label for="matter-reference">Matter reference</Label>
    <input id="matter-reference" type="text" />
  {/snippet}
</Story>

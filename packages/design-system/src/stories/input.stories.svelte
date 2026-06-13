<script module lang="ts">
  /*
   * Input — Tier 1 batch (the Button exemplar pattern: native element + mc-* recipe).
   *
   * Every input carries an aria-label (meta args) because a bare control with only a placeholder
   * has no accessible name and would fail the per-story axe check (.storybook/preview.ts sets
   * a11y.test = "error"); placeholder text is not a label. Play functions assert the rendered
   * element is a native <input>, that it accepts typed text, and that `disabled` blocks input.
   * svelte-csf v5 API (defineMeta + Story), as in button.stories.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Input from "../lib/components/input/index.ts";

  const { Story } = defineMeta({
    title: "Components/Input",
    component: Input,
    args: { placeholder: "ACME-2026-014", "aria-label": "Matter reference" },
  });

  type InputStoryArgs = ComponentProps<typeof Input>;
</script>

{#snippet template(args: InputStoryArgs)}
  <Input {...args} />
{/snippet}

<Story name="Default" {template} />
<Story name="Filled" args={{ value: "ACME-2026-014" }} {template} />
<Story name="Disabled" args={{ disabled: true, value: "ACME-2026-014" }} {template} />
<!-- File input: the type discriminates the files binding; keeps an accessible name from meta args. -->
<Story name="File" args={{ type: "file" }} {template} />

<!-- ----- behavior assertions (play functions) ------------------------------------------- -->

<Story
  name="Renders a native text input"
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Matter reference" });
    await expect(field.tagName).toBe("INPUT");
  }}
  {template}
/>

<Story
  name="Accepts typed text"
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Matter reference" });
    await userEvent.type(field, "ACME-2026-014");
    await expect(field).toHaveValue("ACME-2026-014");
  }}
  {template}
/>

<Story
  name="Disabled blocks typing"
  args={{ disabled: true }}
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Matter reference" });
    await expect(field).toBeDisabled();
    await userEvent.type(field, "nope", { pointerEventsCheck: 0 });
    await expect(field).toHaveValue("");
  }}
  {template}
/>

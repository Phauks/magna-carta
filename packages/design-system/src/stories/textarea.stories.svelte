<script module lang="ts">
  /*
   * Textarea — Tier 1 batch (the Button exemplar pattern: native element + mc-* recipe).
   *
   * Like Input, each textarea carries an aria-label (meta args) so it has an accessible name and
   * passes the per-story axe check (.storybook/preview.ts sets a11y.test = "error"). Play
   * functions assert it renders a native <textarea>, accepts typed text, and that `disabled`
   * blocks input. svelte-csf v5 API (defineMeta + Story), as in button.stories.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Textarea from "../lib/components/textarea/index.ts";

  const { Story } = defineMeta({
    title: "Components/Textarea",
    component: Textarea,
    args: { placeholder: "Attendance note…", "aria-label": "Attendance note" },
  });

  type TextareaStoryArgs = ComponentProps<typeof Textarea>;
</script>

{#snippet template(args: TextareaStoryArgs)}
  <Textarea {...args} />
{/snippet}

<Story name="Default" {template} />
<Story name="Filled" args={{ value: "Telephone attendance on the client." }} {template} />
<Story name="Disabled" args={{ disabled: true, value: "Telephone attendance on the client." }} {template} />

<!-- ----- behavior assertions (play functions) ------------------------------------------- -->

<Story
  name="Renders a native textarea"
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Attendance note" });
    await expect(field.tagName).toBe("TEXTAREA");
  }}
  {template}
/>

<Story
  name="Accepts typed text"
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Attendance note" });
    await userEvent.type(field, "Drafted the engagement letter.");
    await expect(field).toHaveValue("Drafted the engagement letter.");
  }}
  {template}
/>

<Story
  name="Disabled blocks typing"
  args={{ disabled: true }}
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Attendance note" });
    await expect(field).toBeDisabled();
    await userEvent.type(field, "nope", { pointerEventsCheck: 0 });
    await expect(field).toHaveValue("");
  }}
  {template}
/>

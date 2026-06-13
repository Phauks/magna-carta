<script module lang="ts">
  /*
   * Textarea — Tier 1 batch. One story per distinct state (empty, disabled). Each carries an
   * aria-label so it has an accessible name (axe). The native-element + typed-input checks ride
   * Default's play; the disabled check rides Disabled's. svelte-csf v5.
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

<Story
  name="Default"
  {template}
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Attendance note" });
    await expect(field.tagName).toBe("TEXTAREA");
    await userEvent.type(field, "Drafted the engagement letter.");
    await expect(field).toHaveValue("Drafted the engagement letter.");
  }}
/>

<Story
  name="Disabled"
  args={{ disabled: true, value: "Telephone attendance on the client." }}
  {template}
  play={async ({ canvas }) => {
    await expect(canvas.getByRole("textbox", { name: "Attendance note" })).toBeDisabled();
  }}
/>

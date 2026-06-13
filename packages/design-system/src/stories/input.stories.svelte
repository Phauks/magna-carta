<script module lang="ts">
  /*
   * Input — Tier 1 batch. One story per distinct STATE (empty, disabled, file) — no separate
   * behavior-only stories re-rendering the same field. Each input carries an aria-label (meta
   * args) because a placeholder is not an accessible name and a nameless control fails the
   * per-story axe check. The native-element + typed-input checks ride Default's play; the disabled
   * check rides Disabled's. svelte-csf v5.
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

<Story
  name="Default"
  {template}
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Matter reference" });
    await expect(field.tagName).toBe("INPUT");
    await userEvent.type(field, "ACME-2026-014");
    await expect(field).toHaveValue("ACME-2026-014");
  }}
/>

<Story
  name="Disabled"
  args={{ disabled: true, value: "ACME-2026-014" }}
  {template}
  play={async ({ canvas }) => {
    await expect(canvas.getByRole("textbox", { name: "Matter reference" })).toBeDisabled();
  }}
/>

<!-- File input: the type discriminates the files binding; the native selector button is styled. -->
<Story name="File" args={{ type: "file" }} {template} />

<script module lang="ts">
  /*
   * Input — Tier 1 (form control). Catalog model (matches Button): ONE showcase story; the states
   * (disabled, filled) are Controls, not stories. `placeholder` and `disabled` are forwarded native
   * attributes (the spread, no docgen), so they are declared in argTypes with a "Native attributes"
   * category + description so they don't float above the docgen "Properties" group. The component's
   * behaviour (typed input, disabled blocking) rides a hidden test-only story. File uploads are a
   * separate component (slice 2·1) — Input is text-like only. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Input from "../lib/components/input/index.ts";

  const { Story } = defineMeta({
    title: "Components/Input",
    component: Input,
    args: { placeholder: "Matter reference" },
    // placeholder + disabled are declared (with JSDoc) on the component, so docgen surfaces them
    // under "Properties" with descriptions — no story-level argTypes needed.
  });

  type InputStoryArgs = ComponentProps<typeof Input>;
</script>

{#snippet template(args: InputStoryArgs)}
  <div class="max-w-xs">
    <Input aria-label="Matter reference" {...args} />
  </div>
{/snippet}

<!-- The showcase + Docs Primary; toggle disabled / set value via the Controls panel. -->
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

<!-- Behaviour: disabled blocks input. Hidden from the catalog, still run by the test addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Disabled field" });
    await expect(field).toBeDisabled();
    await userEvent.type(field, "nope", { pointerEventsCheck: 0 });
    await expect(field).toHaveValue("Read only");
  }}
>
  {#snippet template()}
    <Input aria-label="Disabled field" disabled value="Read only" />
  {/snippet}
</Story>

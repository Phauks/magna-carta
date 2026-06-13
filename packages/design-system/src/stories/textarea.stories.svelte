<script module lang="ts">
  /*
   * Textarea — Tier 1 (form control). Catalog model (matches Input/Button): ONE showcase story; the
   * disabled state is a Control, not a story. `placeholder` and `disabled` are forwarded native
   * attributes declared in argTypes with a "Native attributes" category + description so they don't
   * float above the docgen "Properties" group. Behaviour (typed input, disabled blocking) rides a
   * hidden test-only story. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Textarea from "../lib/components/textarea/index.ts";

  const { Story } = defineMeta({
    title: "Components/Textarea",
    component: Textarea,
    args: { placeholder: "Attendance note…" },
    // placeholder + disabled are declared (with JSDoc) on the component, so docgen surfaces them
    // under "Properties" with descriptions — no story-level argTypes needed.
  });

  type TextareaStoryArgs = ComponentProps<typeof Textarea>;
</script>

{#snippet template(args: TextareaStoryArgs)}
  <div class="max-w-md">
    <Textarea aria-label="Attendance note" {...args} />
  </div>
{/snippet}

<!-- The showcase + Docs Primary; toggle disabled / set value via the Controls panel. -->
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

<!-- Behaviour: disabled blocks input. Hidden from the catalog, still run by the test addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Disabled note" });
    await expect(field).toBeDisabled();
    await userEvent.type(field, "nope", { pointerEventsCheck: 0 });
    await expect(field).toHaveValue("Read only");
  }}
>
  {#snippet template()}
    <Textarea aria-label="Disabled note" disabled value="Read only" />
  {/snippet}
</Story>

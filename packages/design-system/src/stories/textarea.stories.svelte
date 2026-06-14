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
    title: "Inputs/Textarea",
    component: Textarea,
    args: { placeholder: "Attendance note…" },
    // placeholder + disabled are declared (with JSDoc) on the component, so docgen surfaces them
    // under "Properties" with descriptions — no story-level argTypes needed.
  });

  type TextareaStoryArgs = ComponentProps<typeof Textarea>;
</script>

{#snippet template(args: TextareaStoryArgs)}
  <!-- No width wrapper: the field is w-full, so it fills the canvas — demonstrating that
       width is reactive to whatever container holds it (a consumer concern, set via utility). -->
  <Textarea aria-label="Attendance note" {...args} />
{/snippet}

<!-- The showcase + Docs Primary; toggle disabled / set value via the Controls panel. -->
<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const field = canvas.getByRole("textbox", { name: "Attendance note" });
    await step("Is a <textarea>", async () => {
      await expect(field.tagName).toBe("TEXTAREA");
    });
    await step("Accepts typed text", async () => {
      await userEvent.type(field, "Drafted the engagement letter.");
      await expect(field).toHaveValue("Drafted the engagement letter.");
    });
  }}
/>

<!-- Behaviour: disabled blocks input. Hidden from the catalog, still run by the test addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const field = canvas.getByRole("textbox", { name: "Disabled note" });
    await step("Disabled textarea ignores typing", async () => {
      await expect(field).toBeDisabled();
      await userEvent.type(field, "nope", { pointerEventsCheck: 0 });
      await expect(field).toHaveValue("Read only");
    });
  }}
>
  {#snippet template()}
    <Textarea aria-label="Disabled note" disabled value="Read only" />
  {/snippet}
</Story>

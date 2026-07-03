<script module lang="ts">
  /*
   * FileInput — Tier 1 (form control). Catalog model (matches Input/Textarea): no variant axis, so
   * ONE showcase story; `accept`, `multiple`, and `disabled` are Controls, not stories. They are
   * declared (with JSDoc) on the component, so docgen surfaces them under "Properties" with
   * descriptions — no story-level argTypes needed. The upload behaviour (selecting a file populates
   * `files`) rides a hidden test-only story. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import FileInput from "../lib/components/file-input/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/FileInput",
    component: FileInput,
  });

  type FileInputStoryArgs = ComponentProps<typeof FileInput>;
</script>

{#snippet template(args: FileInputStoryArgs)}
  <!-- No width wrapper: the control is w-full, so it expands to fill its container (a consumer
       concern, set via utility) — same as Input/Textarea. -->
  <FileInput aria-label="Upload document" {...args} />
{/snippet}

<!-- The showcase + Docs Primary; set accept / multiple / disabled via the Controls panel. -->
<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    await step("Renders a file input", async () => {
      const field = canvas.getByLabelText("Upload document");
      await expect(field).toHaveAttribute("type", "file");
    });
  }}
/>

<!-- Behaviour: selecting a file populates `files`. Hidden from the catalog, still run by the addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Engagement letter") as HTMLInputElement;
    await step("Selecting a file populates files", async () => {
      const file = new File(["engagement"], "letter.pdf", { type: "application/pdf" });
      await userEvent.upload(field, file);
      await expect(field.files).toHaveLength(1);
      await expect(field.files?.[0]?.name).toBe("letter.pdf");
    });
  }}
>
  {#snippet template()}
    <FileInput aria-label="Engagement letter" accept="application/pdf" />
  {/snippet}
</Story>

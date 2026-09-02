<script module lang="ts">
  /*
   * StatusMark — Tier 1. The affirmative mark: a disc filled in the success tone with the check
   * knocked out of it. One story for the mark that speaks and one for the mark that does not, which
   * is the component's whole variant axis: everything else about it is settled by the recipe, on
   * purpose, because three surfaces reaching for their own glyph is what it replaced.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import StatusMark from "../lib/components/status-mark/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/Status mark",
    component: StatusMark,
    args: { label: "Clean" },
  });
</script>

<Story
  name="Named"
  args={{ label: "Clean" }}
  play={async ({ canvas, step }) => {
    await step("Speaks its verdict, because it is often the only thing saying it", async () => {
      await expect(canvas.getByLabelText("Clean")).toBeInTheDocument();
    });
  }}
>
  {#snippet template(args)}
    <StatusMark {...args} />
  {/snippet}
</Story>

<!-- Beside words that already carry the meaning, the mark is decoration and says nothing twice. -->
<Story
  name="Decorative"
  args={{ decorative: true }}
  play={async ({ canvas, step }) => {
    await step("Is hidden from assistive technology", async () => {
      await expect(canvas.queryByLabelText("Clean")).toBeNull();
    });
  }}
>
  {#snippet template(args)}
    <span class="flex items-center gap-8 text-sm">
      <StatusMark {...args} />
      Every requirement is met
    </span>
  {/snippet}
</Story>

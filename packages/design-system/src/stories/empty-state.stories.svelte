<script module lang="ts">
  /*
   * EmptyState — the archetype state-set's "empty (initial)" pattern (Tier 1): heritage
   * watermark + statement + one action. Distinct from "filtered — no results" (which keeps the
   * toolbar and offers Clear filters). svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Plus from "@lucide/svelte/icons/plus";
  import Button from "../lib/components/button/index.ts";
  import EmptyState from "../lib/components/empty-state/empty-state.svelte";

  const { Story } = defineMeta({
    title: "Feedback/EmptyState",
    component: EmptyState,
    parameters: {
      controls: { include: ["title"] },
    },
  });
</script>

<Story
  name="Default"
  args={{ title: "No matters yet" }}
  play={async ({ canvas, step }) => {
    await step("The watermark is decorative; the statement and action carry the meaning", async () => {
      await expect(canvas.getByText("M")).toHaveAttribute("aria-hidden", "true");
      await expect(canvas.getByText("No matters yet")).toBeInTheDocument();
      await expect(canvas.getByRole("button", { name: "New matter" })).toBeInTheDocument();
    });
  }}
>
  {#snippet template(args)}
    <EmptyState {...args}>
      Matters are the file of record for everything the firm does — open the first one to begin.
      {#snippet actions()}
        <Button variant="primary">
          <Plus class="size-16" aria-hidden="true" />
          New matter
        </Button>
      {/snippet}
    </EmptyState>
  {/snippet}
</Story>

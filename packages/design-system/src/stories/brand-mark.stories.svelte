<script module lang="ts">
  /*
   * BrandMark — the illuminated-M + wordmark lockup (Tier 1, native spans). Chrome register: the
   * showcase renders it on the dark ink surface it lives on (the sidebar brand corner, auth,
   * loading). No variant axis and no meaningful controls — the lockup is fixed brand artwork.
   * svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import BrandMark from "../lib/components/brand-mark/brand-mark.svelte";

  const { Story } = defineMeta({
    title: "Foundations/BrandMark",
    component: BrandMark,
    parameters: {
      controls: { include: [] },
    },
  });
</script>

{#snippet template()}
  <div class="flex items-center rounded-md bg-chrome-surface p-16">
    <BrandMark />
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    await step("The wordmark is the accessible name; the glyph is presentation", async () => {
      await expect(canvas.getByText("Magna Carta")).toBeInTheDocument();
      const glyph = canvas.getByText("M");
      await expect(glyph).toHaveAttribute("aria-hidden", "true");
    });
  }}
/>

<script module lang="ts">
  /*
   * MaturityDot — the maturity mark where a labelled badge will not fit. Its meaning is never
   * colour-only: it is an image with the stage as its name, which is what the story asserts.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import MaturityDot from "../lib/components/maturity/maturity-dot.svelte";

  const { Story } = defineMeta({
    title: "Data Display/MaturityDot",
    component: MaturityDot,
    args: { stage: "soon" },
    argTypes: { stage: { control: "select", options: ["soon", "alpha", "beta", "ready"] } },
    parameters: { controls: { include: ["stage"] } },
  });

  type MaturityDotStoryArgs = ComponentProps<typeof MaturityDot>;
</script>

{#snippet template(args: MaturityDotStoryArgs)}
  <MaturityDot {...args} />
{/snippet}

<Story
  name="Soon"
  {template}
  play={async ({ canvas, step }) => {
    await step("Is an image named for its stage, so the colour is never the only signal", () => {
      expect(canvas.getByRole("img", { name: "Soon — in development" })).toBeVisible();
    });
  }}
/>

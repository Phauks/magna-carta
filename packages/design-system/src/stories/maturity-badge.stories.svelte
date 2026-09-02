<script module lang="ts">
  /*
   * MaturityBadge — the labelled mark for a surface still maturing. Only "soon" wears a mark (the
   * owner's ruling: a surface a member can open does not announce how finished it is), so the one
   * visible story is the Soon mark and the other stages are asserted to render nothing on a hidden
   * behaviour story rather than shown as three empty frames.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import MaturityBadge from "../lib/components/maturity/maturity-badge.svelte";

  const { Story } = defineMeta({
    title: "Data Display/MaturityBadge",
    component: MaturityBadge,
    args: { stage: "soon" },
    argTypes: { stage: { control: "select", options: ["soon", "alpha", "beta", "ready"] } },
    parameters: { controls: { include: ["stage"] } },
  });

  type MaturityBadgeStoryArgs = ComponentProps<typeof MaturityBadge>;
</script>

{#snippet template(args: MaturityBadgeStoryArgs)}
  <MaturityBadge {...args} />
{/snippet}

{#snippet everyStage()}
  <div data-testid="stages" class="flex items-center gap-8">
    <MaturityBadge stage="soon" />
    <MaturityBadge stage="alpha" />
    <MaturityBadge stage="beta" />
    <MaturityBadge stage="ready" />
  </div>
{/snippet}

<Story
  name="Soon"
  {template}
  play={async ({ canvas, step }) => {
    await step("Reads Soon, as a badge", () => {
      expect(canvas.getByText("Soon").tagName).toBe("SPAN");
    });
  }}
/>

<Story
  name="OnlySoonWearsAMark"
  tags={["!dev", "!autodocs"]}
  template={everyStage}
  play={async ({ canvas, step }) => {
    await step("Of the four stages, only soon renders anything", () => {
      const marks = canvas.getByTestId("stages").querySelectorAll("span");
      expect([...marks].map((mark) => mark.textContent?.trim())).toEqual(["Soon"]);
    });
  }}
/>

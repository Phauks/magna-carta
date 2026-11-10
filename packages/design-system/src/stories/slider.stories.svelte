<script module lang="ts">
  /*
   * Slider — Tier 2 (Bits UI). One value along a track. It holds a value, so it is an Input. It has
   * no variant axis, so it is one story with `value`, `min`, `max`, `step` and `disabled` as
   * controls, plus a hidden behaviour story for the keys, the buffered fill and the disabled state.
   * Bits components whitelist controls (see CLAUDE.md). svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Slider from "../lib/components/slider/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/Slider",
    component: Slider,
    args: { value: 40, min: 0, max: 100, step: 5, disabled: false, label: "Volume" },
    parameters: {
      controls: { include: ["value", "min", "max", "step", "disabled", "buffered"] },
    },
  });

  type SliderStoryArgs = ComponentProps<typeof Slider>;
</script>

{#snippet template(args: SliderStoryArgs)}
  <div class="max-w-sm">
    <Slider {...args} />
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const thumb = canvas.getByRole("slider", { name: "Volume" });
    await step("Exposes its value to assistive tech", async () => {
      await expect(thumb).toHaveAttribute("aria-valuenow", "40");
    });
    await step("An arrow key moves it by one step", async () => {
      thumb.focus();
      await userEvent.keyboard("{ArrowRight}");
      await expect(thumb).toHaveAttribute("aria-valuenow", "45");
    });
  }}
/>

<Story name="Behaviour" tags={["!dev", "!autodocs"]}>
  {#snippet template()}
    <div class="flex max-w-sm flex-col gap-16">
      <Slider label="Seek" value={30} max={120} buffered={0.5} valueText="30 seconds of 2 minutes" />
      <Slider label="Locked" value={20} disabled />
    </div>
  {/snippet}
</Story>

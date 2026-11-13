<script module lang="ts">
  /*
   * SoonAffordance — a control that is designed but not yet served, rendered honestly: the real
   * control, disabled, the Soon mark beside it, and the dependency as its accessible description.
   * Two stories, one per `reasonPlacement`, because that is the one thing a call site may vary.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import SoonAffordance from "../lib/components/maturity/soon-affordance.svelte";
  import Button from "../lib/components/button/index.ts";

  const { Story } = defineMeta({
    title: "Actions/SoonAffordance",
    component: SoonAffordance,
    args: { reason: "archive extraction", reasonPlacement: "hover" },
    argTypes: { reasonPlacement: { control: "select", options: ["hover", "line"] } },
    parameters: { controls: { include: ["reason", "reasonPlacement"] } },
  });

  type SoonAffordanceStoryArgs = ComponentProps<typeof SoonAffordance>;
</script>

{#snippet template(args: SoonAffordanceStoryArgs)}
  <SoonAffordance {...args}>
    {#snippet control(soon)}
      <Button variant="secondary" {...soon}>Restore This File Into the Matter</Button>
    {/snippet}
  </SoonAffordance>
{/snippet}

<Story
  name="ReasonOnHover"
  {template}
  play={async ({ canvas, step }) => {
    const control = canvas.getByRole("button", { name: "Restore This File Into the Matter" });

    await step("The control renders for real, and is disabled", () => {
      expect(control).toBeVisible();
      expect(control).toBeDisabled();
    });

    await step("The Soon mark sits beside it", () => {
      expect(canvas.getByText("Soon")).toBeVisible();
    });

    await step("The dependency is the control's description, whether or not it is drawn", () => {
      expect(control).toHaveAccessibleDescription(
        "Not built yet: archive extraction.",
      );
      expect(control).toHaveAttribute("title", "Not built yet: archive extraction.");
    });
  }}
/>

<Story
  name="ReasonOnALine"
  args={{ reasonPlacement: "line" }}
  {template}
  play={async ({ canvas, step }) => {
    await step("The sentence is drawn beneath the control", () => {
      expect(canvas.getByText("Not built yet: archive extraction.")).toBeVisible();
    });
  }}
/>

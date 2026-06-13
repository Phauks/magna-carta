<script module lang="ts">
  /*
   * Alert — Tier 1 batch. One story per variant (each a genuinely different display). The ARIA
   * live-region role is an automated check, not something to eyeball, so it rides the play
   * function of the variant it applies to: Danger asserts the assertive role="alert", Info asserts
   * the polite role="status". No separate behavior-only stories. svelte-csf requires `component` to
   * be a directly imported identifier, so the root is imported on its own.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import * as Alert from "../lib/components/alert/index.ts";
  import AlertRoot from "../lib/components/alert/alert.svelte";

  const { Story } = defineMeta({
    title: "Components/Alert",
    component: AlertRoot,
    args: { variant: "info" },
    argTypes: {
      variant: { control: "select", options: ["info", "success", "warning", "danger"] },
    },
  });

  type AlertStoryArgs = ComponentProps<typeof AlertRoot>;
</script>

{#snippet template(args: AlertStoryArgs)}
  <Alert.Root {...args}>
    <Alert.Title>Trust balance below minimum</Alert.Title>
    <Alert.Description>
      The trust ledger for ACME-2026-014 has fallen below the required minimum.
    </Alert.Description>
  </Alert.Root>
{/snippet}

<Story
  name="Info"
  args={{ variant: "info" }}
  {template}
  play={async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Trust balance below minimum");
  }}
/>
<Story name="Success" args={{ variant: "success" }} {template} />
<Story name="Warning" args={{ variant: "warning" }} {template} />
<Story
  name="Danger"
  args={{ variant: "danger" }}
  {template}
  play={async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent("Trust balance below minimum");
  }}
/>

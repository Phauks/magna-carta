<script module lang="ts">
  /*
   * Alert — Tier 1 batch (the Button exemplar pattern applied to a multi-part composition with a
   * typed variant record). Stories cover every variant and double as per-story axe checks
   * (.storybook/preview.ts sets a11y.test = "error"). Play functions assert the ARIA role the
   * variant maps to: assertive role="alert" for danger/warning, polite role="status" for
   * info/success. svelte-csf v5 API; the meta imports the root component directly (the analyser
   * requires an imported identifier, not a namespace member).
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

<Story name="Info" args={{ variant: "info" }} {template} />
<Story name="Success" args={{ variant: "success" }} {template} />
<Story name="Warning" args={{ variant: "warning" }} {template} />
<Story name="Danger" args={{ variant: "danger" }} {template} />

<!-- ----- behavior assertions (play functions) ------------------------------------------- -->

<Story
  name="Danger announces assertively"
  args={{ variant: "danger" }}
  play={async ({ canvas }) => {
    // role="alert" is an assertive live region — used for time-sensitive danger/warning.
    const alert = canvas.getByRole("alert");
    await expect(alert).toHaveTextContent("Trust balance below minimum");
  }}
  {template}
/>

<Story
  name="Info announces politely"
  args={{ variant: "info" }}
  play={async ({ canvas }) => {
    // role="status" is a polite live region — used for advisory info/success.
    const status = canvas.getByRole("status");
    await expect(status).toHaveTextContent("Trust balance below minimum");
    // ...and it is NOT the assertive role.
    await expect(canvas.queryByRole("alert")).toBeNull();
  }}
  {template}
/>

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
    title: "Feedback/Alert",
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
  play={async ({ canvas, step }) => {
    await step("Info renders a polite live region (role=status)", async () => {
      await expect(canvas.getByRole("status")).toHaveTextContent("Trust balance below minimum");
    });
    await step("It carries a decorative leading glyph (aria-hidden)", async () => {
      const icon = canvas.getByRole("status").querySelector(".mc-alert-icon");
      await expect(icon).not.toBeNull();
      await expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  }}
/>
<Story name="Success" args={{ variant: "success" }} {template} />
<Story name="Warning" args={{ variant: "warning" }} {template} />
<Story
  name="Danger"
  args={{ variant: "danger" }}
  {template}
  play={async ({ canvas, step }) => {
    await step("Danger renders an assertive live region (role=alert)", async () => {
      await expect(canvas.getByRole("alert")).toHaveTextContent("Trust balance below minimum");
    });
  }}
/>

<!-- The four intents shown together — the calm subtle register a work surface uses (a leading
     same-hue glyph, a pale tint, a soft same-hue hairline), compared as a family. -->
<Story name="Status set">
  {#snippet template()}
    <div class="flex flex-col gap-12">
      <Alert.Root variant="info">
        <Alert.Title>Conflicts check queued</Alert.Title>
        <Alert.Description>We'll notify you when the search completes.</Alert.Description>
      </Alert.Root>
      <Alert.Root variant="success">
        <Alert.Title>Time entry saved</Alert.Title>
        <Alert.Description>1.4 hours billed to ACME-2026-014.</Alert.Description>
      </Alert.Root>
      <Alert.Root variant="warning">
        <Alert.Title>Engagement letter unsigned</Alert.Title>
        <Alert.Description>The matter cannot be billed until the letter is signed.</Alert.Description>
      </Alert.Root>
      <Alert.Root variant="danger">
        <Alert.Title>Trust balance below minimum</Alert.Title>
        <Alert.Description>
          The trust ledger for ACME-2026-014 has fallen below the required minimum.
        </Alert.Description>
      </Alert.Root>
    </div>
  {/snippet}
</Story>

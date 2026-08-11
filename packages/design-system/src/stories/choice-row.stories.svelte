<script module lang="ts">
  /*
   * ChoiceRow — Tier 2. The full-width row that IS the choice: icon, name over supporting facts,
   * optional trailing status. Three stories cover the registers it has to serve — a plain action
   * row, a selected row in a set, and a disabled row that says why it cannot be used. The play
   * functions assert the accessible name and the pressed semantics, since `selected` being
   * optional is the whole point of the prop.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Building from "@lucide/svelte/icons/building-2";
  import Smartphone from "@lucide/svelte/icons/smartphone";
  import { expect } from "storybook/test";
  import Badge from "../lib/components/badge/index.ts";
  import ChoiceRow from "../lib/components/choice-row/index.ts";

  const { Story } = defineMeta({
    title: "Actions/ChoiceRow",
    component: ChoiceRow,
    parameters: {
      controls: { include: ["selected", "disabled"] },
    },
  });
</script>

{#snippet action()}
  <div class="flex max-w-sm flex-col gap-8">
    <ChoiceRow>
      {#snippet icon()}<Smartphone size={17} />{/snippet}
      Authenticator app code
    </ChoiceRow>
  </div>
{/snippet}

<Story
  name="Action"
  template={action}
  play={async ({ canvas, step }) => {
    await step("Is a button, and reports no pressed state", async () => {
      const row = canvas.getByRole("button", { name: "Authenticator app code" });
      await expect(row).not.toHaveAttribute("aria-pressed");
    });
  }}
/>

{#snippet selection()}
  <div class="flex max-w-sm flex-col gap-8">
    <ChoiceRow selected>
      {#snippet icon()}<Building size={17} />{/snippet}
      {#snippet detail()}Las Vegas, Nevada · Last opened August 10, 2026{/snippet}
      {#snippet trailing()}<Badge variant="neutral">Firm</Badge>{/snippet}
      Goldsmith and Associates
    </ChoiceRow>
    <ChoiceRow selected={false}>
      {#snippet icon()}<Building size={17} />{/snippet}
      {#snippet detail()}Reno, Nevada · Last opened August 4, 2026{/snippet}
      {#snippet trailing()}<Badge variant="neutral">Client</Badge>{/snippet}
      Carta Family Law
    </ChoiceRow>
  </div>
{/snippet}

<Story
  name="Selection"
  template={selection}
  play={async ({ canvas, step }) => {
    await step("The chosen row is the pressed one", async () => {
      await expect(canvas.getByRole("button", { pressed: true })).toHaveAccessibleName(
        /Goldsmith and Associates/,
      );
    });
  }}
/>

{#snippet unavailable()}
  <div class="flex max-w-sm flex-col gap-8">
    <ChoiceRow disabled>
      {#snippet icon()}<Smartphone size={17} />{/snippet}
      {#snippet detail()}Add a phone number before this channel can be used{/snippet}
      Text a code
    </ChoiceRow>
  </div>
{/snippet}

<Story
  name="Unavailable"
  template={unavailable}
  play={async ({ canvas, step }) => {
    await step("A row that cannot be chosen is disabled, and says why in its own detail", async () => {
      const row = canvas.getByRole("button", { name: /Text a code/ });
      await expect(row).toBeDisabled();
      await expect(row).toHaveAccessibleName(/Add a phone number/);
    });
  }}
/>

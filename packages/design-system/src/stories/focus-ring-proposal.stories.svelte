<script module lang="ts">
  /*
   * SCRATCH PREVIEW (not part of the catalog) — a side-by-side of the CURRENT focus ring (brand) vs the
   * PROPOSED gold focus ring, for owner review of audit #1. Tab through each column to compare the ring.
   *
   * The proposed column only sets `--mc-focus-ring: var(--mc-accent-default)` on its wrapper — every
   * control already draws its focus ring from that variable, so this faithfully previews the real change
   * (one token: focus.ring → accent.default) with NO component edits. accent.default is mode-adaptive
   * (deep gold on light, bright gold on dark), so the ring stays high-contrast in both modes:
   *   light  8.28:1  (vs the current brand ring 3.56:1)
   *   dark   8.06:1  (vs the current brand ring 8.08:1)
   * — both far above the WCAG 2.2 non-text minimum of 3:1. Delete this file once the direction is settled.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Button from "../lib/components/button/index.ts";
  import Input from "../lib/components/input/index.ts";
  import Textarea from "../lib/components/textarea/index.ts";
  import Checkbox from "../lib/components/checkbox/index.ts";
  import Switch from "../lib/components/switch/index.ts";
  import Label from "../lib/components/label/index.ts";

  const { Story } = defineMeta({
    title: "Foundations/Focus ring (proposal)",
    parameters: { controls: { include: [] }, layout: "fullscreen" },
  });
</script>

{#snippet controls(prefix: string)}
  <div class="flex flex-col gap-12">
    <div class="flex flex-col gap-4">
      <Label for={`${prefix}-name`}>Client name</Label>
      <Input id={`${prefix}-name`} placeholder="Pemberton, J." />
    </div>
    <div class="flex flex-col gap-4">
      <Label for={`${prefix}-note`}>Note</Label>
      <Textarea id={`${prefix}-note`} placeholder="Add a note…" />
    </div>
    <div class="flex flex-wrap gap-8">
      <Button>Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="accent">New</Button>
    </div>
    <div class="flex items-center gap-8">
      <Checkbox aria-label="Conflicts cleared" /><span class="text-sm text-default">Conflicts cleared</span>
    </div>
    <div class="flex items-center gap-8">
      <Switch aria-label="Trust alerts" /><span class="text-sm text-default">Trust alerts</span>
    </div>
  </div>
{/snippet}

<Story name="Compare">
  {#snippet template()}
    <div class="flex flex-col gap-16 bg-surface-default p-24">
      <div class="flex flex-col gap-4">
        <h2 class="text-lg font-semibold text-default">Focus ring — current vs proposed</h2>
        <p class="max-w-2xl text-sm text-muted">
          Tab through each column (or click then Tab) to compare the keyboard focus ring. The proposal
          swaps the focus colour from brand to the gold accent — a light, on-brand touch that reads as
          identity at the control's edge. It is mode-adaptive (deep gold on light, bright gold on dark)
          and actually higher-contrast than today's ring (8.3:1 light / 8.1:1 dark vs 3.6:1 / 8.1:1).
          The real change is one token (focus.ring → accent.default); nothing else moves. Switch
          light/dark with the Storybook theme toolbar.
        </p>
      </div>
      <div class="flex flex-wrap gap-32">
        <section class="flex flex-col gap-12">
          <h3 class="text-sm font-semibold text-muted">Current — brand ring</h3>
          {@render controls("current")}
        </section>
        <!-- The whole proposal: redirect the focus-ring variable to the gold accent. -->
        <section class="flex flex-col gap-12" style="--mc-focus-ring: var(--mc-accent-default)">
          <h3 class="text-sm font-semibold text-muted">Proposed — gold ring</h3>
          {@render controls("proposed")}
        </section>
      </div>
    </div>
  {/snippet}
</Story>

<script lang="ts">
  /*
   * One labelled setting on the identity comparison: what it is called, what it takes off the
   * band, and the two sentences that decide it. The recovered height is MEASURED — the band binds
   * its own clientHeight and this caption subtracts it from the shipping one — because the whole
   * point of the page is the number, and a hand-written "saves about 20px" would be the one claim
   * on it nobody could check.
   */
  import Badge from "@magna-carta/design-system/badge";
  import type { Snippet } from "svelte";

  let {
    name,
    gains,
    costs,
    height,
    baselineHeight,
    children,
  }: {
    name: string;
    gains: string;
    costs: string;
    height: number;
    baselineHeight: number;
    children: Snippet;
  } = $props();

  const recovered = $derived(baselineHeight - height);
</script>

<figure class="m-0 flex flex-col gap-12">
  <figcaption class="flex flex-col gap-8">
    <div class="flex flex-wrap items-center gap-8">
      <span class="text-sm font-semibold text-text-default">{name}</span>
      {#if recovered > 0}
        <Badge variant="success">{recovered}px recovered</Badge>
      {:else}
        <Badge variant="neutral">Ships today</Badge>
      {/if}
      <span class="text-xs text-text-muted">Band {height}px</span>
    </div>
    <dl class="m-0 flex flex-col gap-4 text-xs">
      <div class="flex gap-8">
        <dt
          class="w-64 flex-none text-text-subtle uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          Gains
        </dt>
        <dd class="m-0 max-w-prose text-text-muted">{gains}</dd>
      </div>
      <div class="flex gap-8">
        <dt
          class="w-64 flex-none text-text-subtle uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          Costs
        </dt>
        <dd class="m-0 max-w-prose text-text-muted">{costs}</dd>
      </div>
    </dl>
  </figcaption>
  <div class="rounded-lg bg-surface-sunken p-24">
    <div class="rounded-md bg-surface-default p-24">
      {@render children()}
    </div>
  </div>
</figure>

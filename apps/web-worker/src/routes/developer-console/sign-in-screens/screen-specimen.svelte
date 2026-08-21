<script lang="ts">
  /*
   * One labelled specimen on the sign-in screen-state page: a caption saying which state this is
   * and whether the product can actually reach it, then the screen itself on the surface it really
   * renders against.
   *
   * The reachability marker is the point of the caption. A page that shows twenty screens without
   * saying which four exist today is a prettier version of the problem it replaces — a reviewer
   * would take the whole set as built. So every specimen declares itself in one of three ways:
   * live, standing in for a capability the server does not have
   * (../../../lib/auth/unbuilt-capabilities.ts), or real but landing short of where a visitor would
   * expect it to end (../../../lib/auth/joining-availability.ts). The third is its own marker
   * because "no server route" would be a wrong description of a screen whose route answers.
   */
  import type { Snippet } from "svelte";
  import Badge from "@magna-carta/design-system/badge";

  let {
    name,
    note,
    unbuilt,
    caveat,
    children,
  }: {
    /** Which state this is, in the words a reviewer would use to ask for it. */
    name: string;
    /** What to look at, or why the state exists. */
    note?: string;
    /** What the server cannot do, when this specimen depends on something unbuilt. */
    unbuilt?: string;
    /** Where a working screen stops short, when its route answers but something outside it does not. */
    caveat?: string;
    children: Snippet;
  } = $props();
</script>

<figure class="m-0 flex flex-col gap-8">
  <figcaption class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-8">
      <span class="text-sm font-semibold text-text-default">{name}</span>
      {#if unbuilt}
        <Badge variant="warning">No server route</Badge>
      {:else if caveat}
        <Badge variant="warning">Stops short</Badge>
      {:else}
        <Badge variant="success">Live today</Badge>
      {/if}
    </div>
    {#if note}<p class="max-w-prose text-xs text-text-muted">{note}</p>{/if}
    {#if unbuilt}<p class="max-w-prose text-xs text-status-warning-subtle-foreground">{unbuilt}</p>{/if}
    {#if caveat}<p class="max-w-prose text-xs text-status-warning-subtle-foreground">{caveat}</p>{/if}
  </figcaption>
  <div class="flex justify-center rounded-lg bg-surface-sunken p-24">
    {@render children()}
  </div>
</figure>

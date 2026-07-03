<script lang="ts">
  /*
   * The route error surface — the archetype state-set's error pattern: a recoverable message,
   * Retry, and the user-facing Error ID slot (golden rule 4). 404s read as a wayfinding miss,
   * not a fault; everything else offers the reload path.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";

  const notFound = $derived(page.status === 404);
</script>

<svelte:head>
  <title>{notFound ? "Not found" : "Something went wrong"} · Magna Carta</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-surface-default">
  {#if notFound}
    <EmptyState title="There's nothing at this address">
      The page may have moved, or the link may be stale. Everything in the firm is reachable from
      Home.
      {#snippet actions()}
        <Button variant="primary" href="/">Go home</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState title="Something went wrong">
      The error has been noted{page.error?.message ? ` — ${page.error.message}` : ""}. Retry, and
      if it persists, report the problem with the Error ID shown here.
      {#snippet actions()}
        <Button variant="primary" onclick={() => location.reload()}>Retry</Button>
        <Button variant="secondary" href="/">Go home</Button>
      {/snippet}
    </EmptyState>
  {/if}
</div>

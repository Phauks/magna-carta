<script lang="ts">
  /*
   * The BARE error surface — only for failures outside the (app) shell (in-app errors render
   * inside the chrome via routes/(app)/+error.svelte). Same archetype pattern: a recoverable
   * message, Retry, and the copyable diagnostics block (golden rule 4's user-facing Error ID
   * rides in it).
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import ErrorDetails from "$lib/components/error-details.svelte";

  const notFound = $derived(page.status === 404);
</script>

<svelte:head>
  <title>{notFound ? "Not found" : "Something went wrong"} · Magna Carta</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-surface-default">
  {#if notFound}
    <EmptyState title="There's nothing at this address">
      The page may have moved, or the link may be stale. Everything in the firm is reachable from
      Home.
      {#snippet actions()}
        <Button variant="primary" href="/home">Go home</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState title="Something went wrong">
      The error has been noted. Retry, and if it persists, copy the details below into a report.
      {#snippet actions()}
        <Button variant="primary" onclick={() => location.reload()}>Retry</Button>
        <Button variant="secondary" href="/home">Go home</Button>
      {/snippet}
    </EmptyState>
  {/if}
  <ErrorDetails />
</div>

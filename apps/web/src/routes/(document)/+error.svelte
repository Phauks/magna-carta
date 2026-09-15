<script lang="ts">
  /*
   * A wrong turn inside a document tab. The (app) group's twin, with the one difference this group
   * exists for: there is no destination rail here, so nothing may tell the member to use it. What
   * this tab HAS is a way back into the application and the browser's own history, and those are
   * what it offers.
   *
   * The address that reaches this most often is a document that is no longer openable — the route's
   * load answers 404 for a file that is pending only, rejected or deleted — so the not-found copy
   * speaks about the document rather than about pages in general.
   *
   * A 404 is not a failure and does not pretend to be one: nothing broke, there is nothing to
   * report, and no Error ID exists to quote.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FailureScreen from "$lib/diagnostics/failure-screen.svelte";
  import ReportDialog from "$lib/diagnostics/report-dialog.svelte";
  import { routeFailure } from "$lib/diagnostics/route-failure.ts";

  const notFound = $derived(page.status === 404);
  const failure = $derived(routeFailure(page));
  let reportOpen = $state(false);

  // Back renders only when there is somewhere to go back TO. A document tab is usually opened
  // beside the file manager rather than navigated to, so it often has no in-app history at all —
  // hiding Back beats offering a dead button (the no-dead-controls rule).
  const canGoBack = typeof history !== "undefined" && history.length > 1;
</script>

<svelte:head>
  <title>{notFound ? "Not found" : "Something went wrong"} · Magna Carta</title>
</svelte:head>

<div class="flex flex-col items-center">
  {#if notFound}
    <EmptyState title="This document can't be opened">
      It may have been deleted, or it may still be going through the safety check that has to finish
      before a file can be opened. Its matter's Files list will say which.
      {#snippet actions()}
        {#if canGoBack}
          <Button variant="primary" onclick={() => history.back()}>Go Back</Button>
        {/if}
        <Button variant={canGoBack ? "secondary" : "primary"} href="/matters">Go to Matters</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <FailureScreen
      {failure}
      scale="screen"
      subject="This document"
      fallback={page.error?.message}
      reassurance="The document itself is unaffected — this is the screen failing to draw, not the
        firm's record."
      steps={[
        "Reload: a brief interruption usually clears on the next attempt.",
        "Open the document again from its matter's Files list.",
        "If it keeps happening, report it with the Error ID above.",
      ]}
      onRetry={() => location.reload()}
      onReport={() => (reportOpen = true)}
    />
    <ReportDialog
      bind:open={reportOpen}
      errorId={failure.problem?.errorId ?? null}
      route={failure.request}
    />
  {/if}
</div>

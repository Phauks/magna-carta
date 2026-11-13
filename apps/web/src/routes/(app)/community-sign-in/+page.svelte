<script lang="ts">
  /*
   * The way from the app to the community board, signed in. The board lives on its own host and
   * cannot read this app's session, so this page asks the app for a one-minute, one-use link and
   * sends the browser to it; the board then signs the member in on its side. The link is fetched
   * here, at the moment the member chose to go, and never earlier.
   *
   * A person who is not signed in to the app meets the app's own sign-in first, through the (app)
   * layout, and comes back here afterwards.
   */
  import { onMount } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import { meCommunityHandoff } from "@magna-carta/api-client";
  import { failureOf } from "$lib/api/api-client.ts";
  import type { Failure } from "$lib/api/problem.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";

  let failure: Failure | null = $state(null);

  async function go(): Promise<void> {
    failure = null;
    try {
      const { data } = await meCommunityHandoff({ throwOnError: true });
      window.location.replace(data.url);
    } catch (caught) {
      failure = failureOf(caught);
    }
  }

  onMount(() => {
    void go();
  });
</script>

<svelte:head>
  <title>Community Board · Magna Carta</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="flex flex-col gap-16">
  {#if failure === null}
    <p class="text-sm text-text-muted">Signing you in to the community board.</p>
  {:else}
    <FailureNotice
      {failure}
      subject="Signing in to the community board"
      onRetry={() => void go()}
    />
    <div>
      <Button variant="secondary" href="https://community.magnacarta.esq">Read the Board Without Signing In</Button>
    </div>
  {/if}
</div>

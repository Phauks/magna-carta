<script lang="ts">
  /*
   * The community board's frame. On community.magnacarta.esq every path lands here (src/hooks.ts
   * reroutes them), and the board's own worker answers the reads and writes these pages make.
   *
   * It reads who is visiting once and shares it with every board page. A board switched off by an
   * operator says so and draws nothing else. The board's notices (read-only, a sign-in link that
   * did not work) are drawn by the top bar, under the board's own header.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { isCommunityHost } from "$lib/community/board-paths.ts";
  import { provideBoardSession } from "$lib/community/board-session.svelte.ts";

  let { children } = $props();

  const board = provideBoardSession();
  const onBoardHost = $derived(isCommunityHost(page.url.hostname) || import.meta.env.DEV);
  // The Changelog is the one page search engines may list; the rest of the board never is.
  const listable = $derived(page.route.id === "/community-board/changelog");

  $effect(() => {
    if (onBoardHost) void board.refresh();
  });
</script>

<svelte:head>
  {#if !listable}
    <meta name="robots" content="noindex, nofollow" />
  {/if}
  <meta name="referrer" content="no-referrer" />
</svelte:head>

{#if !onBoardHost}
  <main class="flex min-h-screen flex-col items-center justify-center gap-12 bg-surface-sunken p-32 text-center">
    <h1 class="text-xl font-semibold">The community board has its own address</h1>
    <Button href="https://community.magnacarta.esq">Open the Community Board</Button>
  </main>
{:else if board.failure !== null && board.session === null}
  <main class="flex min-h-screen flex-col gap-16 bg-surface-sunken p-32">
    <FailureNotice failure={board.failure} subject="The community board" onRetry={() => void board.refresh()} />
  </main>
{:else if board.session?.boardState === "off"}
  <main class="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface-sunken p-32 text-center">
    <h1 class="text-xl font-semibold">The community board is closed for now</h1>
    <p class="text-sm text-text-muted">Nothing on it has been lost. It will be back.</p>
  </main>
{:else}
  {@render children()}
{/if}

<script lang="ts">
  /*
   * Community board states — the board's home (layout A), an opened request, and the composer,
   * rendered from the real components over an invented board. This is the REVIEW SURFACE for the
   * community screens until the board's own host serves them with live data: what a reviewer sees
   * here is what the board will render, not a second implementation of it.
   *
   * Dev builds only, like the developer console itself: behind the import.meta.env.DEV gate, so
   * production serves the unavailable notice and the whole page tree shakes away.
   */
  import BoardScreen from "$lib/community/board-screen.svelte";
  import PostScreen from "$lib/community/post-screen.svelte";
  import ComposerDialog from "$lib/community/composer-dialog.svelte";
  import { page } from "$app/state";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import { GALLERY_COMMENTS, GALLERY_POSTS, GALLERY_SUMMARY } from "./community-fixtures.ts";

  // ?state=board | post | composer | empty — one state per load, so each can be looked at alone.
  const view = $derived(page.url.searchParams.get("state") ?? "board");
  let composerOpen = $state(true);
  let composerBody = $state(
    "When we reverse a payment for Hendricks v. Lowell, matter 2026-CV-0412, the invoice goes back to unpaid and the client sees it again.",
  );
  let composerTitle = $state("Reverse a trust payment without voiding the invoice");
  let composerCategory: string | null = $state("trust-and-reconciliation");
</script>

<svelte:head>
  <title>Community board states · Magna Carta</title>
</svelte:head>

{#if import.meta.env.DEV}
  <div class="border-b border-border-default bg-surface-default px-24 py-12">
    <ScreenHeader title="Community board states" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
  </div>
  {#if view === "post"}
    <PostScreen
      post={GALLERY_POSTS[0]!}
      comments={GALLERY_COMMENTS}
      viewerDisplayName="J. Castellanos"
      statusNote="Moved to Planned"
    />
  {:else}
    <BoardScreen
      posts={view === "empty" ? [] : GALLERY_POSTS}
      total={view === "empty" ? 0 : 412}
      summary={GALLERY_SUMMARY}
      knownIssue={{ title: "Slow PDF previews for large exhibits", standing: "Investigating since November 9, 2026" }}
      viewerDisplayName="Dana R."
    />
    {#if view === "composer"}
      <ComposerDialog
        bind:open={composerOpen}
        bind:body={composerBody}
        bind:title={composerTitle}
        bind:category={composerCategory}
        displayName="Dana R."
      />
    {/if}
  {/if}
{:else}
  <p class="p-16 text-sm text-text-muted">
    The developer console is only available in development builds.
  </p>
{/if}

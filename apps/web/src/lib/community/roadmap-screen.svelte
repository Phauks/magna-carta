<script lang="ts">
  /*
   * The board's roadmap: the requests the Magna Carta team has taken on, in five columns by status,
   * most-voted first. It is a filtered view of the board, not a second list, so a card is the
   * request itself and opens it. There are no target dates anywhere: a card can move backwards, and
   * a date would be a promise.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import type { BoardPostView } from "@magna-carta/community/board-service";
  import { productAreaLabel, ROADMAP_COLUMNS } from "@magna-carta/community/vocabulary";
  import { page } from "$app/state";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import CommunityTopBar from "./community-top-bar.svelte";
  import { boardPath } from "./board-paths.ts";
  import { communityStatusKey } from "./community-status.ts";

  type Column = (typeof ROADMAP_COLUMNS)[number];

  let {
    columns,
    viewerDisplayName,
    signInUrl = null,
    failure = null,
    onRetry,
    onSignOut,
  }: {
    columns: Readonly<Record<Column, { posts: readonly BoardPostView[]; total: number }>>;
    viewerDisplayName: string | null;
    signInUrl?: string | null;
    failure?: Failure | null;
    onRetry?: () => void;
    onSignOut?: () => void;
  } = $props();
</script>

<div class="flex min-h-screen flex-col bg-surface-sunken text-text-default">
  <CommunityTopBar current="roadmap" {viewerDisplayName} {signInUrl} {onSignOut} />
  <main class="flex flex-col gap-16 px-32 py-24">
    <div class="flex flex-wrap items-baseline gap-12">
      <h1 class="text-2xl font-semibold">Roadmap</h1>
      <span class="text-sm text-text-muted">No target dates. Cards can move backwards.</span>
    </div>
    {#if failure !== null}
      <FailureNotice {failure} subject="The roadmap" {onRetry} />
    {:else}
      <div class="grid grid-cols-5 gap-12">
        {#each ROADMAP_COLUMNS as column (column)}
          {@const key = communityStatusKey(column)}
          {@const entry = columns[column]}
          <section aria-label={statusEntry(key).label} class="flex min-w-0 flex-col gap-8">
            <div class="flex items-center justify-between px-4">
              <Badge {...statusBadgeAttributes(key)} caps>{statusEntry(key).label}</Badge>
              <span class="text-xs text-text-subtle tabular-nums">{entry.total}</span>
            </div>
            <ol class="flex flex-col gap-8">
              {#each entry.posts as post (post.number)}
                <li>
                  <a
                    href={boardPath(`/posts/${post.number}`, page.url.hostname)}
                    class="flex flex-col gap-4 rounded-lg border border-border-default bg-surface-default p-12 hover:border-border-strong"
                  >
                    <span class="text-sm font-semibold">{post.title}</span>
                    <span class="text-xs text-text-subtle">
                      {productAreaLabel(post.category)} · {post.voteCount === null
                        ? "Fewer than five votes"
                        : `${post.voteCount} votes`}
                    </span>
                  </a>
                </li>
              {/each}
            </ol>
            {#if entry.posts.length === 0}
              <p class="px-4 text-xs text-text-subtle">Nothing here yet.</p>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  </main>
</div>

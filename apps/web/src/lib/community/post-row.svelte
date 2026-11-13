<script lang="ts">
  /*
   * One post in the board's list: the vote control, the title, a one-line excerpt, then its status,
   * product area, comment count, author's display name and the date it was posted. Never a firm.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import type { BoardPostView } from "@magna-carta/community/board-service";
  import { productAreaLabel } from "@magna-carta/community/vocabulary";
  import VoteButton from "./vote-button.svelte";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";
  import { communityStatusKey } from "./community-status.ts";
  import { boardPath } from "./board-paths.ts";
  import { page } from "$app/state";

  let {
    post,
    onVote,
  }: {
    post: BoardPostView;
    onVote?: () => void;
  } = $props();

  const statusKey = $derived(communityStatusKey(post.status));
</script>

<li class="flex gap-16 border-t border-border-default px-16 py-16 first:border-t-0">
  {#if post.kind === "request"}
    <VoteButton
      voteCount={post.voteCount}
      firmVoteCount={post.firmVoteCount}
      voted={post.viewerHasVoted}
      onToggle={onVote}
    />
  {/if}
  <div class="flex min-w-0 flex-1 flex-col gap-4">
    <a href={boardPath(`/posts/${post.number}`, page.url.hostname)} class="text-md font-semibold text-text-default hover:underline">
      {post.title}
    </a>
    <p class="truncate text-sm text-text-muted">{post.body}</p>
    <div class="flex flex-wrap items-center gap-12 text-xs text-text-subtle">
      <Badge {...statusBadgeAttributes(statusKey)} caps>{statusEntry(statusKey).label}</Badge>
      {#if post.moderationState === "held"}
        <Badge variant="warning" title="Waiting for the Magna Carta team to read it. Only you can see it."
          >Waiting for Review</Badge
        >
      {/if}
      <span class="text-text-muted">{productAreaLabel(post.category)}</span>
      <span class="flex items-center gap-4 tabular-nums">
        <MessageSquare class="size-12" aria-hidden="true" />
        <span class="sr-only">Comments:</span>{post.commentCount}
      </span>
      <span>{post.authorDisplayName}</span>
      <time datetime={post.createdAt}>{formatInstantDate(post.createdAt)}</time>
    </div>
  </div>
</li>

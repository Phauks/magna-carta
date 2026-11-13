<script lang="ts">
  /*
   * The Magna Carta team's moderation queue: every post and comment held before anyone sees it
   * (a first contribution, or text the confidentiality detector caught) and everything readers'
   * reports have hidden. Each item shows its text in full, because the decision is made on the
   * text; Publish puts it up, Remove blanks it in place. The reports are counted by reason, never
   * by who made them.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";
  import type { ModerationItem } from "@magna-carta/community/board-service";
  import type { FlagReason, HeldReason } from "@magna-carta/community/vocabulary";
  import { page } from "$app/state";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import CommunityTopBar from "./community-top-bar.svelte";
  import { boardPath } from "./board-paths.ts";

  let {
    items,
    viewerDisplayName,
    actionFailure = null,
    busyKey = null,
    onSignOut,
    onDecide,
  }: {
    items: readonly ModerationItem[];
    viewerDisplayName: string | null;
    actionFailure?: Failure | null;
    /** The item a decision is being sent for, so its buttons wait. */
    busyKey?: string | null;
    onSignOut?: () => void;
    onDecide?: (item: ModerationItem, decision: "publish" | "remove") => void;
  } = $props();

  const HELD_LABELS: Record<HeldReason, string> = {
    "first-post": "First Contribution",
    detector: "Possible Client Detail",
  };
  const REPORT_LABELS: Record<FlagReason, string> = {
    confidential: "Client Detail",
    spam: "Spam",
    abuse: "Abuse",
  };

  const keyOf = (item: ModerationItem) => item.commentId ?? `post-${item.number}`;
  const reportsOf = (item: ModerationItem) =>
    Object.entries(item.reports) as [FlagReason, number][];
</script>

<div class="flex min-h-screen flex-col bg-surface-sunken text-text-default">
  <CommunityTopBar current="moderation" {viewerDisplayName} {onSignOut} />
  <main class="flex flex-col gap-16 px-32 py-24">
    <div class="flex items-baseline gap-12">
      <h1 class="text-2xl font-semibold">Moderation</h1>
      <span class="text-sm text-text-muted">{items.length} waiting</span>
    </div>
    {#if actionFailure !== null}
      <FailureNotice failure={actionFailure} subject="That decision" />
    {/if}
    {#if items.length === 0}
      <EmptyState title="Nothing Waiting">
        Held first contributions and reported posts appear here.
      </EmptyState>
    {:else}
      <ol class="flex flex-col gap-12">
        {#each items as item (keyOf(item))}
          <li class="flex flex-col gap-8 rounded-lg border border-border-default bg-surface-default p-16">
            <div class="flex flex-wrap items-center gap-8 text-xs text-text-subtle">
              <Badge variant={item.moderationState === "hidden" ? "warning" : "neutral"} caps>
                {item.moderationState === "hidden" ? "Hidden" : "Held"}
              </Badge>
              <span class="font-semibold text-text-muted">{item.target === "post" ? "Post" : "Comment"}</span>
              {#if item.heldReason !== null}
                <span>{HELD_LABELS[item.heldReason]}</span>
              {/if}
              {#each reportsOf(item) as [reason, count] (reason)}
                <span>{REPORT_LABELS[reason]} reported {count === 1 ? "once" : `${count} times`}</span>
              {/each}
              <span>{item.authorDisplayName}</span>
              <time datetime={item.createdAt}>{formatInstantDate(item.createdAt)}</time>
            </div>
            <a class="text-sm font-semibold hover:underline" href={boardPath(`/posts/${item.number}`, page.url.hostname)}>
              #{item.number} {item.postTitle}
            </a>
            <p class="text-sm whitespace-pre-line">{item.body}</p>
            <div class="flex gap-8">
              <Button size="sm" disabled={busyKey === keyOf(item)} onclick={() => onDecide?.(item, "publish")}>
                Publish
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busyKey === keyOf(item)}
                onclick={() => onDecide?.(item, "remove")}
              >
                Remove
              </Button>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </main>
</div>

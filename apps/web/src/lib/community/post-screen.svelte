<script lang="ts">
  /*
   * One request or question, opened. The vote count is a count and nothing more — there is no
   * voter list, because no read returns one. A reply from the Magna Carta team leads the thread and
   * wears the team mark. The author's own post and comments carry Delete, which is instant and
   * complete; there is no edit history to leave behind.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { toast } from "@magna-carta/design-system/toast";
  import Textarea from "@magna-carta/design-system/textarea";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Link from "@lucide/svelte/icons/link";
  import Flag from "@lucide/svelte/icons/flag";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import type { BoardCommentView, BoardPostView } from "@magna-carta/community/board-service";
  import { displayInitials } from "@magna-carta/community/display";
  import { DECLINE_REASON_LABELS, productAreaLabel, type DeclineReason } from "@magna-carta/community/vocabulary";
  import CommunityTopBar from "./community-top-bar.svelte";
  import VoteButton from "./vote-button.svelte";
  import { KIND_LABELS, communityStatusKey } from "./community-status.ts";
  import { boardPath } from "./board-paths.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import { page } from "$app/state";
  import type { FlagReason } from "@magna-carta/community/vocabulary";

  let {
    post,
    comments,
    viewerDisplayName,
    statusNote,
    canWrite = false,
    signInUrl = null,
    actionFailure = null,
    onSignOut,
    onVote,
    onComment,
    onDeletePost,
    onDeleteComment,
    onReport,
  }: {
    post: BoardPostView;
    comments: readonly BoardCommentView[];
    viewerDisplayName: string | null;
    /** The team's status line on its own reply ("Moved to Planned"). */
    statusNote: string | null;
    /** Whether the reader may vote, comment and report: a signed-in member, with the board open. */
    canWrite?: boolean;
    signInUrl?: string | null;
    /** The last action on this page that failed, shown above the comments. */
    actionFailure?: Failure | null;
    onSignOut?: () => void;
    onVote?: () => void;
    /** Resolves true when the comment was taken, so the draft can be cleared. */
    onComment?: (body: string) => Promise<boolean>;
    onDeletePost?: () => void;
    onDeleteComment?: (id: string) => void;
    onReport?: (reason: FlagReason, commentId?: string) => void;
  } = $props();

  const statusKey = $derived(communityStatusKey(post.status));
  let draft = $state("");
  let sending = $state(false);

  const REPORT_REASONS: readonly { reason: FlagReason; label: string }[] = [
    { reason: "confidential", label: "Client Detail" },
    { reason: "spam", label: "Spam" },
    { reason: "abuse", label: "Abuse" },
  ];

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(page.url.href);
      toast.success("Link copied.");
    } catch {
      toast.error("The link could not be copied. Copy it from the address bar.");
    }
  }

  async function sendComment(): Promise<void> {
    if (onComment === undefined) return;
    sending = true;
    const taken = await onComment(draft);
    sending = false;
    if (taken) draft = "";
  }
</script>

<div class="flex min-h-screen flex-col bg-surface-sunken text-text-default">
  <CommunityTopBar
    current={post.kind === "request" ? "requests" : "questions"}
    {viewerDisplayName}
    {signInUrl}
    {onSignOut}
  />
  <main class="flex flex-col gap-16 px-32 py-24">
    <nav aria-label="Breadcrumb" class="text-xs text-text-subtle">
      <a
        class="hover:underline"
        href={boardPath(post.kind === "request" ? "/" : "/questions", page.url.hostname)}
        >{post.kind === "request" ? "Feature Requests" : "Questions"}</a
      > / {productAreaLabel(post.category)} / #{post.number}
    </nav>
    <div class="flex items-start gap-24">
      <article class="flex min-w-0 flex-1 flex-col gap-16">
        <header class="flex items-start gap-16">
          {#if post.kind === "request"}
            <VoteButton
              size="large"
              voteCount={post.voteCount}
              firmVoteCount={post.firmVoteCount}
              voted={post.viewerHasVoted}
              disabled={!canWrite || post.moderationState !== "published"}
              onToggle={onVote}
            />
          {/if}
          <div class="flex flex-col gap-8">
            <h1 class="text-2xl font-semibold">{post.title}</h1>
            <div class="flex flex-wrap items-center gap-12 text-xs text-text-subtle">
              <Badge {...statusBadgeAttributes(statusKey)} caps>{statusEntry(statusKey).label}</Badge>
              <span class="font-semibold text-text-muted">{KIND_LABELS[post.kind]}</span>
              <span>{post.authorDisplayName}</span>
              <span>Posted <time datetime={post.createdAt}>{formatInstantDate(post.createdAt, { length: "long" })}</time></span>
            </div>
          </div>
        </header>

        <div class="flex flex-col gap-12 rounded-lg border border-border-default bg-surface-default p-20">
          {#each post.body.split("\n\n") as paragraph, index (index)}
            <p class="text-sm leading-relaxed">{paragraph}</p>
          {/each}
          <div class="flex items-center gap-4">
            <Button variant="ghost" size="sm" onclick={copyLink}
              ><Link class="size-16" aria-hidden="true" />Copy Link</Button
            >
            {#if canWrite && !post.isOwnPost}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger class={buttonClasses({ variant: "ghost", size: "sm" })}>
                  <Flag class="size-16" aria-hidden="true" />Report
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  {#each REPORT_REASONS as entry (entry.reason)}
                    <DropdownMenu.Item onSelect={() => onReport?.(entry.reason)}>{entry.label}</DropdownMenu.Item>
                  {/each}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            {/if}
            {#if post.isOwnPost}
              <Button variant="ghost" size="sm" class="ml-auto" onclick={onDeletePost}>
                <Trash2 class="size-16" aria-hidden="true" />Delete
              </Button>
            {/if}
          </div>
        </div>

        <section aria-label="Comments" class="flex flex-col gap-12">
          <h2 class="text-md font-semibold">{post.commentCount} {post.commentCount === 1 ? "Comment" : "Comments"}</h2>
          <ol class="flex flex-col gap-8">
            {#each comments as comment (comment.id)}
              <li
                class="flex gap-12 rounded-lg px-16 py-12 {comment.isTeamResponse
                  ? 'border border-accent-default bg-accent-subtle'
                  : 'border border-transparent'}"
              >
                <Avatar.Root>
                  <Avatar.Fallback>{displayInitials(comment.authorDisplayName)}</Avatar.Fallback>
                </Avatar.Root>
                <div class="flex min-w-0 flex-1 flex-col gap-4">
                  <div class="flex flex-wrap items-center gap-8 text-xs">
                    <span class="text-sm font-semibold">{comment.authorDisplayName}</span>
                    {#if comment.isTeamResponse}
                      <Badge variant="accent"><ShieldCheck class="size-12" aria-hidden="true" />Magna Carta Team</Badge>
                    {/if}
                    {#if comment.isAcceptedAnswer}
                      <Badge variant="success"><CircleCheck class="size-12" aria-hidden="true" />Accepted Answer</Badge>
                    {/if}
                    {#if comment.isTeamResponse && statusNote !== null}
                      <span class="text-text-muted">{statusNote}</span>
                    {/if}
                    <time class="text-text-subtle" datetime={comment.createdAt}>{formatInstantDate(comment.createdAt)}</time>
                    {#if comment.isOwnComment}
                      <Button variant="ghost" size="sm" class="ml-auto" onclick={() => onDeleteComment?.(comment.id)}>
                        <Trash2 class="size-16" aria-hidden="true" />Delete
                      </Button>
                    {:else if canWrite}
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger
                          class="{buttonClasses({ variant: 'ghost', size: 'sm' })} ml-auto"
                          aria-label="Report this comment"
                        >
                          <Flag class="size-16" aria-hidden="true" />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content>
                          {#each REPORT_REASONS as entry (entry.reason)}
                            <DropdownMenu.Item onSelect={() => onReport?.(entry.reason, comment.id)}
                              >{entry.label}</DropdownMenu.Item
                            >
                          {/each}
                        </DropdownMenu.Content>
                      </DropdownMenu.Root>
                    {/if}
                  </div>
                  <p class="text-sm">{comment.body}</p>
                </div>
              </li>
            {/each}
          </ol>
          {#if actionFailure !== null}
            <FailureNotice failure={actionFailure} subject="That" />
          {/if}
          {#if canWrite && post.moderationState === "published"}
            <LabelledField
              label="Comment"
              hint="About the software only. No client names, matter numbers, balances or screenshots."
            >
              {#snippet children({ props })}
                <Textarea {...props} bind:value={draft} disabled={sending} />
              {/snippet}
            </LabelledField>
            <div class="flex justify-end">
              <Button disabled={draft.trim() === "" || sending} onclick={sendComment}>Comment</Button>
            </div>
          {:else if viewerDisplayName === null && signInUrl !== null}
            <p class="text-sm text-text-muted">
              <a class="font-semibold text-text-link" href={signInUrl}>Sign in</a> with your Magna Carta account
              to comment or vote.
            </p>
          {/if}
        </section>
      </article>

      <aside class="flex w-2xs shrink-0 flex-col gap-12">
        <DefinitionList.Root>
          <DefinitionList.Row term="Status">
            <Badge {...statusBadgeAttributes(statusKey)} caps>{statusEntry(statusKey).label}</Badge>
          </DefinitionList.Row>
          <DefinitionList.Row term="Topic">{productAreaLabel(post.category)}</DefinitionList.Row>
          {#if post.kind === "request"}
            <DefinitionList.Row term="Votes">
              {#if post.voteCount === null}
                Fewer than five
              {:else}
                <span class="font-semibold tabular-nums">{post.voteCount}</span> from {post.firmVoteCount} firms
              {/if}
            </DefinitionList.Row>
          {/if}
          <DefinitionList.Row term="Number"><span class="tabular-nums">#{post.number}</span></DefinitionList.Row>
          {#if post.declineReason !== null}
            <DefinitionList.Row term="Why Not">
              {DECLINE_REASON_LABELS[post.declineReason as DeclineReason]}
              {#if post.declineNote !== null}<span class="block text-text-muted">{post.declineNote}</span>{/if}
            </DefinitionList.Row>
          {/if}
          {#if post.kind === "request"}
            <DefinitionList.Row term="Shipped In" empty={post.linkedChangelogAnchor === null}>
              {post.linkedChangelogAnchor}
            </DefinitionList.Row>
          {/if}
        </DefinitionList.Root>
        <p class="px-4 text-xs text-text-subtle">
          Voters are never listed, and no firm is ever shown.
        </p>
      </aside>
    </div>
  </main>
</div>

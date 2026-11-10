<script lang="ts">
  /*
   * One request or question, opened. The vote count is a count and nothing more — there is no
   * voter list, because no read returns one. A reply from the Magna Carta team leads the thread and
   * wears the team mark. The author's own post and comments carry Delete, which is instant and
   * complete; there is no edit history to leave behind.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Textarea from "@magna-carta/design-system/textarea";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Bell from "@lucide/svelte/icons/bell";
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

  let {
    post,
    comments,
    viewerDisplayName,
    statusNote,
  }: {
    post: BoardPostView;
    comments: readonly BoardCommentView[];
    viewerDisplayName: string | null;
    /** The team's status line on its own reply ("Moved to Planned"). */
    statusNote: string | null;
  } = $props();

  const statusKey = $derived(communityStatusKey(post.status));
  let draft = $state("");
</script>

<div class="flex min-h-screen flex-col bg-surface-sunken text-text-default">
  <CommunityTopBar current={post.kind === "request" ? "requests" : "questions"} {viewerDisplayName} />
  <main class="flex flex-col gap-16 px-32 py-24">
    <nav aria-label="Breadcrumb" class="text-xs text-text-subtle">
      {post.kind === "request" ? "Feature Requests" : "Questions"} / {productAreaLabel(post.category)} / #{post.number}
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
            <Button variant="ghost" size="sm"><Bell class="size-16" aria-hidden="true" />Following</Button>
            <Button variant="ghost" size="sm"><Link class="size-16" aria-hidden="true" />Copy Link</Button>
            <Button variant="ghost" size="sm"><Flag class="size-16" aria-hidden="true" />Report</Button>
            {#if post.isOwnPost}
              <Button variant="ghost" size="sm" class="ml-auto">
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
                      <Button variant="ghost" size="sm" class="ml-auto">
                        <Trash2 class="size-16" aria-hidden="true" />Delete
                      </Button>
                    {/if}
                  </div>
                  <p class="text-sm">{comment.body}</p>
                </div>
              </li>
            {/each}
          </ol>
          <LabelledField
            label="Comment"
            hint="About the software only. No client names, matter numbers, balances or screenshots."
          >
            {#snippet children({ props })}
              <Textarea {...props} bind:value={draft} />
            {/snippet}
          </LabelledField>
          <div class="flex justify-end">
            <Button disabled={draft.trim() === ""}>Comment</Button>
          </div>
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
          Voters are never listed. When the status changes you get an email with a link; the email never
          quotes the post.
        </p>
      </aside>
    </div>
  </main>
</div>

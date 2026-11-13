<script lang="ts">
  /*
   * One post on the board, live. Every action re-reads the post afterwards rather than guessing
   * at the result, because the board decides what a reader sees (a held comment is visible to its
   * author alone, a confidentiality report hides at once).
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { toast } from "@magna-carta/design-system/toast";
  import type { BoardCommentView, BoardPostView } from "@magna-carta/community/board-service";
  import type { FlagReason } from "@magna-carta/community/vocabulary";
  import type { Failure } from "$lib/api/problem.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import PostScreen from "$lib/community/post-screen.svelte";
  import CommunityTopBar from "$lib/community/community-top-bar.svelte";
  import { boardPath } from "$lib/community/board-paths.ts";
  import { boardSession } from "$lib/community/board-session.svelte.ts";
  import {
    addComment,
    castVote,
    deleteComment,
    deletePost,
    readPost,
    report,
  } from "$lib/community/board-client.ts";

  const board = boardSession();
  const number = $derived(Number(page.params.number));

  let post: BoardPostView | null = $state(null);
  let comments: BoardCommentView[] = $state([]);
  let loadFailure: Failure | null = $state(null);
  let actionFailure: Failure | null = $state(null);

  async function load(): Promise<void> {
    const outcome = await readPost(number);
    if (outcome.kind === "ok") {
      post = outcome.value.post;
      comments = outcome.value.comments;
      loadFailure = null;
    } else {
      loadFailure = outcome.failure;
    }
  }

  $effect(() => {
    void number;
    void board.session?.signedIn;
    void load();
  });

  const canWrite = $derived(board.session?.canWrite === true);

  async function act(outcome: Promise<{ kind: string; failure?: Failure }>): Promise<boolean> {
    const result = await outcome;
    if (result.kind !== "ok") {
      actionFailure = result.failure ?? null;
      return false;
    }
    actionFailure = null;
    await load();
    return true;
  }

  async function comment(body: string): Promise<boolean> {
    const outcome = await addComment(number, body);
    if (outcome.kind !== "ok") {
      actionFailure = outcome.failure;
      return false;
    }
    actionFailure = null;
    if (outcome.value.moderationState === "held") {
      toast.success("Posted. Only you can see it until the Magna Carta team has read it.");
    }
    await load();
    return true;
  }

  async function removePost(): Promise<void> {
    if (await act(deletePost(number))) {
      toast.success("Your post is deleted.");
      void goto(boardPath(post?.kind === "question" ? "/questions" : "/", page.url.hostname));
    }
  }

  async function flag(reason: FlagReason, commentId?: string): Promise<void> {
    if (await act(report(number, reason, commentId))) {
      toast.success("Reported. The Magna Carta team will read it.");
    }
  }
</script>

<svelte:head>
  <title>{post === null ? "Post" : post.title} · Magna Carta Community</title>
</svelte:head>

{#if post !== null}
  <PostScreen
    {post}
    {comments}
    viewerDisplayName={board.viewerDisplayName}
    statusNote={null}
    {canWrite}
    signInUrl={board.session?.signInUrl ?? null}
    {actionFailure}
    onSignOut={board.session?.signedIn === true ? () => void board.signOut() : undefined}
    onVote={() => {
      if (post !== null) void act(castVote(number, !post.viewerHasVoted));
    }}
    onComment={comment}
    onDeletePost={() => void removePost()}
    onDeleteComment={(id) => void act(deleteComment(id))}
    onReport={(reason, commentId) => void flag(reason, commentId)}
  />
{:else if loadFailure !== null}
  <div class="flex min-h-screen flex-col bg-surface-sunken">
    <CommunityTopBar current={null} viewerDisplayName={board.viewerDisplayName} signInUrl={board.session?.signInUrl ?? null} />
    <main class="px-32 py-24">
      <FailureNotice failure={loadFailure} subject="This post" onRetry={() => void load()} />
    </main>
  </div>
{/if}

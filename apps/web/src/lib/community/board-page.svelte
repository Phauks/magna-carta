<script lang="ts">
  /*
   * The board's home for one kind of post, live: the list as the reader has filtered it, the
   * summary beside it, voting, and the composer. Requests and questions are the same page.
   *
   * A reader who is not signed in sees everything and is sent to sign in when they reach for a
   * write. A member's first post saves their display name first, because the board refuses a post
   * from someone with no board name, and the name they see in the composer is the one it will carry.
   */
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { toast } from "@magna-carta/design-system/toast";
  import type { BoardPostView, BoardSummary } from "@magna-carta/community/board-service";
  import { ROADMAP_COLUMNS, type PostKind, type SortOrder } from "@magna-carta/community/vocabulary";
  import type { Failure } from "$lib/api/problem.ts";
  import BoardScreen from "./board-screen.svelte";
  import ComposerDialog from "./composer-dialog.svelte";
  import { boardPath } from "./board-paths.ts";
  import { boardSession } from "./board-session.svelte.ts";
  import {
    castVote,
    createPost,
    dismissNotice,
    readBoard,
    readSummary,
    saveDisplayName,
  } from "./board-client.ts";

  let { kind }: { kind: PostKind } = $props();

  const board = boardSession();

  const PAGE_SIZE = 50;
  // What each status choice reads. "Open" is everything not yet finished or turned down.
  const STATUS_SETS: Record<string, readonly string[]> = {
    open: ["new", "future", "planned", "building-now", "beta"],
    all: [],
    completed: ["completed"],
    "not-on-the-roadmap": ["not-on-the-roadmap"],
  };

  let selectedArea: string | null = $state(null);
  let sort: SortOrder = $state("trending");
  let search = $state("");
  let statusFilter = $state("open");

  let posts: BoardPostView[] = $state([]);
  let total = $state(0);
  let listFailure: Failure | null = $state(null);
  const EMPTY_SUMMARY: BoardSummary = {
    requestsByArea: {},
    questionsByArea: {},
    roadmap: Object.fromEntries(ROADMAP_COLUMNS.map((column) => [column, 0])) as BoardSummary["roadmap"],
  };
  let summary: BoardSummary = $state(EMPTY_SUMMARY);

  let composerOpen = $state(false);
  let composerKind: PostKind = $state(untrack(() => kind));
  let composerCategory: string | null = $state(null);
  let composerTitle = $state("");
  let composerBody = $state("");
  let composerName = $state("");
  let composerNoticeDismissed = $state(false);
  let composerFailure: Failure | null = $state(null);

  const canWrite = $derived(board.session?.canWrite === true);
  const signInUrl = $derived(board.session?.signInUrl ?? null);

  async function loadList(signal?: AbortSignal): Promise<void> {
    const outcome = await readBoard(
      {
        kind,
        category: selectedArea,
        statuses: kind === "request" ? (STATUS_SETS[statusFilter] ?? []) : [],
        search,
        sort,
        limit: PAGE_SIZE,
        offset: 0,
      },
      signal,
    );
    if (signal?.aborted === true) return;
    if (outcome.kind === "ok") {
      posts = outcome.value.posts;
      total = outcome.value.total;
      listFailure = null;
    } else {
      listFailure = outcome.failure;
    }
  }

  // Re-read whenever a filter changes; a search waits for the reader to pause.
  $effect(() => {
    const searching = search;
    void [kind, selectedArea, sort, statusFilter];
    const controller = new AbortController();
    const timer = setTimeout(() => void loadList(controller.signal), searching === "" ? 0 : 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  $effect(() => {
    void readSummary().then((outcome) => {
      if (outcome.kind === "ok") summary = outcome.value;
    });
  });

  function compose(): void {
    if (!canWrite) {
      if (signInUrl !== null && board.session?.signedIn !== true) window.location.assign(signInUrl);
      else if (board.session?.signedIn === true)
        toast.error("Only people at a firm that uses Magna Carta can post.");
      return;
    }
    const profile = board.session?.profile ?? null;
    composerKind = kind;
    composerName = profile?.displayName ?? profile?.suggestedDisplayName ?? "";
    composerNoticeDismissed = profile?.noticeDismissed ?? false;
    composerFailure = null;
    composerOpen = true;
  }

  async function rename(name: string): Promise<string | null> {
    const outcome = await saveDisplayName(name);
    if (outcome.kind !== "ok") return "That name could not be saved. Try again.";
    await board.refresh();
    return null;
  }

  async function post(): Promise<ActionOutcome> {
    if (composerCategory === null) return "refused";
    const profile = board.session?.profile ?? null;
    if (profile !== null && profile.displayName === null) {
      const saved = await saveDisplayName(composerName);
      if (saved.kind !== "ok") {
        composerFailure = saved.failure;
        return "refused";
      }
    }
    if (composerNoticeDismissed && profile !== null && !profile.noticeDismissed) {
      void dismissNotice();
    }
    const outcome = await createPost({
      kind: composerKind,
      category: composerCategory,
      title: composerTitle,
      body: composerBody,
    });
    if (outcome.kind !== "ok") {
      composerFailure = outcome.failure;
      return "refused";
    }
    toast.success(
      outcome.value.moderationState === "held"
        ? "Posted. Only you can see it until the Magna Carta team has read it."
        : "Posted.",
    );
    composerTitle = "";
    composerBody = "";
    composerCategory = null;
    void board.refresh();
    void goto(boardPath(`/posts/${outcome.value.number}`, page.url.hostname));
    return "committed";
  }

  async function vote(target: BoardPostView): Promise<void> {
    if (!canWrite) {
      if (signInUrl !== null && board.session?.signedIn !== true) window.location.assign(signInUrl);
      return;
    }
    const outcome = await castVote(target.number, !target.viewerHasVoted);
    if (outcome.kind !== "ok") {
      listFailure = outcome.failure;
      return;
    }
    posts = posts.map((entry) =>
      entry.number === target.number
        ? { ...entry, voteCount: outcome.value.voteCount, viewerHasVoted: outcome.value.viewerHasVoted }
        : entry,
    );
  }

  async function leave(): Promise<void> {
    const failure = await board.signOut();
    if (failure !== null) listFailure = failure;
  }
</script>

<BoardScreen
  {kind}
  {posts}
  {total}
  {summary}
  knownIssue={null}
  viewerDisplayName={board.viewerDisplayName}
  {signInUrl}
  failure={listFailure}
  bind:selectedArea
  bind:sort
  bind:search
  bind:statusFilter
  onCompose={compose}
  onVote={(target) => void vote(target)}
  onSignOut={board.session?.signedIn === true ? () => void leave() : undefined}
  onRetry={() => void loadList()}
/>
<ComposerDialog
  bind:open={composerOpen}
  bind:kind={composerKind}
  bind:category={composerCategory}
  bind:title={composerTitle}
  bind:body={composerBody}
  bind:displayName={composerName}
  bind:noticeDismissed={composerNoticeDismissed}
  failure={composerFailure}
  onRenameDisplayName={rename}
  onPost={post}
/>

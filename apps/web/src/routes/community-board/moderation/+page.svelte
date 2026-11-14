<script lang="ts">
  /*
   * The team's moderation queue, live. Each decision re-reads the queue rather than dropping the
   * item locally, because publishing a first post also approves its author and can clear more than
   * the one item pressed.
   */
  import { toast } from "@magna-carta/design-system/toast";
  import type { ModerationItem } from "@magna-carta/community/board-service";
  import type { Failure } from "$lib/api/problem.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import CommunityTopBar from "$lib/community/community-top-bar.svelte";
  import ModerationScreen from "$lib/community/moderation-screen.svelte";
  import { boardSession } from "$lib/community/board-session.svelte.ts";
  import { moderate, readModerationQueue } from "$lib/community/board-client.ts";

  const board = boardSession();

  let items: ModerationItem[] | null = $state(null);
  let loadFailure: Failure | null = $state(null);
  let actionFailure: Failure | null = $state(null);
  let busyKey: string | null = $state(null);

  async function load(): Promise<void> {
    const outcome = await readModerationQueue();
    if (outcome.kind === "ok") {
      items = outcome.value.items;
      loadFailure = null;
    } else {
      loadFailure = outcome.failure;
    }
  }

  $effect(() => {
    void board.session?.signedIn;
    void load();
  });

  async function decide(item: ModerationItem, decision: "publish" | "remove"): Promise<void> {
    busyKey = item.commentId ?? `post-${item.number}`;
    const outcome = await moderate(item.number, decision, item.commentId ?? undefined);
    busyKey = null;
    if (outcome.kind !== "ok") {
      actionFailure = outcome.failure;
      return;
    }
    actionFailure = null;
    toast.success(decision === "publish" ? "Published." : "Removed.");
    await load();
  }
</script>

<svelte:head>
  <title>Moderation · Magna Carta Community</title>
</svelte:head>

{#if items !== null}
  <ModerationScreen
    {items}
    viewerDisplayName={board.viewerDisplayName}
    {actionFailure}
    {busyKey}
    onSignOut={board.session?.signedIn === true ? () => void board.signOut() : undefined}
    onDecide={(item, decision) => void decide(item, decision)}
  />
{:else if loadFailure !== null}
  <div class="flex min-h-screen flex-col bg-surface-sunken">
    <CommunityTopBar current="moderation" viewerDisplayName={board.viewerDisplayName} signInUrl={board.session?.signInUrl ?? null} />
    <main class="px-32 py-24">
      <FailureNotice failure={loadFailure} subject="The moderation queue" onRetry={() => void load()} />
    </main>
  </div>
{/if}

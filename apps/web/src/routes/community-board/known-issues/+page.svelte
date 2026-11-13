<script lang="ts">
  import type { Failure } from "$lib/api/problem.ts";
  import KnownIssuesScreen from "$lib/community/known-issues-screen.svelte";
  import { boardSession } from "$lib/community/board-session.svelte.ts";
  import { readKnownIssues, type KnownIssue } from "$lib/community/board-client.ts";

  const board = boardSession();

  let issues: KnownIssue[] = $state([]);
  let statusPageUrl = $state("https://status.magnacarta.esq");
  let failure: Failure | null = $state(null);

  async function load(): Promise<void> {
    const outcome = await readKnownIssues();
    if (outcome.kind === "ok") {
      issues = outcome.value.issues;
      statusPageUrl = outcome.value.statusPageUrl;
      failure = null;
    } else {
      failure = outcome.failure;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<svelte:head>
  <title>Known Issues · Magna Carta Community</title>
</svelte:head>

<KnownIssuesScreen
  {issues}
  {statusPageUrl}
  {failure}
  viewerDisplayName={board.viewerDisplayName}
  signInUrl={board.session?.signInUrl ?? null}
  onRetry={() => void load()}
  onSignOut={board.session?.signedIn === true ? () => void board.signOut() : undefined}
/>

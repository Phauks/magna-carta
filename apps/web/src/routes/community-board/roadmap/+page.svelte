<script lang="ts">
  /*
   * The roadmap, live: one read of the board per column, most-voted first. A column shows its first
   * fifty requests and says how many it holds.
   */
  import type { BoardPostView } from "@magna-carta/community/board-service";
  import { ROADMAP_COLUMNS } from "@magna-carta/community/vocabulary";
  import type { Failure } from "$lib/api/problem.ts";
  import RoadmapScreen from "$lib/community/roadmap-screen.svelte";
  import { boardSession } from "$lib/community/board-session.svelte.ts";
  import { readBoard } from "$lib/community/board-client.ts";

  type Column = (typeof ROADMAP_COLUMNS)[number];
  type Columns = Record<Column, { posts: BoardPostView[]; total: number }>;

  const board = boardSession();
  const EMPTY = Object.fromEntries(ROADMAP_COLUMNS.map((column) => [column, { posts: [], total: 0 }])) as unknown as Columns;

  let columns: Columns = $state(EMPTY);
  let failure: Failure | null = $state(null);

  async function load(): Promise<void> {
    const outcomes = await Promise.all(
      ROADMAP_COLUMNS.map((column) =>
        readBoard({ kind: "request", category: null, statuses: [column], search: "", sort: "top", limit: 50, offset: 0 }),
      ),
    );
    for (const outcome of outcomes) {
      if (outcome.kind !== "ok") {
        failure = outcome.failure;
        return;
      }
    }
    failure = null;
    columns = Object.fromEntries(
      ROADMAP_COLUMNS.map((column, index) => {
        const outcome = outcomes[index];
        return [column, outcome?.kind === "ok" ? outcome.value : { posts: [], total: 0 }];
      }),
    ) as unknown as Columns;
  }

  $effect(() => {
    void board.session?.signedIn;
    void load();
  });
</script>

<svelte:head>
  <title>Roadmap · Magna Carta Community</title>
</svelte:head>

<RoadmapScreen
  {columns}
  {failure}
  viewerDisplayName={board.viewerDisplayName}
  signInUrl={board.session?.signInUrl ?? null}
  onRetry={() => void load()}
  onSignOut={board.session?.signedIn === true ? () => void board.signOut() : undefined}
/>

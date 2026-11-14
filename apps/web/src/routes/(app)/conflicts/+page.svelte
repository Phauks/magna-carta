<script lang="ts">
  /*
   * Conflicts Check — the firm's log of every check it has run, and the one place a new one is
   * asked for.
   *
   * THE SCREEN IS THE HISTORY (owner's direction, 2026-09-08). A conflicts check is a
   * professional-responsibility act, and what a firm has to produce months later is the RECORD of
   * those acts: what was searched, when, by whom, how wide, and how many candidates came back. So
   * this is the List archetype — one table at the full width, narrowed from its own column headers
   * — and running a check is the create act performed over it, reached from New Check at the end of
   * the header's action row and asked for in the product's one panel for asking.
   *
   * WHAT IT REPLACED, AND WHY. The screen used to open on the composer: a matter picker, then the
   * whole scope form, then the log below the fold. That put a form almost nobody was filling in
   * that visit in front of the record almost everybody came for, and it made the run control
   * something a reader scrolled to rather than reached for. The form is unchanged; it moved into
   * the panel (new-check-dialog.svelte), which is also what let a matter's own section stop
   * carrying a second copy of it.
   *
   * THIS IS THE FIRM-WIDE SURFACE. It lists every check across every matter and answers "what has
   * the firm done". What ONE matter's record says is the matter's own business and lives in its
   * Conflicts section — the two are separate for the same reason the sidebar and the matter's
   * section strip are separate.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { goto } from "$app/navigation";
  import CheckRegister from "$lib/conflicts/check-register.svelte";
  import NewCheckDialog from "$lib/conflicts/new-check-dialog.svelte";
  import { RUN_CHECK_PERMISSION, type ConflictsCheckSummary } from "$lib/conflicts/conflicts-api.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  let session = $state<SessionBootstrap | null>(null);
  let bootstrapped = false;
  let composerOpen = $state(false);
  let grid = $state<DataTable.DataTableGridState<ConflictsCheckSummary> | null>(null);
  let rereadLog = $state<() => void>(() => {});
  /*
   * What the log is being asked. `searchText` is the field's and `appliedSearch` is what the
   * register was last asked for — ScreenSearch owns the pause between them, so one query leaves the
   * machine per thought.
   *
   * It goes to the SERVER, not over the rows in hand: the log is paged and only grows, so narrowing
   * the page that happened to arrive would answer "of the fifty I have read, which match" — and the
   * question this screen exists for, "has this firm ever checked this person", is worth nothing if
   * it can only see the most recent fifty runs.
   */
  let searchText = $state("");
  let appliedSearch = $state("");

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  const permissions = $derived(session?.permissions ?? null);
  const mayRun = $derived(permissions === null || permissions.includes(RUN_CHECK_PERMISSION));

  /*
   * Why the control cannot be pressed, or undefined while it can. It never leaves the row: a
   * control that vanished would tell a reader nothing about why, and a member refused server-side
   * should learn that here rather than at the commit.
   */
  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!mayRun) return permissionRefusal("Running a check", RUN_CHECK_PERMISSION);
    return undefined;
  });

  /*
   * A check that has just been written goes straight to what it found — the next thing anybody does
   * with a check is read it — and the log behind is read again so the row is there when the reader
   * comes back to it.
   */
  function onRan(checkId: string): void {
    rereadLog();
    void goto(`/conflicts/checks/${checkId}`);
  }
</script>

<svelte:head>
  <title>Conflicts Check · Magna Carta</title>
</svelte:head>

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Conflicts Check">
    {#snippet actions()}
      <!-- The search leads the row and grows toward the inline start, so New Check never moves when
           it opens — the same order as every other Workspace screen. It reaches the matter a run was
           made against and the names the run surfaced; the closed labels (what set it going, who
           asked, the strictness) are narrowed from the table's own column headers, which match them
           exactly rather than by substring. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the log"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <CreateControl
        noun="Check"
        title="Run a conflicts check. It writes a new entry in the firm's log."
        refusal={createRefusal}
        onpress={() => (composerOpen = true)}
      />
      <DataTable.ClearFilters grid={grid ?? undefined} />
    {/snippet}
  </ScreenHeader>

  {#if session !== null && !mayRun}
    <Alert.Root variant="info">
      <Alert.Title>This Account Can't Run Checks</Alert.Title>
      <Alert.Description>
        {permissionRefusal("Running a check", RUN_CHECK_PERMISSION)} Reading the log is a separate
        permission, and this account has it.
      </Alert.Description>
    </Alert.Root>
  {/if}

  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-16">
    <CheckRegister
      bind:grid
      bind:reread={rereadLog}
      search={appliedSearch}
      caption="All conflicts checks this firm has run"
      emptyTitle="No Checks Run Yet"
      onOpenCheck={(checkId) => void goto(`/conflicts/checks/${checkId}`)}
    >
      {#snippet emptyBody()}
        A check searches the parties you give it against the firm's records and logs what it searched, including what it couldn't search. Use New Check to run the first one.
      {/snippet}
      {#snippet emptyActions()}
        <Button
          variant="primary"
          disabled={createRefusal !== undefined}
          title={createRefusal}
          onclick={() => (composerOpen = true)}
        >
          New Check
        </Button>
      {/snippet}
    </CheckRegister>
  </div>
</div>

<NewCheckDialog bind:open={composerOpen} {permissions} {onRan} />

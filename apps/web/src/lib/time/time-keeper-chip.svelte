<script lang="ts">
  /*
   * THE TIME KEEPER — the firm's Time Sheet, in the top bar, over whatever you were doing.
   *
   * The owner's ruling is that the Time Sheet is firm-wide and lives here: capture never forces a
   * navigation, and the canvas behind stays exactly where it was. So this is the chip's whole job —
   * say what the firm's timer is doing, and open the sheet. The sheet itself is one component with
   * two doors, and this is the door that assumes no matter at all.
   *
   * WHAT IT READS, AND WHEN. At rest it reads one thing: the timekeeper's own timer, which is a
   * single row and answers whether anything is running. The firm's time and the firm's roster are
   * read the first time the sheet is opened and not before, because a person who never opens the
   * sheet on a page should not pay for a listing they will not look at.
   *
   * THE ELAPSED FIGURE IS THE CLIENT'S ARITHMETIC. The read answers when the current run began and
   * the chip counts forward from it; nothing is polled to make a clock tick. The read is taken
   * again whenever the sheet has been used, because that is where a run gets started or stopped and
   * a chip counting from a stale start is a chip stating a figure nobody has.
   *
   * THE COUNT OF UNFINISHED ROWS APPEARS ONCE THE SHEET HAS BEEN OPENED, and not before, for the
   * same reason: a badge is not worth a firm-wide read on every page, and a badge that guessed
   * would be worse than no badge.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import Timer from "@lucide/svelte/icons/timer";
  import { readSession } from "$lib/matters/matters-api.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import TimeSheet from "./time-sheet.svelte";
  import { listTimeEntries, readTimer } from "./time-operations.ts";
  import { clockText, incompleteCount, sheetRowFromEntry } from "./time-sheet-model.ts";

  let sheetOpen = $state(false);
  /** Bumped whenever the sheet wrote something, so the firm's time is read again. */
  let reloadToken = $state(0);
  /** Whether the sheet has ever been opened. Nothing firm-wide is read until it has. */
  let everOpened = $state(false);
  let sessionUserId = $state<string | null>(null);

  const list = new PagedList<TimeEntrySummary>("The firm's time could not be read.");
  const entries = $derived(list.items ?? []);

  /* The run in hand: when the current segment began, or null while nothing is running. */
  let runStartedAt = $state<number | null>(null);
  /* Re-read every second so a running clock re-renders and nothing else does. */
  let tick = $state(0);

  async function readTheTimer(): Promise<void> {
    const outcome = await readTimer(fetch);
    if (outcome.kind !== "ok") return;
    const state = outcome.value;
    runStartedAt =
      state.status === "running" && state.startedAt !== null ? Date.parse(state.startedAt) : null;
  }

  /*
   * One read on arrival, and another whenever the sheet has been opened, closed or written to,
   * because that is where a run gets started or stopped. Nothing polls: a chip that asked the
   * server every second to draw a clock would be paying for arithmetic it can do itself.
   */
  $effect(() => {
    void reloadToken;
    void sheetOpen;
    void readTheTimer();
  });

  $effect(() => {
    if (runStartedAt === null) return;
    const handle = setInterval(() => (tick += 1), 1000);
    return () => clearInterval(handle);
  });

  /* The firm's time, its roster and who is asking: read the first time the sheet is opened. */
  $effect(() => {
    if (!sheetOpen) return;
    everOpened = true;
    void firmRoster.load(fetch);
    void (async () => {
      if (sessionUserId !== null) return;
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") sessionUserId = outcome.value.user.id;
    })();
  });

  $effect(() => {
    if (!everOpened) return;
    const token = reloadToken;
    if (list.showing(`firm:${String(token)}`)) return;
    list.reset(`firm:${String(token)}`);
    void list.load((cursor) => listTimeEntries(fetch, cursor === undefined ? {} : { cursor }));
  });

  const elapsedSeconds = $derived.by((): number => {
    void tick;
    if (runStartedAt === null) return 0;
    return Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000));
  });

  const running = $derived(runStartedAt !== null);
  const readout = $derived(running ? clockText(elapsedSeconds, false) : "0:00");

  /** Rows on the firm's record that are still short of something, once anything has been read. */
  const unfinished = $derived(
    list.items === null ? null : incompleteCount(entries.map(sheetRowFromEntry)),
  );

  const chipTitle = $derived(
    running
      ? "A timer is running. Open the Time Sheet, over whatever you are doing."
      : "Open the Time Sheet, over whatever you are doing.",
  );
</script>

<Tooltip.Root>
  <Tooltip.Trigger
    class="mc-top-bar-icon-button gap-8 border text-xs tabular-nums"
    style="border-color: var(--mc-chrome-border)"
    aria-label="Time Keeper"
    aria-haspopup="dialog"
    aria-expanded={sheetOpen}
    onclick={() => (sheetOpen = true)}
  >
    <Timer class="size-16" aria-hidden="true" />
    <span class={running ? "text-chrome-text-strong" : undefined}>{readout}</span>
    {#if unfinished !== null && unfinished > 0}
      <!-- The count of rows the firm has saved and nobody has finished. It sits in the chrome's own
           accent rather than a status colour: this is an edge, and the work surface is where the
           rows themselves say what they are short of. -->
      <span class="text-chrome-accent">
        {unfinished}
        <span class="sr-only">
          {unfinished === 1 ? "row is" : "rows are"} still short of a matter, a description or a duration
        </span>
      </span>
    {/if}
  </Tooltip.Trigger>
  <Tooltip.Content>{chipTitle}</Tooltip.Content>
</Tooltip.Root>

<TimeSheet
  bind:open={sheetOpen}
  {entries}
  members={firmRoster.members ?? []}
  {sessionUserId}
  loading={list.items === null}
  readFailure={list.failure}
  onRetryRead={() => (reloadToken += 1)}
  onChanged={() => (reloadToken += 1)}
/>

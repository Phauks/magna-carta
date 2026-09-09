<script lang="ts">
  /*
   * The one calendar. A host writes this tag with a scope and gets the reads, the window arithmetic,
   * the view state, the toolbar and the window an entry opens in; it writes no calendar code of its
   * own. The firm screen embeds it with the firm scope, the matter section with a matter scope and
   * no toolbar, and the dashboard's card will embed it narrower still.
   *
   * THE GRID HOLDS ITS SHAPE. It takes the remaining height and keeps it: a month with nothing in
   * it is the same grid, empty, with its statement in the caption region; a month still loading is
   * the same grid with placeholder lines. A read that failed leaves the grid standing and puts a
   * notice above it naming which read failed, with the Error ID and Retry, because a firm whose
   * deadline read errored still needs to see its hearings.
   *
   * ACTIVATING A CHIP OPENS THE WINDOW; THE ADDRESS CAN TOO. A chip on the grid remembers what it
   * painted, so the window reads the one record pressed. An address carrying `entry=` opens the
   * same window on arrival, which is the deep link the federated read emits. A deadline reached
   * that way is looked for among the chips on screen first, because it can only be read through
   * the matter and the day the chip knows.
   */
  import { onMount, untrack } from "svelte";
  import { afterNavigate, goto } from "$app/navigation";
  import * as CalendarGrid from "@magna-carta/design-system/calendar-grid";
  import type { CalendarGridEntry } from "@magna-carta/design-system/calendar-grid";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { calendarContext } from "./calendar-context.svelte.ts";
  import { CalendarController } from "./calendar-controller.svelte.ts";
  import { entryId } from "./calendar-entries.ts";
  import { describeReadFailure, readFailureTitle } from "./calendar-reads.ts";
  import {
    calendarLabel,
    emptyCalendarMessage,
    whoseCalendar,
    type CalendarScope,
  } from "./calendar-scope.ts";
  import CalendarToolbar from "./calendar-toolbar.svelte";
  import {
    AGENDA_SPAN_DAYS,
    restOfCalendarAddress,
    todayCivil,
    type CalendarView as CalendarViewKind,
  } from "./calendar-window.ts";
  import EntryWindow from "./entry-window.svelte";
  import {
    entryReferenceFromIdentifier,
    entryReferenceOf,
    type EntryReference,
  } from "./entry-reference.ts";

  let {
    scope,
    view = $bindable("month"),
    anchor = $bindable(todayCivil()),
    toolbar = true,
    address = false,
    openEntry = null,
    refreshToken = 0,
    viewSwitch = true,
    agendaDays = AGENDA_SPAN_DAYS,
    limit = null,
    class: className,
  }: {
    /** What this calendar is a calendar of: the firm, one member's own day, or one matter. */
    scope: CalendarScope;
    /** Month, week or agenda. Bindable. */
    view?: CalendarViewKind;
    /** The civil date (`YYYY-MM-DD`) the window is anchored on. Bindable. */
    anchor?: string;
    /** Whether the action row (scope, view, navigation) is drawn. A host with its own row passes false. */
    toolbar?: boolean;
    /** Whether view, date and scope are mirrored into the page's query string. */
    address?: boolean;
    /** An entry identifier from the address to open on arrival: `matterEvent_…`, `matterDeadline_…`, `firmEvent_…`. */
    openEntry?: string | null;
    /** A host bumps this after recording something, and the window is read again. */
    refreshToken?: number;
    /** Whether the toolbar carries the month / week / agenda switch. A host with its own switch passes false and keeps the navigation. */
    viewSwitch?: boolean;
    /** How many days the agenda spans from its anchor. A fortnight by default; a card on Home passes two, a matter overview thirty. */
    agendaDays?: number;
    /**
     * At most this many entries are painted, and a line says how many more are on the calendar,
     * linking to it. For an embedded card; the full screens pass nothing and paint the window.
     */
    limit?: number | null;
    class?: string;
  } = $props();

  const context = calendarContext;

  const controller = new CalendarController({
    scope: () => scope,
    view: () => view,
    setView: (next) => (view = next),
    anchor: () => anchor,
    setAnchor: (next) => (anchor = next),
    address: () => address,
    // The firm's own week, read once with the rest of the context: two members of one firm looking
    // at the same week see the same columns.
    weekStartsOn: () => context.weekStartsOn,
    agendaDays: () => agendaDays,
    memberId: () => context.memberId,
    context: () => context.entryContext,
    contextReady: () => context.ready,
  });

  $effect(() => {
    void context.load(fetch);
  });

  /*
   * A host that changes the KIND of its scope (a screen that learns the session and moves from the
   * firm to the reader's own calendar) moves the toggle with it. The kind is read through a derived
   * so a host re-creating the same scope object does not reset a choice the reader made.
   */
  const hostScopeKind = $derived(scope.kind);
  let seenScopeKind = untrack(() => hostScopeKind);
  $effect(() => {
    const kind = hostScopeKind;
    // On a CHANGE only: the controller has already read the address on start, and re-applying the
    // host's kind on mount would overwrite what the address said.
    if (kind === seenScopeKind) return;
    seenScopeKind = kind;
    untrack(() => {
      if (kind === "mine") controller.chooseScope("mine");
      if (kind === "firm") controller.chooseScope("everyone");
    });
  });

  // A fresh read whenever what the read depends on changes; the key states those dependencies.
  $effect(() => {
    void controller.readKey;
    untrack(() => void controller.read(fetch, "fresh"));
  });

  // The same window again, keeping what is on screen, when the host says something was written.
  let seenToken = untrack(() => refreshToken);
  $effect(() => {
    const token = refreshToken;
    if (token === seenToken) return;
    seenToken = token;
    untrack(() => void controller.read(fetch, "refresh"));
  });

  /*
   * The address is mirrored only once the router has finished its first navigation. SvelteKit's
   * `replaceState` reaches into the router, and an effect that runs during hydration runs before
   * the router exists: the call throws, and the throw takes the rest of the flush with it, which
   * is how the grid was left loading forever.
   */
  let navigated = $state(false);
  afterNavigate(() => {
    navigated = true;
  });
  // A component mounted AFTER the first navigation (the matter section switching to its Month
  // view) sees no navigation of its own, so the mount is the signal there. Deferred by a task
  // rather than raised in the mount itself, because during hydration the mount still runs before
  // the router has its root.
  onMount(() => {
    const timer = setTimeout(() => {
      navigated = true;
    }, 0);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    if (!address || !navigated) return;
    controller.mirrorAddress();
  });

  // ---- the window an entry opens in --------------------------------------------------------------

  let windowOpen = $state(false);
  let reference = $state<EntryReference | null>(null);

  function activate(gridEntry: CalendarGridEntry): void {
    const entry = controller.entriesById.get(gridEntry.id);
    if (entry === undefined) return;
    const next = entryReferenceOf(entry);
    if (next === null) {
      // A kind this window does not open (a custody due-back, when slice 2 turns it on) goes where
      // the federated read says it lives.
      if (entry.link !== null) void goto(entry.link);
      return;
    }
    reference = next;
    windowOpen = true;
  }

  /*
   * The address's entry, opened once per identifier. A deadline waits for the first read to land,
   * because it can only be read through the chip that painted it; an event or a firm event has a
   * read of its own and opens at once.
   */
  let openedFromAddress: string | null = null;
  $effect(() => {
    const wanted = openEntry;
    const loading = controller.loading;
    if (wanted === null || wanted === openedFromAddress) return;
    const next = entryReferenceFromIdentifier(wanted);
    if (next === null) {
      openedFromAddress = wanted;
      return;
    }
    if (next.kind === "deadline" && loading) return;
    openedFromAddress = wanted;
    untrack(() => {
      const onScreen = controller.entriesById.get(entryId(next.kind, next.recordId));
      reference = onScreen === undefined ? next : (entryReferenceOf(onScreen) ?? next);
      windowOpen = true;
    });
  });

  // ---- how the grid is named and what it says when empty --------------------------------------

  /** Whose calendar the grid is, in the possessive: "your", "Ada Lovelace's", "the firm's". */
  const whose = $derived(
    whoseCalendar(scope, controller.scopeChoice, controller.memberChoice, (userId) =>
      context.memberName(userId),
    ),
  );
  const gridLabel = $derived(calendarLabel(whose));
  const emptyMessage = $derived(emptyCalendarMessage(scope, whose, controller.title));

  /*
   * A capped host paints the first N and points at the rest. The link opens the same calendar on
   * the same span, on the screen that owns the scope, so "N more" is one press from the answer.
   */
  const painted = $derived.by((): readonly CalendarGridEntry[] => {
    const entries = controller.visibleEntries ?? [];
    return limit === null ? entries : entries.slice(0, Math.max(0, limit));
  });
  const beyondLimit = $derived(
    limit === null ? 0 : Math.max(0, (controller.visibleEntries?.length ?? 0) - limit),
  );
  const moreHref = $derived(
    restOfCalendarAddress(scope, controller.anchor, controller.scopeChoice, controller.memberChoice),
  );
</script>

<div class="flex h-full min-h-0 flex-col gap-12 {className ?? ''}">
  {#if toolbar}
    <CalendarToolbar {controller} {viewSwitch} members={context.members} />
  {/if}

  {#each controller.failures as failed (failed.read)}
    <FailureNotice
      failure={failed.failure}
      title={readFailureTitle(failed.read)}
      fallback={describeReadFailure(failed.read)}
      onRetry={() => void controller.reload(fetch)}
    />
  {/each}

  <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto">
    {#if view === "month"}
      <CalendarGrid.Month
        entries={painted}
        label={gridLabel}
        anchor={controller.anchor}
        weekStartsOn={controller.weekStartsOn}
        today={controller.today}
        loading={controller.loading}
        {emptyMessage}
        onActivate={activate}
        onShowDay={(date) => controller.showDay(date)}
      />
    {:else if view === "week"}
      <CalendarGrid.Week
        entries={painted}
        label={gridLabel}
        anchor={controller.anchor}
        weekStartsOn={controller.weekStartsOn}
        today={controller.today}
        loading={controller.loading}
        {emptyMessage}
        onActivate={activate}
      />
    {:else}
      <CalendarGrid.Agenda
        class="h-full"
        entries={painted}
        label={gridLabel}
        from={controller.window.from}
        to={controller.window.to}
        loading={controller.loading}
        {emptyMessage}
        onActivate={activate}
      />
    {/if}
  </div>

  {#if beyondLimit > 0}
    <!-- A capped host says what it left out and where the rest is. -->
    <p class="text-xs text-text-muted">
      <a href={moreHref} class="underline underline-offset-2 hover:text-text-default">
        {beyondLimit} more on the calendar
      </a>
    </p>
  {/if}

  {#if controller.hiddenCount > 0 && view === "agenda"}
    <!-- What the agenda's hide left out, counted, so a narrowed list never reads as the whole. -->
    <p class="text-xs text-text-muted">
      {controller.hiddenCount} settled {controller.hiddenCount === 1 ? "entry" : "entries"} hidden.
    </p>
  {/if}

  {#if controller.truncated && controller.entries !== null}
    <!-- A walk that hit its ceiling says so: a page that read as the whole month when it is not
         would be a silent cap. -->
    <p class="text-xs text-text-muted">
      Showing the first {controller.entries.length} entries.
    </p>
  {/if}
</div>

<EntryWindow
  bind:open={windowOpen}
  {reference}
  {context}
  onChanged={() => void controller.reload(fetch)}
/>

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
   * THE CALENDARS ARE A RAIL, on the firm side, AND THE RAIL IS A NAVIGATION COLUMN. Which of the
   * firm's calendars a reader has open is theirs and is drawn beside the grid rather than hidden in
   * a menu; where it stands, the two sides are the design system's `NavigationLayout` — the same
   * component Settings, Magnus, Tools and Reports are — so this file draws no column, no measure
   * and no scroll region of its own. A matter's calendar and a room's have exactly one calendar
   * each, draw no rail, and keep the plain frame: one stack, the grid taking what is left.
   *
   * THE HOST'S HEADER GOES INSIDE THE LAYOUT, WHICH IS WHY THERE IS A `header` SNIPPET. The layout
   * takes the full height under the top bar and cancels the work canvas inset, so a screen drawing
   * its masthead above this tag would be drawing it above the whole canvas. The firm screen hands
   * its masthead down instead.
   *
   * THE TITLE SPANS BOTH COLUMNS AND THE DATE CONTROLS TAKE ITS OLD PLACE (owner, 2026-09-16: "move
   * the large font title for calendar above the left sidebar, move the date selector to where
   * calendar title used to be"). The masthead is handed to the layout's own `header`, a band over
   * the whole canvas, so the screen's name stands over the screen rather than over one column of it
   * — which is what it always named. The action row then sits at the top of the content column,
   * directly over the grid it moves: both where the title used to be, and where every host without
   * a rail has always drawn it. So there is now ONE arrangement instead of two, and no host claims
   * the row. That replaces the 2026-09-14 arrangement, which seated the row in the masthead's
   * actions beside New — right while the masthead sat over the grid's own column, and wrong the
   * moment it spanned both.
   *
   * DOUBLE-CLICKING AN EMPTY DAY OR HOUR STARTS A RECORD ON IT. The component does not own the
   * forms — the host does, because the host is what knows whether a matter is in scope — so the
   * gesture is reported upward with the day, and the hour where a day grid gave one.
   *
   * ACTIVATING A CHIP OPENS THE WINDOW; THE ADDRESS CAN TOO. A chip on the grid remembers what it
   * painted, so the window reads the one record pressed. An address carrying `entry=` opens the
   * same window on arrival, which is the deep link the federated read emits. A deadline reached
   * that way is looked for among the chips on screen first, because it can only be read through
   * the matter and the day the chip knows.
   */
  import { onMount, untrack, type Snippet } from "svelte";
  import { afterNavigate, goto } from "$app/navigation";
  import * as CalendarGrid from "@magna-carta/design-system/calendar-grid";
  import NavigationLayout from "@magna-carta/design-system/navigation-layout";
  import type { CalendarGridEntry } from "@magna-carta/design-system/calendar-grid";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { calendarContext } from "./calendar-context.svelte.ts";
  import { CalendarController } from "./calendar-controller.svelte.ts";
  import { entryId, recordKeyOf } from "./calendar-entries.ts";
  import { describeReadFailure, readFailureKey, readFailureTitle } from "./calendar-reads.ts";
  import CalendarRail from "./calendar-rail.svelte";
  import CalendarMenu from "./calendar-menu.svelte";
  import CalendarMonthPicker from "./calendar-month-picker.svelte";
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
    search = "",
    rail = false,
    calendarMenu = false,
    onCreate,
    header,
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
    /**
     * What the reader is looking for in the window on screen. Passed IN from the host, because the
     * control that carries it belongs in the screen's one action row while the entries it narrows
     * are here. It narrows the WINDOW — see `search` on the controller for why the window is the
     * scope and what that deliberately does not claim.
     */
    search?: string;
    /**
     * Whether the rail of individual calendars is drawn beside the grid. The firm screen passes
     * true; a matter's section and an embedded card have one calendar each and pass nothing.
     */
    rail?: boolean;
    /**
     * Whether a Calendars menu — the rail's folders and rows as a dropdown — is drawn over the
     * grid. For a calendar with no room for a rail that still has to answer "who is busy":
     * the day being booked beside a record form. It reads and writes the same selection the rail
     * does, so the two never disagree.
     */
    calendarMenu?: boolean;
    /**
     * A double-click landed on an empty day or hour: the civil day, and the minute past midnight
     * where a day grid named one. The host opens its own record form on it — this component owns
     * no forms, because only the host knows whether a matter is in scope.
     */
    onCreate?: (date: string, minuteOfDay?: number) => void;
    /**
     * The host screen's own masthead, drawn as a band ACROSS both columns above them. It belongs
     * inside the layout rather than above this tag: the navigation layout takes the full height
     * under the top bar and cancels the canvas inset, so a masthead above it would sit above the
     * whole canvas. A host with no rail is under no such layout: it draws its own masthead above
     * this tag and passes nothing here, which is why the plain frame renders no header.
     *
     * It is NOT handed the action row. The view switch and the window navigation sit over the grid
     * they move, in both arrangements, so a host never has to decide where they go.
     */
    header?: Snippet;
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
    // The catalog is built from what the context already read: the roster and the bookable things.
    catalog: () => ({
      members: context.members,
      resources: context.resources,
      ownAccount: context.hasOwnAccountCalendars,
    }),
  });

  /*
   * The host owns the field; the controller owns what the window is narrowed to. Mirrored rather
   * than passed as a reader closure because the controller's `search` is plain state a reader can
   * also clear from inside — the two are the same fact, and this is the one place they meet.
   */
  $effect(() => {
    controller.search = search;
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
    // A day grid draws a record once per calendar it is on, so the row's key carries the column it
    // was drawn in; the record behind both copies is the same one.
    const entry = controller.entriesById.get(recordKeyOf(gridEntry.id));
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
  // Undefined on every grid: a month with nothing on it says so by being an empty month. Only the
  // agenda — a blank rectangle otherwise — carries a sentence.
  // Empty on every grid: a month with nothing on it says so by being an empty month (owner ruling,
  // 2026-09-14). Only the agenda — a blank rectangle otherwise — carries a sentence.
  const emptyMessage = $derived(emptyCalendarMessage(scope, whose, controller.title, view) ?? "");

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

  /*
   * Whether this calendar is the two-sided screen. The rail is a firm-side thing — a matter's
   * calendar and a room's are one calendar each, and a column offering one row is not a column — so
   * a host asking for it on a scope that has nothing to list gets the plain frame rather than an
   * empty navigation column.
   */
  const railStands = $derived(rail && controller.firmSide);

  /*
   * ONE SCROLL REGION UNDER THE ACTION ROW, and which element it is depends on the grid.
   *
   * A month, a week and a day are TABLES: they draw their whole shape and scroll nothing of their
   * own, so the wrapper around them is the scroll region. The agenda is a scrolling child by
   * design — a named, focusable region a keyboard can reach when its rows have scrolled past — so
   * there the wrapper stands aside and the agenda is the region. Two nested scrollers is what the
   * owner met on a laptop (2026-09-17: "has multiple scrollbars"), and a region inside a region
   * offers a reader two bars for one list with no way to tell which one moves what.
   */
  const gridRegionClasses = $derived(
    view === "agenda"
      ? "flex min-h-0 flex-1 flex-col"
      : "mc-scrollbar min-h-0 flex-1 overflow-y-auto",
  );

</script>

<!--
  The calendar itself, in one stack: the action row, the failures a read left, the grid taking the
  rest of the height, and the lines that say what was left out. It is a snippet because the frame
  around it is one of two — the navigation layout where the rail stands, a plain full-height stack
  everywhere else — and the calendar inside them is the same calendar.
-->
{#snippet calendar(frameClass: string)}
<div class="flex min-h-0 flex-col gap-8 {frameClass}">
  <!-- The action row: the view switch and the window navigation, over the grid they move. One
       place, both arrangements — a row a header could claim was a row two arrangements could each
       draw. -->
  {#if toolbar}
    <CalendarToolbar {controller} {viewSwitch} />
  {/if}

  <!-- Where there is no rail and no toolbar but the reader still has to choose whose calendars
       they are looking at: the menu, on its own short row over the grid. Firm side only, like the
       rail: a matter's calendar has one calendar and nothing to choose. -->
  {#if calendarMenu && !toolbar && controller.firmSide}
    <div class="flex items-center">
      <CalendarMenu {controller} />
    </div>
  {/if}

  {#each controller.failures as failed (readFailureKey(failed))}
    <FailureNotice
      failure={failed.failure}
      title={readFailureTitle(failed.read)}
      fallback={describeReadFailure(failed.read, failed.sourceName)}
      onRetry={() => void controller.reload(fetch)}
    />
  {/each}

  <div class={gridRegionClasses}>
      {#if view === "month"}
        <!-- THE MONTH FILLS THE HEIGHT IT IS GIVEN. Its cells carry a minimum rather than a fixed
             height, so six weeks share whatever the column has left and the frame comes to rest on
             the bottom edge; only when that minimum wins — a short screen, or a month with full
             days — does the region above scroll. A month that was always six times its cell
             minimum tall scrolled on every laptop with nothing on it. -->
        <CalendarGrid.Month
          class="h-full"
          entries={painted}
          label={gridLabel}
          anchor={controller.anchor}
          weekStartsOn={controller.weekStartsOn}
          today={controller.today}
          loading={controller.loading}
          {emptyMessage}
          onActivate={activate}
          onShowDay={(date) => controller.showDay(date)}
          {onCreate}
        />
      {:else if view === "week"}
        <!-- The week is a TIME GRID now: seven day columns over an hour axis, with every timed
             entry a block from its start to its end. -->
        <CalendarGrid.Week
          entries={painted}
          label={gridLabel}
          anchor={controller.anchor}
          weekStartsOn={controller.weekStartsOn}
          today={controller.today}
          concurrency={controller.concurrency}
          loading={controller.loading}
          {emptyMessage}
          onActivate={activate}
          {onCreate}
        />
      {:else if view === "day"}
        <!-- A lane per calendar the reader has on: the one presentation that makes a day of parallel
             scheduling legible. A record on two calendars is drawn in both their columns on purpose. -->
        <CalendarGrid.Day
          entries={controller.laneEntries ?? []}
          label={gridLabel}
          date={controller.anchor}
          lanes={controller.lanes}
          today={controller.today}
          concurrency={controller.concurrency}
          loading={controller.loading}
          {emptyMessage}
          onActivate={activate}
          {onCreate}
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

  {#if controller.searching}
    <!-- WHAT THE COUNT IS A COUNT OF. The search narrows the window on screen, so the line names
         that window rather than reporting a bare number of matches — "3 matches" beside a month
         grid would read as three on the calendar, and a reader who then moved to October would be
         entitled to think it had gone. -->
    <p class="text-xs text-text-muted">
      {(controller.visibleEntries ?? []).length} {(controller.visibleEntries ?? []).length === 1 ? "entry" : "entries"} in {controller.title} {(controller.visibleEntries ?? []).length === 1 ? "matches" : "match"} that. Other dates aren't searched. Move the calendar to look elsewhere.
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
{/snippet}

{#if railStands}
  <!--
    The two-sided screen, drawn by the design system and by nothing here: the layout owns the
    landmark and its name, the column's measure, the two independent scroll regions with their
    reserved gutters, the canvas inset it cancels and the full height under the top bar.

    `contentScrolls={false}` because this side stages its own three parts — the host's masthead, the
    action row, and the grid as the one scroll region beneath them — and a column that had already
    reserved a gutter for a scrollbar would otherwise draw a second one inside it. The `p-24` is the
    canvas inset the layout cancelled, put back where a scrollbar then sits at the true edge.
  -->
  <NavigationLayout
    navigationLabel="Calendars"
    navigationWidth="standard"
    contentScrolls={false}
    class={className}
    {header}
  >
    {#snippet navigation()}
      <CalendarRail {controller} />
    {/snippet}
    <!-- Pinned under the rail, outside its scroll: the month a reader navigates by, which a firm
         with twenty rooms would otherwise scroll past its rooms to reach. -->
    {#snippet navigationFooter()}
      <CalendarMonthPicker {controller} />
    {/snippet}
    <!-- The `p-24` is the canvas inset the layout cancelled, put back where a scrollbar then sits
         at the true edge. Nothing else spaces this column: what is inside it is one stack, and the
         stack sets its own rhythm. -->
    <div class="flex min-h-0 flex-1 flex-col p-24">
      {@render calendar("flex-1")}
    </div>
  </NavigationLayout>
{:else}
  <!-- One calendar, one stack: a matter's section, a room's grid, a card on Home. There is no
       masthead to render here — a host with no rail sits under a masthead of its own, above this
       tag, where nothing is cancelling the canvas. -->
  {@render calendar(`h-full ${className ?? ""}`)}
{/if}

<EntryWindow
  bind:open={windowOpen}
  {reference}
  {context}
  onChanged={() => void controller.reload(fetch)}
/>

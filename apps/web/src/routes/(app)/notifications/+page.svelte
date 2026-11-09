<script lang="ts">
  /*
   * Notifications — the member's own feed, as the product's one table.
   *
   * WHAT THE SCREEN IS FOR: clearing a backlog. It is the List archetype, the same table Matters,
   * the Directory and the task list are, so a reader narrows it from the columns' own headers (read
   * state, category, priority) rather than from a second strip of controls above it, and sorts,
   * hides and pins the way they do everywhere else (docs/conventions/design-corrections.md, the
   * list-screen rulings).
   *
   * READ AND DISMISSED ARE TWO DIFFERENT STATEMENTS, and the owner chose to keep both
   * (2026-11-09). Opening a notification, or pressing its leading check, marks it READ: the member
   * has seen it, and it stays in the feed. DISMISSING it says the member is finished with it, and it
   * leaves the feed. Nothing is deleted by either: every row ages out on the firm's retention clock
   * whatever its state, and what it pointed at is untouched. So the dismissed rows are a shelf the
   * member can open from the foot of the table, where a dismissed row reads quieter, sorts after
   * everything live, and offers Restore in place of Dismiss.
   *
   * TWO READS, BECAUSE THEY ARE TWO QUESTIONS. The feed asks the server for unread and read rows
   * together, so a page is never short because dismissed rows filled it; the shelf asks for the
   * dismissed rows, and only once somebody opens it. The search travels with both. The column
   * filters narrow the rows in hand, as on every other paged register, which is why the footer says
   * how many of how many are showing.
   *
   * EVERY COUNT COMES FROM THE SERVER. The badge is the shared count the bell reads, settled from
   * the server's answer after a write, never a tally of rows that left this view.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import Check from "@lucide/svelte/icons/check";
  import CheckCheck from "@lucide/svelte/icons/check-check";
  import Archive from "@lucide/svelte/icons/archive";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import X from "@lucide/svelte/icons/x";
  import { goto } from "$app/navigation";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import {
    NOTIFICATION_COLUMN_IDENTIFIERS,
    NOTIFICATION_INITIAL_SORT,
    notificationColumns,
    orderNotificationRows,
  } from "$lib/notifications/notification-columns.ts";
  import {
    categoriesMatching,
    describeNotification,
    kindsMatching,
    PRIORITY_LABEL,
    SEVERITY_BADGE,
  } from "$lib/notifications/notification-presentation.ts";
  import { unreadNotificationCount } from "$lib/notifications/unread-count.svelte.ts";
  import {
    dismissNotification,
    listNotifications,
    markNotificationRead,
    markNotificationsReadThrough,
    restoreNotification,
    type NotificationItem,
  } from "$lib/notifications/notifications-api.ts";

  const live = new PagedList<NotificationItem>("Your notifications could not be read.");
  const shelf = new PagedList<NotificationItem>("Your dismissed notifications could not be read.");

  /** Whether the dismissed rows are on screen. Opened from the foot of the table, never above it. */
  let showDismissed = $state(false);
  /** The bound `read-all` takes: the newest row of the first page of the live feed. */
  let readThroughCursor = $state<string | null>(null);
  let clearing = $state(false);
  /** Bumped to read both lists again from the top, after a write whose result moves rows. */
  let reloadToken = $state(0);

  /*
   * What the feed is being asked. `searchText` is the field's and `appliedSearch` is what the server
   * was last asked for; ScreenSearch owns the pause between them.
   *
   * The row carries no sentence to match, because the words a member reads are composed here from
   * the kind and the declared facts. So the query is resolved into the KINDS and CATEGORIES whose
   * words it reaches and those travel with it, which lets the whole feed be searched rather than the
   * page in hand.
   */
  let searchText = $state("");
  let appliedSearch = $state("");
  const searchFilters = $derived(
    appliedSearch.trim() === ""
      ? {}
      : {
          kinds: kindsMatching(appliedSearch),
          searchCategories: categoriesMatching(appliedSearch),
          search: appliedSearch.trim(),
        },
  );
  const subject = $derived(`${appliedSearch.trim()}:${String(reloadToken)}`);

  function readLive(cursor?: string) {
    return listNotifications(fetch, cursor, { state: ["unread", "read"], ...searchFilters }).then(
      (outcome) => {
        // Only the FIRST page sets the bound. A later page names an older row, and adopting it would
        // quietly narrow what "mark all read" covers the further a member scrolled.
        if (outcome.kind === "ok" && cursor === undefined) {
          readThroughCursor = outcome.value.readThroughCursor;
        }
        return outcome;
      },
    );
  }

  function readShelf(cursor?: string) {
    return listNotifications(fetch, cursor, { state: "dismissed", ...searchFilters });
  }

  $effect(() => {
    const asked = subject;
    if (live.showing(asked)) return;
    live.reset(asked);
    void live.load(readLive);
  });

  $effect(() => {
    const asked = subject;
    if (!showDismissed || shelf.showing(asked)) return;
    shelf.reset(asked);
    void shelf.load(readShelf);
  });

  // The badge is shared with the top bar's bell, so this screen watches it rather than keeping a
  // second count that could disagree with the one above it.
  $effect(() => unreadNotificationCount.watch(fetch));

  const rows = $derived([...(live.items ?? []), ...(showDismissed ? (shelf.items ?? []) : [])]);

  const grid = DataTable.createDataTableGrid<NotificationItem>({
    columns: () => notificationColumns(),
    rows: () => rows,
    rowKey: (item) => item.id,
    initialSort: NOTIFICATION_INITIAL_SORT,
    itemNoun: { singular: "notification", plural: "notifications" },
    rowMark: (item) => (item.state === "dismissed" ? { quiet: true } : undefined),
    orderRows: orderNotificationRows,
    onActivate: (item) => void follow(item),
  });

  /** Settle one row in place: the row object is reactive state, so moving its one field is enough. */
  function settleInPlace(item: NotificationItem, state: NotificationItem["state"]): void {
    const row = rows.find((candidate) => candidate.id === item.id);
    if (row !== undefined) row.state = state;
  }

  async function markRead(item: NotificationItem): Promise<void> {
    if (item.state !== "unread") return;
    const outcome = await markNotificationRead(fetch, item.id);
    if (outcome.kind !== "ok") return;
    unreadNotificationCount.noteOneSettled();
    settleInPlace(item, "read");
  }

  /** Open what a notification points at, settling it on the way past. */
  async function follow(item: NotificationItem): Promise<void> {
    await markRead(item);
    // A kind whose type has been retired resolves to no link; there is nowhere to go, and reloading
    // the page the reader is standing on would be worse than staying.
    if (item.link !== "") void goto(item.link);
  }

  async function dismiss(item: NotificationItem): Promise<void> {
    const outcome = await dismissNotification(fetch, item.id);
    if (outcome.kind !== "ok") return;
    if (item.state === "unread") unreadNotificationCount.noteOneSettled();
    // The row moves from the feed to the shelf rather than vanishing, so a member who pressed the
    // wrong row and then opens the shelf finds it where it went.
    live.items = (live.items ?? []).filter((row) => row.id !== item.id);
    if (shelf.items !== null) shelf.items = [{ ...item, state: "dismissed" }, ...shelf.items];
  }

  async function restore(item: NotificationItem): Promise<void> {
    const outcome = await restoreNotification(fetch, item.id);
    if (outcome.kind !== "ok") return;
    // Read the feed again rather than guessing where the row belongs in it: it returns read, at
    // whatever point in the paged feed its own date puts it.
    shelf.items = (shelf.items ?? []).filter((row) => row.id !== item.id);
    reloadToken += 1;
  }

  async function clearBacklog(): Promise<void> {
    const bound = readThroughCursor;
    if (bound === null || clearing) return;
    clearing = true;
    const outcome = await markNotificationsReadThrough(fetch, bound);
    clearing = false;
    if (outcome.kind !== "ok") return;
    unreadNotificationCount.noteUnread(outcome.value.remainingUnreadCount);
    for (const row of live.items ?? []) if (row.state === "unread") row.state = "read";
  }

  function loadMore(): void {
    if (live.nextCursor !== null) void live.loadMore(readLive);
    else if (showDismissed && shelf.nextCursor !== null) void shelf.loadMore(readShelf);
  }

  const moreToRead = $derived(
    live.nextCursor !== null || (showDismissed && shelf.nextCursor !== null),
  );
  const swept = $derived(unreadNotificationCount.sweptUnread);
  const sweptOldest = $derived(unreadNotificationCount.counts?.sweptUnreadOldestOccurredAt ?? null);
</script>

<svelte:head>
  <title>Notifications · Magna Carta</title>
</svelte:head>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<NotificationItem>)}
  {#if column.id === NOTIFICATION_COLUMN_IDENTIFIERS.state}
    {#if row.state === "dismissed"}
      <span class="inline-flex size-20 items-center justify-center text-text-subtle" title="Dismissed">
        <Archive class="size-16" aria-hidden="true" />
        <span class="sr-only">Dismissed</span>
      </span>
    {:else if row.state === "unread"}
      <!-- The leading check: filled while unread, and pressing it marks the row read without
           leaving the screen. Opening the row marks it read too. -->
      <button
        type="button"
        class="inline-flex size-20 items-center justify-center rounded-full border border-accent-default
               bg-accent-default text-text-inverse"
        title="Mark Read"
        aria-label="Mark Read"
        onclick={(event) => {
          event.stopPropagation();
          void markRead(row);
        }}
      >
        <Check class="size-12" aria-hidden="true" />
      </button>
    {:else}
      <span
        class="inline-flex size-20 items-center justify-center rounded-full border border-border-strong"
        title="Read"
      >
        <span class="sr-only">Read</span>
      </span>
    {/if}
  {:else if column.id === NOTIFICATION_COLUMN_IDENTIFIERS.notification}
    <span class={row.state === "unread" ? "font-semibold" : ""}>{text}</span>
    {#if describeNotification(row).fallback}
      <span class="sr-only">(a kind this version of the app has no words for)</span>
    {/if}
  {:else if column.id === NOTIFICATION_COLUMN_IDENTIFIERS.priority}
    {#if PRIORITY_LABEL[row.severity] !== null}
      <Badge variant={SEVERITY_BADGE[row.severity]}>{PRIORITY_LABEL[row.severity]}</Badge>
    {/if}
  {:else if column.id === NOTIFICATION_COLUMN_IDENTIFIERS.actions}
    <!-- On every row, never only on hover: a control that comes and goes at the end of a row moves
         everything before it, and is out of reach of anybody not using a mouse. -->
    {#if row.state === "dismissed"}
      <Button
        variant="ghost"
        size="sm"
        onclick={(event: MouseEvent) => {
          event.stopPropagation();
          void restore(row);
        }}
      >
        <RotateCcw class="size-16" aria-hidden="true" />
        Restore
      </Button>
    {:else}
      <Button
        variant="ghost"
        size="sm"
        onclick={(event: MouseEvent) => {
          event.stopPropagation();
          void dismiss(row);
        }}
      >
        <X class="size-16" aria-hidden="true" />
        Dismiss
      </Button>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <ScreenHeader title="Notifications" class="mb-24">
    {#snippet meta()}
      {#if unreadNotificationCount.unread > 0}
        <Badge variant="accent">{unreadNotificationCount.unread} unread</Badge>
      {/if}
    {/snippet}
    {#snippet actions()}
      <!-- Clear Filters comes and goes, so it leads rather than ending the row. -->
      <DataTable.ClearFilters {grid} />
      <ScreenSearch
        bind:value={searchText}
        label="Search your notifications"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={readThroughCursor === null || clearing || unreadNotificationCount.unread === 0}
        onclick={() => void clearBacklog()}
      >
        <CheckCheck class="size-16" aria-hidden="true" />
        Mark All Read
      </Button>
      <Button
        variant="ghost"
        size="icon"
        href="/settings/notifications"
        title="Notification Settings"
        aria-label="Notification Settings"
      >
        <Settings2 class="size-16" aria-hidden="true" />
      </Button>
    {/snippet}
  </ScreenHeader>

  {#if live.failure !== null && live.items === null}
    <FailureNotice
      failure={live.failure}
      title="Notifications Unavailable"
      fallback={live.failureMessage ?? undefined}
      onRetry={() => (reloadToken += 1)}
    />
  {:else}
    <DataTable.Grid
      {grid}
      {cell}
      class="min-h-0 flex-1"
      caption="Your notifications"
      loading={live.items === null}
    ></DataTable.Grid>

    <!-- A page that failed after rows were already on screen. Those rows were read and are still
         true, so they stay; the failure is stated under them. -->
    {@const laterFailure = live.failure ?? (showDismissed ? shelf.failure : null)}
    {#if laterFailure !== null}
      <FailureNotice
        failure={laterFailure}
        title="More Notifications Unavailable"
        fallback={live.failureMessage ?? shelf.failureMessage ?? undefined}
        onRetry={() => (reloadToken += 1)}
      />
    {/if}

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <span class="inline-flex items-center gap-12">
          {#if swept > 0}
            <!-- What the retention sweep took while it was still unread: a count, stated where the
                 other counts are, rather than a sentence over the table. -->
            <span class="text-text-muted">
              {swept} unread aged out{sweptOldest === null
                ? ""
                : `, oldest ${formatDate(sweptOldest)}`}
            </span>
          {/if}
          <!-- It WIDENS the list, so it sits at the foot rather than among the controls that narrow
               it, and it says what pressing it again will do. -->
          <Button variant="ghost" size="sm" onclick={() => (showDismissed = !showDismissed)}>
            {showDismissed ? "Hide Dismissed" : "Show Dismissed"}
          </Button>
          <DataTable.LoadMore
            noun="notifications"
            more={moreToRead}
            loading={live.loadingMore || shelf.loadingMore}
            onLoad={loadMore}
          />
        </span>
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>

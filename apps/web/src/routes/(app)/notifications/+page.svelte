<script lang="ts">
  /*
   * The notification centre — the member's own feed, and the first surface to read the notification
   * rows the platform has been writing all along.
   *
   * WHAT THE SCREEN IS FOR: clearing a backlog, not browsing an archive. That decides the two
   * filters it carries and the ones it does not. State (everything / unread) and category are the
   * two questions a member actually asks of a backlog; a date range, a matter picker and a search
   * box are questions about an archive, and the timeline is where those belong — a notification is
   * a pointer, and the record it points at is the thing worth searching.
   *
   * THE FILTERS NARROW THE READ, NOT THE ROWS. Both are query parameters, so a filtered feed is
   * cheaper rather than merely shorter, and the page size keeps meaning the same thing. Filtering on
   * this side would also make the cursor mean something different from page to page.
   *
   * EVERY COUNT ON THIS SCREEN COMES FROM THE SERVER, INCLUDING AFTER A WRITE. The badge is not
   * decremented by counting rows that left the view: a member's unread count is resolved under the
   * same visibility filter the feed is, and a client-side tally would drift from it the moment a row
   * was filtered rather than deleted.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { goto } from "$app/navigation";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Select from "@magna-carta/design-system/select";
  import CheckCheck from "@lucide/svelte/icons/check-check";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import {
    categoriesMatching,
    kindsMatching,
  } from "$lib/notifications/notification-presentation.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import NotificationRows from "$lib/notifications/notification-rows.svelte";
  import {
    NOTIFICATION_CATEGORIES,
    notificationCategoryLabel,
    type NotificationCategory,
  } from "$lib/notifications/category-vocabulary.ts";
  import { unreadNotificationCount } from "$lib/notifications/unread-count.svelte.ts";
  import {
    dismissNotification,
    listNotifications,
    markNotificationRead,
    markNotificationsReadThrough,
    type NotificationItem,
  } from "$lib/notifications/notifications-api.ts";
  import { formatInstant } from "@magna-carta/design-system/formatters";

  const ALL = "all" as const;

  // `items` is what lets the trigger render the selected label; the same list drives the menu, so
  // the two can never name a category differently.
  const CATEGORY_FILTER_OPTIONS = [
    { value: ALL, label: "All categories" },
    ...NOTIFICATION_CATEGORIES.map((category) => ({
      value: category,
      label: notificationCategoryLabel(category),
    })),
  ];

  let stateFilter = $state<"all" | "unread">("all");
  let categoryFilter = $state<NotificationCategory | typeof ALL>(ALL);
  /** The bound `read-all` takes: the newest row of the first page this screen drew. */
  let readThroughCursor = $state<string | null>(null);
  let clearing = $state(false);
  /** Bumped after a write, so the list re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  const list = new PagedList<NotificationItem>("Your notifications could not be read.");

  /*
   * What the feed is being asked. `searchText` is the field's and `appliedSearch` is what the
   * server was last asked for; ScreenSearch owns the pause between them.
   *
   * IT GOES TO THE SERVER, and the shape it takes on the way is the interesting part. This row
   * carries no sentence to match — the words a member reads are composed here from the kind and the
   * declared facts — so the query is resolved into the KINDS and CATEGORIES whose words it reaches
   * and those travel with it. That is what lets the whole feed be searched rather than the page in
   * hand: a member whose match is two pages down is told about it, instead of being told there is
   * none.
   */
  let searchText = $state("");
  let appliedSearch = $state("");
  const searching = $derived(appliedSearch.trim() !== "");
  const searchFilters = $derived(
    searching
      ? {
          kinds: kindsMatching(appliedSearch),
          searchCategories: categoriesMatching(appliedSearch),
          search: appliedSearch.trim(),
        }
      : {},
  );

  const items = $derived(list.items);
  const narrowed = $derived(stateFilter !== "all" || categoryFilter !== ALL || searching);

  function readPage(cursor?: string) {
    return listNotifications(fetch, cursor, {
      category: categoryFilter === ALL ? undefined : categoryFilter,
      state: stateFilter === "unread" ? "unread" : undefined,
      ...searchFilters,
    }).then((outcome) => {
      // Only the FIRST page sets the bound. A later page names an older row, and adopting it would
      // quietly narrow what "mark all read" covers the further a member scrolled.
      if (outcome.kind === "ok" && cursor === undefined) {
        readThroughCursor = outcome.value.readThroughCursor;
      }
      return outcome;
    });
  }

  /*
   * The read, and nothing else in this effect. The subject carries both filters and the reload
   * token, so changing a filter is a change of subject (the rows are replaced) while a re-read after
   * a write is the same subject read again — which keeps the list from flashing a skeleton over a
   * page the member is still looking at.
   */
  $effect(() => {
    const subject = `${stateFilter}:${categoryFilter}:${appliedSearch.trim()}:${String(reloadToken)}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    void list.load(readPage);
  });

  // The badge is shared with the top bar's bell, so this screen watches it rather than keeping a
  // second count that could disagree with the one three inches above it.
  $effect(() => unreadNotificationCount.watch(fetch));

  function reload(): void {
    reloadToken += 1;
  }

  async function open(item: NotificationItem): Promise<void> {
    if (item.state !== "unread") return;
    const outcome = await markNotificationRead(fetch, item.id);
    if (outcome.kind !== "ok") return;
    // The row is settled in place rather than re-reading the page: following a link should not pull
    // the list out from under the member as they leave it. The badge moves immediately because it is
    // the thing they will look at next.
    unreadNotificationCount.noteOneSettled();
    // Settled in place: the row object is reactive state, so moving its one field is enough and
    // rebuilding the array would discard the identity every keyed block is tracking.
    const row = (list.items ?? []).find((candidate) => candidate.id === item.id);
    if (row !== undefined) row.state = "read";
  }

  async function dismiss(item: NotificationItem): Promise<void> {
    const outcome = await dismissNotification(fetch, item.id);
    if (outcome.kind !== "ok") return;
    if (item.state === "unread") unreadNotificationCount.noteOneSettled();
    // A dismissal changes what the current filter matches, so this one re-reads: leaving a dismissed
    // row standing under "Unread" would be the list disagreeing with its own filter.
    reload();
  }

  async function clearBacklog(): Promise<void> {
    const bound = readThroughCursor;
    if (bound === null || clearing) return;
    clearing = true;
    const outcome = await markNotificationsReadThrough(fetch, bound);
    clearing = false;
    if (outcome.kind !== "ok") return;
    unreadNotificationCount.noteUnread(outcome.value.remainingUnreadCount);
    reload();
  }

</script>

<svelte:head>
  <title>Notifications · Magna Carta</title>
</svelte:head>

<ScreenHeader title="Notifications" class="mb-24">
  {#snippet meta()}
    {#if unreadNotificationCount.unread > 0}
      <Badge variant="accent">{unreadNotificationCount.unread} unread</Badge>
    {/if}
  {/snippet}
  {#snippet actions()}
    <!-- The search leads the row and grows toward the inline start, so what follows never moves when
         it opens — the same order as every other Workspace screen. -->
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
      Mark all read
    </Button>
  {/snippet}
  {#snippet pageMenu()}
    <!-- Where to change what arrives here: a hand-off to Settings rather than work on this list,
         so it lives in the page menu and the row keeps the search and Mark all read. -->
    <DropdownMenu.Item onSelect={() => void goto("/settings/notifications")}>
      <Settings2 class="size-16 shrink-0" aria-hidden="true" />
      What You Hear About
    </DropdownMenu.Item>
  {/snippet}
</ScreenHeader>

<div class="flex flex-col gap-16">
  <!-- The two filters. State first: "what still needs me" is the question a backlog is opened with,
       and the category narrows it afterwards. -->
  <div class="flex flex-wrap items-center gap-8">
    <div class="flex items-center gap-4 rounded-md border border-border-subtle p-2">
      <Button
        variant={stateFilter === "all" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={stateFilter === "all"}
        onclick={() => (stateFilter = "all")}
      >
        Everything
      </Button>
      <Button
        variant={stateFilter === "unread" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={stateFilter === "unread"}
        onclick={() => (stateFilter = "unread")}
      >
        Unread
      </Button>
    </div>

    <Select.Root
      type="single"
      items={CATEGORY_FILTER_OPTIONS}
      value={categoryFilter}
      onValueChange={(value) => (categoryFilter = value as NotificationCategory | typeof ALL)}
    >
      <Select.Trigger class="w-56" aria-label="Filter by category">
        <Select.Value placeholder="All categories" />
      </Select.Trigger>
      <Select.Content>
        {#each CATEGORY_FILTER_OPTIONS as option (option.value)}
          <Select.Item value={option.value} label={option.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <!-- What the retention sweep took while it was still unread. Stated rather than dropped: "there
       is nothing you missed" is a claim the platform is not in a position to make about somebody
       who has been away, and everything those pointers pointed at is still where it was. -->
  {#if unreadNotificationCount.sweptUnread > 0}
    {@const oldest = unreadNotificationCount.counts?.sweptUnreadOldestOccurredAt ?? null}
    <p class="text-xs text-text-muted">
      {unreadNotificationCount.sweptUnread} unread {unreadNotificationCount.sweptUnread === 1
        ? "notification"
        : "notifications"} aged out of this list{oldest === null
        ? ""
        : `, the oldest from ${formatInstant(oldest)}`}. What they pointed at — the matter, the
      deadline, the record — is unchanged.
    </p>
  {/if}

  <LoadingRegion
    loading={items === null}
    failed={list.failure !== null && items === null}
    empty={items !== null && items.length === 0}
    label="Reading your notifications"
    onRetry={reload}
    class="flex flex-col gap-16"
  >
    {#snippet failure()}
      {#if list.failure !== null}
        <FailureNotice
          failure={list.failure}
          title="Notifications Unavailable"
          fallback="Your notifications could not be read."
          onRetry={reload}
        />
      {/if}
    {/snippet}

    {#snippet emptyState()}
      <EmptyState title={narrowed ? "Nothing matches" : "You are up to date"}>
        {narrowed
          ? "No notification matches what you are narrowing by. Clearing the search, or widening the filters, brings the feed back."
          : "When something needs you — a deadline falling due, a task assigned, a movement on client money — it gathers here."}
      </EmptyState>
    {/snippet}

    {#if items !== null}
      <NotificationRows items={items} onOpen={(item) => void open(item)} onDismiss={(item) => void dismiss(item)} />

      {#if list.nextCursor !== null}
        <div class="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            disabled={list.loadingMore}
            onclick={() => void list.loadMore(readPage)}
          >
            {list.loadingMore ? "Reading older" : "Show older"}
          </Button>
        </div>
      {/if}

      <!-- A page that failed AFTER rows were already on screen. Those rows were read successfully
           and are still true, so they stay; the failure is stated under them rather than replacing
           them. -->
      {#if list.failure !== null && items.length > 0}
        <FailureNotice
          failure={list.failure}
          title="Older Notifications Unavailable"
          fallback="The older notifications could not be read."
          onRetry={() => void list.loadMore(readPage)}
        />
      {/if}
    {/if}
  </LoadingRegion>
</div>

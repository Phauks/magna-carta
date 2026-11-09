<script lang="ts">
  /*
   * The top-bar bell — the ambient way to what needs you, and the entry to the notification centre.
   *
   * A GLANCE, NOT THE CENTRE. It shows the newest few unread items and nothing else: no filters, no
   * dismiss, no paging. The screen behind it is where a backlog is worked, and a tray that grew
   * those controls would be a second, worse copy of it.
   *
   * THE BADGE IS THE SHARED COUNT. It comes from the same state the centre reads
   * (./unread-count.svelte.ts), so the bell and the list can never disagree — and it is the server's
   * number, resolved under the same visibility filter the feed is, rather than a tally of rows this
   * component happens to be holding.
   *
   * THE LIST IS READ WHEN THE TRAY OPENS, not on a timer. The badge is what needs to stay current in
   * the background, and it is cheap; the rows behind it are only worth reading when somebody is
   * actually looking at them.
   *
   * UNREAD ONLY, AND THE EMPTY STATE MEANS SOMETHING. An empty tray says the member is caught up,
   * which is a real answer — a tray listing already-read items would never be empty and would
   * therefore never say anything. It says so the way every empty list in the product does: "No
   * Results", and no sentence explaining the bell.
   *
   * THE MOST PRESSING FIRST. Of the newest few, an Urgent row leads, then Needs Attention, then the
   * rest, each run newest first: a glance is for what needs the member now, and a deadline overdue
   * must not sit under four routine rows that arrived after it.
   */
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { MaturityDot } from "@magna-carta/design-system/maturity";
  import Bell from "@lucide/svelte/icons/bell";
  import {
    DESTINATIONS,
    destinationStage,
    type Destination,
  } from "$lib/navigation/destinations.ts";
  import NotificationRows from "./notification-rows.svelte";
  import { PRIORITY_RANK } from "./notification-presentation.ts";
  import { unreadNotificationCount } from "./unread-count.svelte.ts";
  import {
    listNotifications,
    markNotificationRead,
    type NotificationItem,
  } from "./notifications-api.ts";

  /** How many the tray shows. A glance is four or five rows; more is the centre's job. */
  const TRAY_LIMIT = 5;

  const notificationsDestination = DESTINATIONS.find(
    (destination) => destination.id === "notifications",
  ) as Destination;

  let open = $state(false);
  let items = $state<readonly NotificationItem[] | null>(null);
  /** True when the tray's own read failed. The badge above it still stands on its own read. */
  let unreadable = $state(false);

  // The badge polls in the background for as long as the shell is mounted; the tray is where that
  // watch is owned, because the bell is the thing that renders it.
  $effect(() => unreadNotificationCount.watch(fetch));

  $effect(() => {
    if (!open) return;
    void (async () => {
      const outcome = await listNotifications(fetch, undefined, {
        state: "unread",
        pageSize: TRAY_LIMIT,
      });
      if (outcome.kind === "ok") {
        // Stable: rows of one priority keep the server's newest-first order.
        items = outcome.value.data.toSorted(
          (left, right) => PRIORITY_RANK[left.severity] - PRIORITY_RANK[right.severity],
        );
        unreadable = false;
        return;
      }
      unreadable = true;
    })();
  });

  async function follow(item: NotificationItem): Promise<void> {
    // Following a row closes the tray: the member is leaving for the record it points at, and a
    // popover left standing over the destination is something they then have to dismiss.
    open = false;
    const outcome = await markNotificationRead(fetch, item.id);
    if (outcome.kind !== "ok") return;
    unreadNotificationCount.noteOneSettled();
    items = (items ?? []).filter((row) => row.id !== item.id);
  }
</script>

<Popover.Root bind:open>
  <!-- The hover names the control and nothing else, like every control in this band. The tooltip
       and the popover share ONE button through the tooltip trigger's child snippet; two elements
       would be two controls. -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Popover.Trigger
          {...props}
          class="mc-top-bar-icon-button relative"
          aria-label={unreadNotificationCount.badge === null
            ? "Notifications"
            : `Notifications, ${unreadNotificationCount.badge} unread`}
        >
          <Bell class="size-16" aria-hidden="true" />
          {#if unreadNotificationCount.badge !== null}
            <!-- Real state, so it takes the one 16px corner from the maturity dot: a count of what
                 is waiting is more time-sensitive than a stage, and the stage stays stated on the
                 sidebar row and in the panel below. -->
            <span
              class="absolute -end-2 -top-2 flex min-w-16 items-center justify-center rounded-full
                     px-4 text-2xs font-semibold leading-none"
              style="background: var(--mc-accent-default); color: var(--mc-accent-foreground);
                     block-size: var(--mc-space-16)"
              aria-hidden="true"
            >
              {unreadNotificationCount.badge}
            </span>
          {:else}
            <MaturityDot
              stage={destinationStage(notificationsDestination)}
              class="absolute end-4 top-4"
            />
          {/if}
        </Popover.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>Notifications</Tooltip.Content>
  </Tooltip.Root>

  <Popover.Content
    align="end"
    class="flex flex-col gap-8"
    style="inline-size: var(--mc-size-popover)"
  >
    <p class="text-sm font-medium">Notifications</p>

    {#if unreadable}
      <p class="text-sm text-text-muted">Your notifications could not be read just now.</p>
    {:else if items === null}
      <p class="text-sm text-text-muted">Reading your notifications.</p>
    {:else if items.length === 0}
      <p class="text-sm text-text-muted">No Results</p>
    {:else}
      <NotificationRows items={items} onOpen={(item) => void follow(item)} compact />
      {#if unreadNotificationCount.unread > items.length}
        <p class="text-xs text-text-muted">
          {unreadNotificationCount.unread - items.length} more waiting.
        </p>
      {/if}
    {/if}

    <a
      href="/notifications"
      class="text-sm font-medium"
      style="color: var(--mc-accent-default)"
      onclick={() => (open = false)}
    >
      Open Notifications
    </a>
  </Popover.Content>
</Popover.Root>

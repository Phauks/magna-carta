<script lang="ts">
  /*
   * The assembled App Shell — the only fixed chrome (page-archetypes Layout A): the ink sidebar
   * (brand corner + the destination registry through the member's visibility layer) and the TopBar
   * framing a light, calm routed canvas. The design system owns the parts; THIS composition,
   * the registry filtering, and the palette wiring are the app's domain knowledge.
   *
   * THE SIDEBAR IS THE MEMBER'S: it renders pinned + shown destinations in the member's
   * per-group order (sidebar-preferences.svelte.ts — hiding governs the sidebar ONLY; the palette
   * always carries everything). Customize turns the rail INTO an editing canvas in place: it
   * forces itself expanded and reveals every destination grouped — the shown rows first (each
   * with a grip, draggable to reorder, live-reflow preview) then the hidden ones (a click brings
   * them back). A destination newly arrived in the sidebar carries a one-time gilt-draw highlight
   * so the eye catches where reconciliation seated it.
   *
   * THREE MARKS, AND EACH ANSWERS A DIFFERENT QUESTION (owner ruling, 2026-09-16). The EYE says
   * whether a destination the platform ships appears in its group — Customize's own control. The
   * STAR says the member made this a FAVOURITE, and the favourites lead the rail as their own
   * group: any address at all, saved from that screen's own header, which is how a matter or a
   * section deep inside one gets a seat the registry could never have declared. A LOCK says a row
   * is not the member's to move.
   *
   * A GROUP MAY FOLD, AND SO MAY A CLUSTER INSIDE IT. The rail's second level is the cluster
   * (navigation/clusters.ts): a row with a chevron whose members tuck beneath it, which is how
   * nine tools read as four. Pressing a cluster opens it — it is never a screen, and nothing is
   * reached THROUGH one. The collapsed icon rail draws every row flat, folds and all, because a
   * rail with no labels has nothing to fold by.
   *
   * THE FOOT OF THE RAIL IS THE UTILITY TRAY — a compact icon cluster of the things that are
   * ABOUT the app rather than places in the firm's work. It has two ends (owner-directed): the
   * rail's own controls at the inline start (Settings, then Customize), and the two transfer
   * registers (Downloads and Uploads) leaning to the inline end. Downloads and Uploads live here
   * rather than in the My Desk group because they run alongside whatever is on screen, often
   * both at once; they lean away from the rail's controls because they are the two things in the
   * tray you actually navigate to. The top-bar trays keep their own job — a summary with quick
   * actions; these open the full surfaces. Collapse and Customize remain RAIL CONTROLS, not
   * destinations.
   *
   * THE TOP BAR HOLDS ONE OPEN PANEL AT A TIME (owner correction, 2026-09-18). The build report,
   * the notifications, the two transfer registers and the account menu all open over the same work
   * canvas from controls a few pixels apart, so pressing one closes whichever other was open. The
   * rule is the bar's, not each tray's: TopBar.Root declares itself an overlay band and every
   * popover and menu seated in it hands its place on. The shell wires nothing for it.
   *
   * Top-bar seams stay seams: +New renders nothing until its slice ships — the Actions region
   * reserves its geometry; the shell never fakes function. The notification bell is live and owns
   * itself ($lib/notifications/notification-tray.svelte): a real unread count and the newest few
   * items behind it. The Time Sheet's handle is live too: it reads the firm's timer, and opens the
   * firm-wide Time Sheet over whatever is on screen.
   */
  import { page } from "$app/state";
  import { installCanvasScrollRestoration } from "$lib/navigation/canvas-scroll-restoration.ts";
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import * as Sidebar from "@magna-carta/design-system/sidebar";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import * as TopBar from "@magna-carta/design-system/top-bar";
  import { isPaletteChord } from "@magna-carta/design-system/internal/platform";
  import Check from "@lucide/svelte/icons/check";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import Lock from "@lucide/svelte/icons/lock";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import Star from "@lucide/svelte/icons/star";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import BugReportDialog from "$lib/components/bug-report-dialog.svelte";
  import { issueReport } from "$lib/components/issue-report.svelte.ts";
  import TimeKeeperChip from "$lib/time/time-keeper-chip.svelte";
  import VersionChip from "$lib/versions/version-chip.svelte";
  import { MaturityBadge, MaturityDot } from "@magna-carta/design-system/maturity";
  import DownloadTray from "$lib/export/download-tray.svelte";
  import UploadTray from "$lib/file-manager/upload-tray.svelte";
  import NotificationTray from "$lib/notifications/notification-tray.svelte";
  import ProfileMenu from "$lib/components/profile-menu.svelte";
  import { DragReorderController } from "$lib/components/drag-reorder.svelte.ts";
  import {
    DESTINATIONS,
    destinationStage,
    isCurrentDestination,
    type Destination,
  } from "$lib/navigation/destinations.ts";
  import { SEARCH_PLACEHOLDER } from "$lib/navigation/search.ts";
  import {
    acknowledgeArrival,
    expandSidebarOnHover,
    isClusterCollapsed,
    isGroupCollapsed,
    isNewArrival,
    moveDestination,
    setShown,
    sidebarEditingGroups,
    sidebarGroups,
    toggleClusterCollapsed,
    toggleGroupCollapsed,
    type SidebarEditingGroupView,
    type SidebarGroupView,
    type SidebarNode,
  } from "$lib/navigation/sidebar-preferences.svelte.ts";
  import { favoritePathFromRowId } from "$lib/navigation/favorites.svelte.ts";
  import { developerPreferences } from "$lib/settings/developer-preferences.svelte.ts";
  import { applyStaticSkeletons, readStaticSkeletons } from "$lib/developer/static-skeletons.ts";
  import { SETTLED_EVENT, type LoadingSettledDetail } from "@magna-carta/design-system/loading-region";
  import { record } from "$lib/diagnostics/breadcrumbs.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  // The work canvas — the shell's only scroll region. SvelteKit resets scroll by moving the
  // WINDOW, which never scrolls here, so without this the canvas keeps the previous page's offset.
  // This resets it to the top on a forward navigation and restores the saved offset on
  // back/forward, keyed per history entry. Registered during init (the getter defers reading the
  // element until a navigation fires, by which point bind:this has populated it).
  let canvas: HTMLElement | undefined = $state();
  installCanvasScrollRestoration(() => canvas);

  // Dev-only: re-assert the "static loading placeholders" preference on every load, so a page set
  // to freeze its skeletons stays frozen across reloads without opening the console. Compiled out
  // of production (the import.meta.env.DEV branch is statically dead there).
  $effect(() => {
    if (import.meta.env.DEV) {
      applyStaticSkeletons(readStaticSkeletons());
    }
  });

  // Every loading region reports how long its read took, as a bubbling event with the region's
  // sentence (a shape, never a value) and the milliseconds. The shell is the one listener: it
  // records a breadcrumb, so a report says which reads a member waited on and for how long, and
  // the User Timing entry the region also writes is what a profile shows. No screen wires this.
  function onLoadingSettled(event: Event): void {
    const detail = (event as CustomEvent<LoadingSettledDetail>).detail;
    if (detail === undefined) return;
    record("loading", `${detail.label} · ${detail.milliseconds} ms${detail.failed ? " · failed" : ""}`);
  }
  // A custom event's name cannot be written as a markup attribute, so the listener is attached
  // here rather than on <svelte:window>.
  $effect(() => {
    window.addEventListener(SETTLED_EVENT, onLoadingSettled);
    return () => window.removeEventListener(SETTLED_EVENT, onLoadingSettled);
  });

  let collapsed = $state(false);
  // Whether the collapsed rail is currently hover-peeked open (component-owned; the shell reads it
  // so a maturity dot yields to the label badge while the rail is peeked wide).
  let peeking = $state(false);
  let paletteOpen = $state(false);
  let customizing = $state(false);
  let moveAnnouncement = $state("");

  const groups = $derived(sidebarGroups());

  /**
   * What a group draws. Expanded, its folded tree — rows and clusters. In the collapsed icon rail,
   * every row flat: the rail has no visible labels, so a cluster there would be a chevron with no
   * name hiding rows behind it, and the member's folds are waiting when it opens again.
   */
  function railNodes(group: SidebarGroupView): readonly SidebarNode[] {
    if (!railCollapsed) return group.nodes;
    return group.destinations.map((destination) => ({ kind: "row", destination }) as const);
  }
  const editingGroups = $derived(sidebarEditingGroups());
  const hoverExpand = $derived(expandSidebarOnHover());

  /*
   * THE ICON RAIL CANNOT FOLD. A folded group is a heading with its rows tucked under it, and the
   * collapsed rail has no visible heading — folding there would leave a column of icons with
   * nothing to say why the rest are missing and nothing to press to bring them back. So the rail
   * shows every group whole, and the member's folds are waiting when it opens again.
   */
  const railCollapsed = $derived(collapsed && !peeking);

  // "Expand on hover" makes the rail REST collapsed and float open on hover, so whenever the
  // preference is on (and we are not customizing, which needs the rail expanded to arrange) the
  // resting state is forced collapsed. The peek is separate component state, so it floats the
  // rail open without touching `collapsed`; the manual collapse control is hidden while the
  // preference governs the rail. Turning the preference off leaves the rail wherever it sits.
  $effect(() => {
    if (hoverExpand && !customizing) collapsed = true;
  });

  /*
   * The footer utility tray's two ends, read from the registry's footer fixtures so each row has
   * one home. The membership of each end is stated here rather than derived, because it is a fact
   * about the tray and not about the registry: SETTINGS LEADS the row (it is the one icon the
   * collapsed rail keeps — sidebar.css hides the rest at rail width) and the transfer registers
   * lean to the far end.
   */
  function footerFixture(id: string): Destination {
    return DESTINATIONS.find((destination) => destination.id === id) as Destination;
  }
  const footerLeading = footerFixture("settings");
  const footerTrailing = ["downloads", "uploads"].map((id) => footerFixture(id));
  const LeadingIcon = footerLeading.icon;

  const drag = new DragReorderController();

  /*
   * Arrival acknowledgment: a newly arrived row keeps its gilt highlight long enough to be
   * seen, then is recorded as known so the draw plays exactly once. Scheduled per id (the
   * effect re-runs as groups change; the set keeps timers single).
   */
  const scheduledArrivals = new Set<string>();
  $effect(() => {
    for (const group of groups) {
      for (const destination of group.destinations) {
        if (!isNewArrival(destination.id) || scheduledArrivals.has(destination.id)) continue;
        scheduledArrivals.add(destination.id);
        setTimeout(() => acknowledgeArrival(destination.id), 4000);
      }
    }
  });

  function toggleCustomize(): void {
    customizing = !customizing;
    // Arranging needs the labels (and the collapsed rail's tooltip wrapper owns pointer events
    // that would swallow the drag), so entering edit forces the rail expanded. The `editing`
    // prop then widens it and blocks the hover peek.
    if (customizing) collapsed = false;
  }

  // The drag operates over the shown tier only — the reorderable rows. Home holds index 0 of
  // its group and never moves; the controller clamps the drop to keep it there.
  function beginDrag(
    event: PointerEvent,
    group: SidebarEditingGroupView,
    destination: Destination,
  ): void {
    if (destination.id === "home") return; // fixed leader — never dragged
    // The row is the handle, so the press arrives here from anywhere on it — including the eye, the
    // star and the lock at its end, which are pressed to ACT rather than to move. They are let out
    // by target rather than by stopping the event on each one, so a control added to the row later
    // is covered without remembering to.
    const target = event.target as HTMLElement | null;
    if (target !== null && target.closest(".mc-sidebar-row-control") !== null) return;
    const ids = group.shown.map((candidate) => candidate.id);
    drag.start(
      event,
      destination.id,
      ids,
      (id, toIndex) => moveDestination(group.id, id, toIndex),
      ids[0] === "home" ? 1 : 0,
    );
  }

  // The keyboard half of reorder: a focused row moves one slot per Alt+Arrow press (a bare arrow
  // must keep meaning "move focus"). The keyed list moves the DOM node, so focus rides along; the
  // live region narrates the landing.
  function onEditKeydown(
    event: KeyboardEvent,
    group: SidebarEditingGroupView,
    destination: Destination,
  ): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    if (destination.id === "home") return;
    event.preventDefault();
    const ids = group.shown.map((candidate) => candidate.id);
    const fromIndex = ids.indexOf(destination.id);
    moveDestination(group.id, destination.id, fromIndex + (event.key === "ArrowUp" ? -1 : 1));
    const updated = sidebarEditingGroups().find((candidate) => candidate.id === group.id);
    const landedIndex =
      updated?.shown.findIndex((candidate) => candidate.id === destination.id) ?? -1;
    if (landedIndex !== -1 && updated !== undefined) {
      moveAnnouncement = `${destination.label} moved to position ${landedIndex + 1} of ${updated.shown.length}`;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!isPaletteChord(event)) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    paletteOpen = !paletteOpen;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!--
  ONE ROW, DRAWN ONCE. A destination renders identically whether it sits directly in a group or
  inside a cluster's sub-menu, so the snippet is defined here and rendered at both levels rather
  than the markup existing twice and drifting the first time either is corrected.
-->
{#snippet railRow(destination: Destination)}
  {@const Icon = destination.icon}
  {@const current = isCurrentDestination(destination, page.url.pathname)}
  <Sidebar.MenuItem>
    {#if destination.shipped}
      <Sidebar.MenuButton
        href={destination.href}
        tooltip={destination.label}
        isActive={current}
        class="relative"
        aria-current={current ? "page" : undefined}
        data-arrived={isNewArrival(destination.id) ? "true" : undefined}
      >
        {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
        {destination.label}
        <!-- Collapsed icon rail: the badge's label is hidden with the trailing column, so a dot of
             the same colour carries the stage over the icon. -->
        {#if collapsed && !peeking}
          <MaturityDot stage={destinationStage(destination)} class="absolute end-4 top-4" />
        {/if}
        <!-- The badge rides the row's own trailing column, which never shrinks: a long label
             ellipses and the mark stays. Inside the label it was clipped off every long row —
             "Property Listing Links" hid its Soon mark entirely (owner report, 2026-09-16). -->
        {#snippet trailing()}
          <MaturityBadge stage={destinationStage(destination)} />
        {/snippet}
      </Sidebar.MenuButton>
    {:else}
      <!-- An announced Soon row: no destination yet, so no href and disabled — honest about not
           existing. The badge rides the trailing slot (both hide in the collapsed rail, where the
           tooltip carries the truth instead and the un-navigable muted icon is the Soon
           treatment). -->
      <Sidebar.MenuButton
        disabled
        tooltip="{destination.label} — coming soon"
        class="relative cursor-default"
        data-arrived={isNewArrival(destination.id) ? "true" : undefined}
      >
        {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
        {destination.label}
        {#if collapsed && !peeking}
          <MaturityDot stage={destinationStage(destination)} class="absolute end-4 top-4" />
        {/if}
        {#snippet trailing()}
          <MaturityBadge stage={destinationStage(destination)} />
        {/snippet}
      </Sidebar.MenuButton>
    {/if}
  </Sidebar.MenuItem>
{/snippet}

<div class="flex h-screen overflow-hidden bg-surface-default">
  <Sidebar.Root
    bind:collapsed
    bind:peeking
    editing={customizing}
    expandOnHover={hoverExpand}
    aria-label="Primary"
  >
    <Sidebar.Header>
      <!-- The universal convention: the mark goes home. Chrome identity, not a menu row, so
           the treatment stays quiet — the pointer cursor and focus ring say "link", nothing
           louder. The collapsed rail keeps the mark alone clickable (the wordmark hides by
           color inside BrandMark; the anchor's box remains). -->
      <a href="/home" aria-label="Magna Carta — Home" class="rounded-md">
        <BrandMark />
      </a>
    </Sidebar.Header>
    <Sidebar.Content>
      {#if customizing}
        {#each editingGroups as group (group.id)}
          <Sidebar.Group>
            <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
            <Sidebar.Menu>
              <!-- Tier one: what is in your sidebar now — each row gripped and draggable to
                   reorder, with a live reflow preview (the other rows shift to open the gap at the
                   projected drop). Pinned rows show a lock; a favourite shows the gold star that
                   gives the shortcut back; everything else the open eye that hides it. -->
              {#each group.shown as destination (destination.id)}
                {@const Icon = destination.icon}
                {@const dragging = drag.draggingId === destination.id}
                {@const shift = dragging ? drag.offsetY : drag.rowShift(destination.id)}
                {@const fixed = destination.id === "home"}
                {@const favoritePath = favoritePathFromRowId(destination.id)}
                <Sidebar.MenuItem>
                  <!-- THE WHOLE ROW IS THE HANDLE, and the press is caught here rather than on the
                       label. It sat on the label alone until the owner pressed the grip and nothing
                       happened (2026-09-17): a row that draws a grip and then ignores it is worse
                       than one that draws none, because it answers the question wrongly. Catching
                       the press on the row means the grip, the glyph, the name and the badge all
                       start the drag; `beginDrag` lets the trailing control out, since that is the
                       one thing on the row somebody presses to act rather than to move.

                       It is `role="presentation"` because that is what it is: a layout box. The
                       pointer drag is one of two ways to move a row and the only one a mouse can
                       take; the accessible path is the button inside, which keeps its own role,
                       its `aria-roledescription` and the Alt+Arrow it announces. Nothing about the
                       row is reachable only by dragging it. -->
                  <div
                    class="mc-sidebar-edit-row flex touch-none select-none items-center gap-4 rounded-md {fixed
                      ? 'cursor-not-allowed'
                      : 'cursor-grab'} {dragging
                      ? 'relative z-sticky bg-chrome-surface shadow-elevation-2'
                      : 'transition-transform duration-fast ease-standard motion-reduce:transition-none'}"
                    style="transform: translateY({shift}px)"
                    data-dragging={dragging ? "true" : undefined}
                    data-reorder-row
                    onpointerdown={(event) => beginDrag(event, group, destination)}
                    role="presentation"
                  >
                    <!-- THE GRIP — the affordance, not a second control: it carries no handler and
                         no tab stop of its own, because the row above it already takes the press. -->
                    <span class="mc-sidebar-grip" data-fixed={fixed ? "true" : undefined} aria-hidden="true">
                      <GripVertical class="size-16" />
                    </span>
                    <Sidebar.MenuButton
                      aria-roledescription="Reorderable sidebar destination"
                      aria-label="{destination.label} — Alt plus Arrow Up or Arrow Down moves it"
                      aria-disabled={fixed ? "true" : undefined}
                      data-arrived={isNewArrival(destination.id) ? "true" : undefined}
                      onkeydown={(event) => onEditKeydown(event, group, destination)}
                    >
                      {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                      {destination.label}
                      {#snippet trailing()}
                        <MaturityBadge stage={destinationStage(destination)} />
                      {/snippet}
                    </Sidebar.MenuButton>
                    {#if favoritePath !== null}
                      <button
                        type="button"
                        class="mc-sidebar-row-control"
                        data-starred="true"
                        aria-pressed="true"
                        aria-label="Remove {destination.label} from your favorites"
                        onclick={() => setShown(destination.id, false)}
                      >
                        <Star class="size-16 fill-current" aria-hidden="true" />
                      </button>
                    {:else if destination.pinned === true}
                      <span
                        class="mc-sidebar-row-control"
                        data-locked="true"
                        title="Always in your sidebar"
                      >
                        <Lock class="size-16" aria-hidden="true" />
                        <span class="sr-only">{destination.label} is always in your sidebar</span>
                      </span>
                    {:else}
                      <button
                        type="button"
                        class="mc-sidebar-row-control"
                        data-shown="true"
                        aria-pressed="true"
                        aria-label="Hide {destination.label} from your sidebar"
                        onclick={() => setShown(destination.id, false)}
                      >
                        <Eye class="size-16" aria-hidden="true" />
                      </button>
                    {/if}
                  </div>
                </Sidebar.MenuItem>
              {/each}
              {#if group.shown.length > 0 && group.hidden.length > 0}
                <li class="mc-sidebar-edit-divider" role="presentation"></li>
              {/if}
              <!-- Tier two: hidden destinations — a click (row or struck-through eye) brings them
                   back, where they rise to the shown tier at their canonical position. -->
              {#each group.hidden as destination (destination.id)}
                {@const Icon = destination.icon}
                <Sidebar.MenuItem>
                  <div class="mc-sidebar-edit-row flex items-center gap-4 rounded-md">
                    <!-- No grip: a hidden row has no place in the order to be moved within. The
                         span keeps the two tiers on one leading edge. -->
                    <span class="mc-sidebar-grip" data-fixed="true" aria-hidden="true"></span>
                    <Sidebar.MenuButton
                      class="cursor-pointer"
                      aria-label="Show {destination.label} in your sidebar"
                      onclick={() => setShown(destination.id, true)}
                    >
                      {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                      {destination.label}
                      {#snippet trailing()}
                        <MaturityBadge stage={destinationStage(destination)} />
                      {/snippet}
                    </Sidebar.MenuButton>
                    <button
                      type="button"
                      class="mc-sidebar-row-control"
                      data-shown="false"
                      aria-pressed="false"
                      aria-label="Show {destination.label} in your sidebar"
                      onclick={() => setShown(destination.id, true)}
                    >
                      <EyeOff class="size-16" aria-hidden="true" />
                    </button>
                  </div>
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          </Sidebar.Group>
        {/each}
      {:else}
        {#each groups as group (group.id)}
          {@const folded = !railCollapsed && isGroupCollapsed(group.id)}
          <Sidebar.Group>
            {#if railCollapsed}
              <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
            {:else}
              <!-- The heading folds the group away. It is the heading, not a control beside one:
                   same voice, same seat, a chevron and the whole width as its target. Folding is
                   the sidebar's, never the palette's — every destination in a folded group is
                   still one Ctrl+K away, the same invariant the visibility layer keeps. -->
              <Sidebar.GroupTrigger
                expanded={!folded}
                aria-label={folded ? `Show ${group.label}` : `Hide ${group.label}`}
                onclick={() => toggleGroupCollapsed(group.id)}
              >
                {group.label}
              </Sidebar.GroupTrigger>
            {/if}
            {#if !folded}
              <Sidebar.Menu>
                <!-- The collapsed icon rail draws every row FLAT — a rail with no labels has
                     nothing to fold by, so a cluster there would be a chevron with no name and a
                     column of icons with no way back. The folds are waiting when it opens. -->
                {#each railNodes(group) as node (node.kind === "cluster" ? `cluster-${node.id}` : node.destination.id)}
                  {#if node.kind === "cluster"}
                    {@const ClusterIcon = node.icon}
                    {@const open = !isClusterCollapsed(node.id)}
                    {@const holdsCurrent = node.rows.some((row) => isCurrentDestination(row, page.url.pathname))}
                    <Sidebar.MenuItem>
                      <Sidebar.MenuTrigger
                        expanded={open}
                        tooltip={node.label}
                        data-holds-current={holdsCurrent ? "true" : undefined}
                        aria-label={open ? `Hide ${node.label}` : `Show ${node.label}`}
                        onclick={() => toggleClusterCollapsed(node.id)}
                      >
                        {#snippet icon()}<ClusterIcon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                        {node.label}
                      </Sidebar.MenuTrigger>
                      {#if open}
                        <Sidebar.MenuSub>
                          {#each node.rows as destination (destination.id)}
                            {@render railRow(destination)}
                          {/each}
                        </Sidebar.MenuSub>
                      {/if}
                    </Sidebar.MenuItem>
                  {:else}
                    {@render railRow(node.destination)}
                  {/if}
                {/each}
              </Sidebar.Menu>
            {/if}
          </Sidebar.Group>
        {/each}
      {/if}
    </Sidebar.Content>
    <Sidebar.Footer>
      <!-- Keyboard reorders narrate here (polite: never steals focus from the row). -->
      <span class="sr-only" role="status">{moveAnnouncement}</span>
      <!-- The utility tray, in two ends (owner-directed). The rail's own controls lead:
           Settings first — a real link, so it stays the one visible icon when the rail
           collapses — then Customize. The two transfer registers lean to the far end, away
           from the controls, because they are the things in this row you navigate to. -->
      <div class="mc-sidebar-controls">
        <a
          href={footerLeading.href}
          class="mc-sidebar-control-button relative"
          title={footerLeading.label}
          aria-label={footerLeading.label}
          aria-current={isCurrentDestination(footerLeading, page.url.pathname) ? "page" : undefined}
          data-active={isCurrentDestination(footerLeading, page.url.pathname) ? "true" : undefined}
        >
          <LeadingIcon class="mc-sidebar-icon" aria-hidden="true" />
          <MaturityDot stage={destinationStage(footerLeading)} class="absolute end-4 top-4" />
        </a>
        <Tooltip.Root>
          <Tooltip.Trigger
            class="mc-sidebar-control-button relative"
            aria-pressed={customizing}
            aria-label={customizing ? "Done customizing sidebar" : "Customize sidebar"}
            onclick={toggleCustomize}
          >
            {#if customizing}
              <Check class="mc-sidebar-icon" aria-hidden="true" />
            {:else}
              <SlidersHorizontal class="mc-sidebar-icon" aria-hidden="true" />
            {/if}
            <!-- The adjustment cluster is itself still maturing; a dot marks it where a label
                 won't fit. -->
            <MaturityDot stage="alpha" class="absolute end-4 top-4" />
          </Tooltip.Trigger>
          <Tooltip.Content side="top">{customizing ? "Done" : "Customize"}</Tooltip.Content>
        </Tooltip.Root>
        <!-- One element, so the collapsed rail's "everything past the first icon goes" rule
             takes the pair away and brings it back whole. -->
        <div class="mc-sidebar-controls-trailing">
          {#each footerTrailing as destination (destination.id)}
            {@const Icon = destination.icon}
            {@const active = isCurrentDestination(destination, page.url.pathname)}
            <a
              href={destination.href}
              class="mc-sidebar-control-button relative"
              title={destination.label}
              aria-label={destination.label}
              aria-current={active ? "page" : undefined}
              data-active={active ? "true" : undefined}
            >
              <Icon class="mc-sidebar-icon" aria-hidden="true" />
              <MaturityDot stage={destinationStage(destination)} class="absolute end-4 top-4" />
            </a>
          {/each}
        </div>
      </div>
      <!-- Collapse is a primary behaviour, so it keeps a large, full-width labelled control at
           the foot of the rail. When "expand on hover" governs the rail it is redundant (hover
           opens, leaving collapses) and hides. -->
      {#if !hoverExpand}
        <Sidebar.Trigger />
      {/if}
    </Sidebar.Footer>
  </Sidebar.Root>

  <!-- Named so the work canvas resizes as its own view-transition group when the rail
       collapses. It paints the CHROME surface, continuous with the top bar above it and the
       sidebar beside it — one unbroken ink band with no hairline (the surface contrast is the
       edge; see sidebar.css). The light work surface and the rounded top-inline-start corner
       live on <main> below, which tucks under this chrome; what shows in the corner's arc is
       this chrome. This div stays RECTANGULAR and full-bleed on purpose: rounding it would make
       the mc-app-canvas snapshot non-rectangular, and animations.css records that clipping the
       canvas pair once exposed a one-device-pixel column where the root's light page background
       showed through the dark header, flashing a white line on every collapse/expand/peek. It
       also paints its OWN opaque surface: the collapse animation layers the old and new canvas
       snapshots without a crossfade, so a transparent-background snapshot would let the outgoing
       text show through the incoming one (the owner caught the double-exposure). -->
  <div
    class="flex grow flex-col overflow-hidden bg-chrome-surface"
    style="view-transition-name: mc-app-canvas"
  >
    <TopBar.Root>
      <!-- Rest state reads just "Search…" (owner-directed): the keyboard hints moved INTO the
           open palette's input row, shown only while the query is empty. The search rides the
           canvas, so it tracks the rail's edge on collapse AND on the hover peek (which expands
           the rail for real) with no extra wiring. -->
      <TopBar.Search class="max-w-md grow" onclick={() => (paletteOpen = true)}>
        {SEARCH_PLACEHOLDER}
      </TopBar.Search>
      <TopBar.Actions>
        <!-- The version chip — always-visible build identity (the owner's "what version am I
             on" answer). The chip is this build's own commit, baked in at build time, so it
             renders even when the API is down; its overlay reads the aggregate version
             endpoint and reports every part honestly.

             IT LEADS THE ACTIONS CLUSTER, to the inline-start of the bell, the timer and the
             profile menu (owner correction, 2026-08-29: "put build versions to the left of
             those buttons"). The signed-out frame ($lib/auth/auth-frame.svelte) seats it by the
             same rule, so the chip does not move when a visitor signs in. -->
        <VersionChip />
        <!-- The notification bell. Its own component, like the download and upload trays beside
             it: the badge, the tray's read and the settle-on-follow are one subject, and the shell
             stays a shell. -->
        <NotificationTray />
        <!-- The Time Sheet's handle: a tabular elapsed readout that reads the firm's timer, and
             opens the sheet over whatever is on screen, firm-wide, because capture must never
             cost a person the place they were working. It wears the same quiet chrome as the
             tray and the bell beside it — no border of its own — because three controls sitting
             in one band and one of them boxed reads as a control of a different kind. Its
             anatomy and every read it makes belong to the Time surface
             ($lib/time/time-keeper-chip.svelte); the shell seats it and does nothing else with it. -->
        <TimeKeeperChip />
        <!-- The upload tray: what this member is SENDING, seated ahead of what the platform made
             for them. A transfer outlives the panel that started it (the upload queue,
             $lib/file-manager/upload-queue.svelte.ts), so this is where it shows its progress, its
             failures and the way to the folder it landed in while the reader works elsewhere. Its
             anatomy belongs to the file surface ($lib/file-manager/upload-tray.svelte); the
             shell seats it and does nothing else with it. -->
        <UploadTray />
        <!-- The download tray, seated beside the Time Sheet's handle on the owner's direction: what the
             platform has made for this member, reachable from the top of the app rather than only
             from the sidebar row. Clicking it gives the overview and offers the full register at
             the bottom. Deliberately NOT a transfer manager — bytes move over a presigned URL the
             browser's own download manager drives, so there is no progress here to show. Its
             anatomy and every read it makes belong to the export surface
             ($lib/export/download-tray.svelte); the shell seats it and does nothing else with it. -->
        <DownloadTray />
        {#if import.meta.env.DEV && developerPreferences.developerSettingsEnabled && developerPreferences.developerToolkitInHeader}
          <!-- The developer console (modular tooling; motion tuning first). The dynamic import
               inside a DEV-gated branch keeps every byte of it out of production bundles.
               The preference gates (Settings · Developer) are live: switching them off
               removes the console without a reload. -->
          {#await import("$lib/developer/developer-console.svelte") then developerConsoleModule}
            {@const DeveloperConsole = developerConsoleModule.default}
            <DeveloperConsole />
          {/await}
        {/if}
        <ProfileMenu />
      </TopBar.Actions>
    </TopBar.Root>

    <!-- The work canvas — the single scroll region every page renders into. It scrolls
         vertically; it never scrolls horizontally, so no page can grow a phantom sideways
         scrollbar. Content wider than the canvas (data tables, wide diagrams) carries its own
         overflow-x container and scrolls within itself (e.g. the design-system table's
         mc-table-scroll wrapper) — the page body stays put. scrollbar-gutter: stable always
         reserves the vertical scrollbar's track, so a short (no-scroll) page and a long
         (scrolling) page frame their content at the exact same width — no reflow on navigation.
         `relative` makes the canvas the containing block for absolutely positioned descendants:
         without it a screen-reader-only element (Tailwind's sr-only is position: absolute) deep
         in a tall page resolves against the document instead, lands at its table's document-y
         coordinate past the shell's height, and stretches the WINDOW scrollable — a second
         scrollbar outside the canvas with bare page background beneath the shell.
         `flex flex-col` because the canvas LAYS ITS CHILDREN OUT rather than stacking them as
         blocks: a two-sided screen (settings, the calendar, Magnus) sizes itself to the whole
         canvas, and as a block child it kept that height whatever stood above it — so the
         platform notice, rendered above every page, pushed it past the bottom edge by exactly the
         notice's height and the canvas grew a third scrollbar beside the layout's two. As a flex
         item with no minimum it shrinks under the notice instead. Ordinary pages stack in the
         column exactly as they stacked as blocks; the page-inset lint reads this class list and
         keeps its rules honest to it. -->
    <main
      bind:this={canvas}
      class="mc-scrollbar relative flex grow flex-col overflow-x-hidden overflow-y-auto rounded-ss-lg bg-surface-default p-24 [scrollbar-gutter:stable]"
    >
      {@render children()}
    </main>
  </div>
</div>

{#if import.meta.env.DEV && developerPreferences.developerSettingsEnabled && developerPreferences.buildStampOverlayVisible}
  <!-- The build-stamp overlay: a fixed dev-only badge (live clock + this build's identity),
       draggable between the screen corners. The dynamic import inside a DEV-gated branch keeps
       every byte of it out of production bundles; the preference gates (Settings · Developer)
       are live, so toggling it off removes the badge without a reload. -->
  {#await import("$lib/developer/build-stamp-overlay.svelte") then buildStampOverlayModule}
    {@const BuildStampOverlay = buildStampOverlayModule.default}
    <BuildStampOverlay />
  {/await}
{/if}

<CommandPalette bind:open={paletteOpen} sidebarCollapsed={collapsed} />

<!-- The issue reporter, mounted ONCE for the whole signed-in app. Every door into it — the profile
     menu, the command palette, the Build Information panel — is a surface that closes as it opens
     the dialog, and a dialog parented to one of those goes down with it (see
     $lib/components/issue-report.svelte.ts). The shell outlives all three, so it holds the dialog
     and they hold nothing but the gesture. -->
<BugReportDialog bind:open={issueReport.isOpen} deployment={issueReport.deployment} />

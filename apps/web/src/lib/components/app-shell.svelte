<script lang="ts">
  /*
   * The assembled App Shell — the only fixed chrome (page-archetypes Layout A): the ink sidebar
   * (brand corner + the destination registry through the member's STAR layer) and the TopBar
   * framing a light, calm routed canvas. The design system owns the parts; THIS composition,
   * the registry filtering, and the palette wiring are the app's domain knowledge.
   *
   * THE SIDEBAR IS THE MEMBER'S: it renders pinned + starred destinations in the member's
   * per-group order (sidebar-preferences.svelte.ts — stars govern the sidebar ONLY; the palette
   * always carries everything). Customize turns the rail INTO an editing canvas in place: it
   * widens, forces itself expanded, and reveals every destination grouped — the starred rows
   * first (draggable to reorder, live-reflow preview) then the hidden ones (a click adds them
   * back). A destination newly arrived in the sidebar carries a one-time gilt-draw highlight so
   * the eye catches where reconciliation seated it.
   *
   * THE FOOT OF THE RAIL IS THE UTILITY TRAY — a compact icon cluster of the things that are
   * ABOUT the app rather than places in the firm's work: Settings, then the two transfer
   * registers (Downloads and Uploads), then Customize and Collapse. Downloads and Uploads live
   * here by owner direction (2026-09-07) rather than in the Workspace group: they run alongside
   * whatever is on screen, often both at once, so they belong with the app's own controls. The
   * top-bar trays keep their own job — a summary with quick actions; these open the full
   * surfaces. Collapse and Customize remain RAIL CONTROLS, not destinations.
   *
   * Top-bar seams stay seams: +New renders nothing until its slice ships — the Actions region
   * reserves its geometry; the shell never fakes function. The notification bell IS a real (if
   * empty) surface — its honesty is the empty state, not a badge. The Time Sheet's handle is live: it
   * reads the firm's timer, and opens the firm-wide Time Sheet over whatever is on screen.
   */
  import { page } from "$app/state";
  import { installCanvasScrollRestoration } from "$lib/navigation/canvas-scroll-restoration.ts";
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Sidebar from "@magna-carta/design-system/sidebar";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import * as TopBar from "@magna-carta/design-system/top-bar";
  import { isPaletteChord } from "@magna-carta/design-system/internal/platform";
  import Bell from "@lucide/svelte/icons/bell";
  import Check from "@lucide/svelte/icons/check";
  import Lock from "@lucide/svelte/icons/lock";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import Star from "@lucide/svelte/icons/star";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import TimeKeeperChip from "$lib/time/time-keeper-chip.svelte";
  import VersionChip from "$lib/versions/version-chip.svelte";
  import { MaturityBadge, MaturityDot } from "@magna-carta/design-system/maturity";
  import DownloadTray from "$lib/export/download-tray.svelte";
  import UploadTray from "$lib/file-manager/upload-tray.svelte";
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
    isNewArrival,
    moveDestination,
    setStarred,
    sidebarEditingGroups,
    sidebarGroups,
    type SidebarEditingGroupView,
  } from "$lib/navigation/sidebar-preferences.svelte.ts";
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
  let notificationsOpen = $state(false);
  let customizing = $state(false);
  let moveAnnouncement = $state("");

  const groups = $derived(sidebarGroups());
  const editingGroups = $derived(sidebarEditingGroups());
  const hoverExpand = $derived(expandSidebarOnHover());

  // "Expand on hover" makes the rail REST collapsed and float open on hover, so whenever the
  // preference is on (and we are not customizing, which needs the rail expanded to arrange) the
  // resting state is forced collapsed. The peek is separate component state, so it floats the
  // rail open without touching `collapsed`; the manual collapse control is hidden while the
  // preference governs the rail. Turning the preference off leaves the rail wherever it sits.
  $effect(() => {
    if (hoverExpand && !customizing) collapsed = true;
  });

  /*
   * The footer utility tray, read from the registry's footer fixtures so each row has one home.
   * The order is stated here rather than taken from the registry's canonical order because
   * SETTINGS LEADS: it is the one icon the collapsed rail keeps (sidebar.css hides the rest at
   * rail width), and the registry orders by where a destination sits in the app, not by which
   * icon survives a collapse.
   */
  const FOOTER_TRAY_IDS = ["settings", "downloads", "uploads"];
  const footerTray = FOOTER_TRAY_IDS.map(
    (id) => DESTINATIONS.find((destination) => destination.id === id) as Destination,
  );

  // The notification bell is the top-bar entry to the Notifications destination, so its maturity
  // dot reads the same stage as that destination's sidebar row.
  const notificationsDestination = DESTINATIONS.find(
    (destination) => destination.id === "notifications",
  ) as Destination;

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

  // The drag operates over the starred tier only — the reorderable rows. Home holds index 0 of
  // its group and never moves; the controller clamps the drop to keep it there.
  function beginDrag(
    event: PointerEvent,
    group: SidebarEditingGroupView,
    destination: Destination,
  ): void {
    if (destination.id === "home") return; // fixed leader — never dragged
    const ids = group.starred.map((candidate) => candidate.id);
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
    const ids = group.starred.map((candidate) => candidate.id);
    const fromIndex = ids.indexOf(destination.id);
    moveDestination(group.id, destination.id, fromIndex + (event.key === "ArrowUp" ? -1 : 1));
    const updated = sidebarEditingGroups().find((candidate) => candidate.id === group.id);
    const landedIndex =
      updated?.starred.findIndex((candidate) => candidate.id === destination.id) ?? -1;
    if (landedIndex !== -1 && updated !== undefined) {
      moveAnnouncement = `${destination.label} moved to position ${landedIndex + 1} of ${updated.starred.length}`;
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

<Tooltip.Provider>
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
                <!-- Tier one: what is in your sidebar now — draggable to reorder, with a live
                     reflow preview (the other rows shift to open the gap at the projected drop).
                     Pinned rows show a lock; the rest a filled gold star that removes them. -->
                {#each group.starred as destination (destination.id)}
                  {@const Icon = destination.icon}
                  {@const dragging = drag.draggingId === destination.id}
                  {@const shift = dragging ? drag.offsetY : drag.rowShift(destination.id)}
                  <Sidebar.MenuItem>
                    <div
                      class="mc-sidebar-edit-row flex items-center gap-8 rounded-md {dragging
                        ? 'relative z-sticky bg-chrome-surface shadow-elevation-2'
                        : 'transition-transform duration-fast ease-standard motion-reduce:transition-none'}"
                      style="transform: translateY({shift}px)"
                    >
                      <Sidebar.MenuButton
                        class="touch-none select-none {destination.id === 'home'
                          ? 'cursor-not-allowed'
                          : 'cursor-grab'}"
                        aria-roledescription="Reorderable sidebar destination"
                        aria-label="{destination.label} — Alt plus Arrow Up or Arrow Down moves it"
                        aria-disabled={destination.id === "home" ? "true" : undefined}
                        data-arrived={isNewArrival(destination.id) ? "true" : undefined}
                        onpointerdown={(event) => beginDrag(event, group, destination)}
                        onkeydown={(event) => onEditKeydown(event, group, destination)}
                      >
                        {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                        {destination.label}
                        <MaturityBadge stage={destinationStage(destination)} class="ms-8" />
                      </Sidebar.MenuButton>
                      {#if destination.pinned === true}
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
                          data-starred="true"
                          aria-pressed="true"
                          aria-label="Remove {destination.label} from your sidebar"
                          onclick={() => setStarred(destination.id, false)}
                        >
                          <Star class="size-16 fill-current" aria-hidden="true" />
                        </button>
                      {/if}
                    </div>
                  </Sidebar.MenuItem>
                {/each}
                {#if group.starred.length > 0 && group.unstarred.length > 0}
                  <li class="mc-sidebar-edit-divider" role="presentation"></li>
                {/if}
                <!-- Tier two: hidden destinations — a click (row or hollow star) adds them back,
                     where they rise to the starred tier at their canonical position. -->
                {#each group.unstarred as destination (destination.id)}
                  {@const Icon = destination.icon}
                  <Sidebar.MenuItem>
                    <div class="mc-sidebar-edit-row flex items-center gap-8 rounded-md">
                      <Sidebar.MenuButton
                        class="cursor-pointer"
                        aria-label="Add {destination.label} to your sidebar"
                        onclick={() => setStarred(destination.id, true)}
                      >
                        {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                        {destination.label}
                        <MaturityBadge stage={destinationStage(destination)} class="ms-8" />
                      </Sidebar.MenuButton>
                      <button
                        type="button"
                        class="mc-sidebar-row-control"
                        data-starred="false"
                        aria-pressed="false"
                        aria-label="Add {destination.label} to your sidebar"
                        onclick={() => setStarred(destination.id, true)}
                      >
                        <Star class="size-16" aria-hidden="true" />
                      </button>
                    </div>
                  </Sidebar.MenuItem>
                {/each}
              </Sidebar.Menu>
            </Sidebar.Group>
          {/each}
        {:else}
          {#each groups as group (group.id)}
            <Sidebar.Group>
              <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
              <Sidebar.Menu>
                {#each group.destinations as destination (destination.id)}
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
                        <!-- Expanded: the labelled badge. Collapsed icon rail: the badge's label is
                             hidden, so a dot of the same colour carries the stage over the icon. -->
                        <MaturityBadge stage={destinationStage(destination)} class="ms-8" />
                        {#if collapsed && !peeking}
                          <MaturityDot
                            stage={destinationStage(destination)}
                            class="absolute end-4 top-4"
                          />
                        {/if}
                      </Sidebar.MenuButton>
                    {:else}
                      <!-- An announced Soon row: no destination yet, so no href and disabled —
                           honest about not existing. The badge rides the label (both hide in the
                           collapsed rail, where the tooltip carries the truth instead and the
                           un-navigable muted icon is the Soon treatment). -->
                      <Sidebar.MenuButton
                        disabled
                        tooltip="{destination.label} — coming soon"
                        class="relative cursor-default"
                        data-arrived={isNewArrival(destination.id) ? "true" : undefined}
                      >
                        {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                        {destination.label}
                        <MaturityBadge stage={destinationStage(destination)} class="ms-8" />
                        {#if collapsed && !peeking}
                          <MaturityDot
                            stage={destinationStage(destination)}
                            class="absolute end-4 top-4"
                          />
                        {/if}
                      </Sidebar.MenuButton>
                    {/if}
                  </Sidebar.MenuItem>
                {/each}
              </Sidebar.Menu>
            </Sidebar.Group>
          {/each}
        {/if}
      </Sidebar.Content>
      <Sidebar.Footer>
        <!-- Keyboard reorders narrate here (polite: never steals focus from the row). -->
        <span class="sr-only" role="status">{moveAnnouncement}</span>
        <!-- The utility tray: the small icon activities that are about the app rather than about
             the firm's work. Settings LEADS (a real link, so it stays the one visible icon when
             the rail collapses), then Downloads and Uploads — the two transfer registers, which
             run concurrently with whatever is on screen — and Customize closes the row. -->
        <div class="mc-sidebar-controls">
          {#each footerTray as destination (destination.id)}
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
          <!-- The notification bell — a real surface with an honest empty state (no fake items,
               no count badge). Its popover states the truth and offers the center; live alerts
               arrive with the notifications machinery. -->
          <Popover.Root bind:open={notificationsOpen}>
            <!-- The hover names the control and nothing else. Every control in this band answers
                 the same question the same way — what is this? — so the four tooltips are four
                 names: Notifications, Time Sheet, Downloads, Build Information. The tooltip and
                 the popover share ONE button through the tooltip trigger's child snippet; two
                 elements would be two controls. -->
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Popover.Trigger
                    {...props}
                    class="mc-top-bar-icon-button relative"
                    aria-label="Notifications"
                  >
                    <Bell class="size-16" aria-hidden="true" />
                    <MaturityDot
                      stage={destinationStage(notificationsDestination)}
                      class="absolute end-4 top-4"
                    />
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
              <p class="text-sm text-text-muted">You're all caught up.</p>
              <p class="text-xs text-text-muted">
                Live notifications arrive with the notifications machinery.
              </p>
              <a
                href="/notifications"
                class="text-sm font-medium"
                style="color: var(--mc-accent-default)"
                onclick={() => (notificationsOpen = false)}
              >
                Open notification center
              </a>
            </Popover.Content>
          </Popover.Root>
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
           scrollbar outside the canvas with bare page background beneath the shell. -->
      <main
        bind:this={canvas}
        class="mc-scrollbar relative grow overflow-x-hidden overflow-y-auto rounded-ss-lg bg-surface-default p-24 [scrollbar-gutter:stable]"
      >
        {@render children()}
      </main>
    </div>
  </div>
</Tooltip.Provider>

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

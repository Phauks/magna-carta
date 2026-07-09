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
   * Collapse and Customize are RAIL CONTROLS, not destinations: they live as a compact icon
   * cluster at the rail's foot (tooltips carry their labels), set apart from Settings — which
   * stays a normal labelled destination row, because it is a place you navigate to.
   *
   * Top-bar seams stay seams: +New and the billable timer render nothing until their slices
   * ship — the Actions region reserves their geometry; the shell never fakes function. The
   * notification bell IS a real (if empty) surface — its honesty is the empty state, not a badge.
   */
  import { page } from "$app/state";
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
  import Timer from "@lucide/svelte/icons/timer";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import MaturityDot from "$lib/maturity/maturity-dot.svelte";
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
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  // Dev-only: re-assert the "static loading placeholders" preference on every load, so a page set
  // to freeze its skeletons stays frozen across reloads without opening the console. Compiled out
  // of production (the import.meta.env.DEV branch is statically dead there).
  $effect(() => {
    if (import.meta.env.DEV) {
      applyStaticSkeletons(readStaticSkeletons());
    }
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
  const settingsActive = $derived(page.url.pathname.startsWith("/settings"));

  // "Expand on hover" makes the rail REST collapsed and float open on hover, so whenever the
  // preference is on (and we are not customizing, which needs the rail expanded to arrange) the
  // resting state is forced collapsed. The peek is separate component state, so it floats the
  // rail open without touching `collapsed`; the manual collapse control is hidden while the
  // preference governs the rail. Turning the preference off leaves the rail wherever it sits.
  $effect(() => {
    if (hoverExpand && !customizing) collapsed = true;
  });

  // The Settings footer fixture from the registry, so the row has one home.
  const settingsDestination = DESTINATIONS.find(
    (destination) => destination.footerPinned === true,
  ) as Destination;
  const SettingsIcon = settingsDestination.icon;

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
        <!-- The utility tray: small icon activities. Settings LEADS (a real link, so it stays the
             one visible icon when the rail collapses), Customize sits beside it, and the row has
             room for more small utilities of the same register later. -->
        <div class="mc-sidebar-controls">
          <a
            href={settingsDestination.href}
            class="mc-sidebar-control-button relative"
            title={settingsDestination.label}
            aria-label={settingsDestination.label}
            aria-current={settingsActive ? "page" : undefined}
            data-active={settingsActive ? "true" : undefined}
          >
            <SettingsIcon class="mc-sidebar-icon" aria-hidden="true" />
            <MaturityDot
              stage={destinationStage(settingsDestination)}
              class="absolute end-4 top-4"
            />
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
          <!-- The notification bell — a real surface with an honest empty state (no fake items,
               no count badge). Its popover states the truth and offers the center; live alerts
               arrive with the notifications machinery. -->
          <Popover.Root bind:open={notificationsOpen}>
            <Popover.Trigger class="mc-top-bar-icon-button relative" aria-label="Notifications">
              <Bell class="size-16" aria-hidden="true" />
              <MaturityDot
                stage={destinationStage(notificationsDestination)}
                class="absolute end-4 top-4"
              />
            </Popover.Trigger>
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
          <!-- The Time Keeper — a WIDGET, not an icon button (owner-corrected): the running-
               timer chip from the approved mockups (design-lab/home.html: a hairline chip with
               a status dot, tabular elapsed readout, and the active matter). Its SHAPE ships
               now so the chrome's layout is settled; this is the resting anatomy — glyph plus
               a muted 0:00 placeholder, Soon treatment (aria-disabled with no action, NOT the
               disabled attribute, which would swallow the hover that carries the tooltip's
               truth).

               THE LIGHT-UP CONTRACT (arrives with the Time surface's UI; the time-tracking
               backend already exists): a live elapsed readout while a timer runs, and click
               opens the timer panel — a popover with the active matter, description, and
               start/stop/switch controls. -->
          <Tooltip.Root>
            <Tooltip.Trigger
              class="mc-top-bar-icon-button cursor-not-allowed gap-8 border text-xs tabular-nums"
              style="border-color: var(--mc-chrome-border)"
              aria-label="Time Keeper — soon"
              aria-disabled="true"
            >
              <Timer class="size-16" aria-hidden="true" />
              <span>0:00</span>
            </Tooltip.Trigger>
            <Tooltip.Content>Time Keeper — soon</Tooltip.Content>
          </Tooltip.Root>
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
           (scrolling) page frame their content at the exact same width — no reflow on navigation. -->
      <main
        class="grow overflow-x-hidden overflow-y-auto rounded-ss-lg bg-surface-default p-24 [scrollbar-gutter:stable]"
      >
        {@render children()}
      </main>
    </div>
  </div>
</Tooltip.Provider>

<CommandPalette bind:open={paletteOpen} sidebarCollapsed={collapsed} />

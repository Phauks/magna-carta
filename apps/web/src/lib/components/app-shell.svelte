<script lang="ts">
  /*
   * The assembled App Shell — the only fixed chrome (page-archetypes Layout A): the ink sidebar
   * (brand corner + the destination registry through the member's STAR layer) and the TopBar
   * framing a light, calm routed canvas. The design system owns the parts; THIS composition,
   * the registry filtering, and the palette wiring are the app's domain knowledge.
   *
   * THE SIDEBAR IS THE MEMBER'S: it renders pinned + starred destinations in the member's
   * per-group order (sidebar-preferences.svelte.ts — stars govern the sidebar ONLY; the palette
   * and the App Library always carry everything). Customize mode, entered from the footer,
   * turns rows into reorderable entries with unstar controls; the App Library link there opens
   * the full catalog. A destination newly arrived in the sidebar (starred elsewhere, or a new
   * registry addition) carries a one-time gilt-draw highlight so the eye catches where
   * reconciliation seated it.
   *
   * Top-bar seams stay seams: +New, the billable timer, and alerts render nothing until their
   * slices ship — the Actions region reserves their geometry; the shell never fakes function.
   */
  import { page } from "$app/state";
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import * as Sidebar from "@magna-carta/design-system/sidebar";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import * as TopBar from "@magna-carta/design-system/top-bar";
  import { isPaletteChord } from "@magna-carta/design-system/internal/platform";
  import Check from "@lucide/svelte/icons/check";
  import Lock from "@lucide/svelte/icons/lock";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import StarOff from "@lucide/svelte/icons/star-off";
  import Timer from "@lucide/svelte/icons/timer";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import ProfileMenu from "$lib/components/profile-menu.svelte";
  import Badge from "@magna-carta/design-system/badge";
  import { DragReorderController } from "$lib/components/drag-reorder.svelte.ts";
  import {
    DESTINATIONS,
    isCurrentDestination,
    type Destination,
  } from "$lib/navigation/destinations.ts";
  import {
    acknowledgeArrival,
    isNewArrival,
    moveDestination,
    setStarred,
    sidebarGroups,
    type SidebarGroupView,
  } from "$lib/navigation/sidebar-preferences.svelte.ts";
  import { developerPreferences } from "$lib/settings/developer-preferences.svelte.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  let collapsed = $state(false);
  let paletteOpen = $state(false);
  let customizing = $state(false);
  let moveAnnouncement = $state("");

  const groups = $derived(sidebarGroups());

  // Footer fixtures from the registry, so each row has one home.
  const settingsDestination = DESTINATIONS.find(
    (destination) => destination.footerPinned === true,
  ) as Destination;
  const libraryDestination = DESTINATIONS.find(
    (destination) => destination.id === "library",
  ) as Destination;
  const LibraryIcon = libraryDestination.icon;
  const SettingsIcon = settingsDestination.icon;

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

  function groupIds(group: SidebarGroupView): string[] {
    return group.destinations.map((destination) => destination.id);
  }

  function beginDrag(event: PointerEvent, group: SidebarGroupView, destination: Destination): void {
    if (destination.id === "home") return; // fixed leader — never dragged
    drag.start(
      event,
      destination.id,
      groupIds(group),
      (id, toIndex) => moveDestination(group.id, id, toIndex),
      group.id === "top" ? 1 : 0, // Home holds index 0 of its group
    );
  }

  // The keyboard half of reorder: a focused row moves one slot per Alt+Arrow press (a bare
  // arrow must keep meaning "move focus"). The keyed list moves the DOM node, so focus rides
  // along; the live region narrates the landing.
  function onEditKeydown(
    event: KeyboardEvent,
    group: SidebarGroupView,
    destination: Destination,
  ): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    if (destination.id === "home") return;
    event.preventDefault();
    const ids = groupIds(group);
    const fromIndex = ids.indexOf(destination.id);
    moveDestination(group.id, destination.id, fromIndex + (event.key === "ArrowUp" ? -1 : 1));
    const updated = sidebarGroups().find((candidate) => candidate.id === group.id);
    const landedIndex =
      updated?.destinations.findIndex((candidate) => candidate.id === destination.id) ?? -1;
    if (landedIndex !== -1 && updated !== undefined) {
      moveAnnouncement = `${destination.label} moved to position ${landedIndex + 1} of ${updated.destinations.length}`;
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
    <Sidebar.Root bind:collapsed aria-label="Primary">
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
        {#each groups as group (group.id)}
          <Sidebar.Group>
            {#if group.label}
              <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
            {/if}
            <Sidebar.Menu>
              {#each group.destinations as destination (destination.id)}
                {@const Icon = destination.icon}
                {@const current = isCurrentDestination(destination, page.url.pathname)}
                <Sidebar.MenuItem>
                  {#if customizing}
                    <!-- Customize mode: navigation yields to arrangement. The row splits into
                         the movable button (drag from anywhere on it; Alt+Arrow moves it by
                         keyboard) and its unstar control — two SIBLING buttons, never nested.
                         The dragged row follows the pointer on a transform (runtime geometry;
                         compositor-only) and floats on elevation; the list reflows instantly
                         on drop. Pinned rows show the lock instead of an unstar. -->
                    <div
                      class="flex items-center gap-4 {drag.draggingId === destination.id
                        ? 'relative z-sticky shadow-elevation-2'
                        : ''}"
                      style={drag.draggingId === destination.id
                        ? `transform: translateY(${drag.offsetY}px)`
                        : ""}
                    >
                      <Sidebar.MenuButton
                        class="touch-none select-none {destination.id === 'home'
                          ? 'cursor-default'
                          : 'cursor-grab'}"
                        tooltip={destination.label}
                        aria-roledescription="Reorderable sidebar destination"
                        aria-label="{destination.label} — Alt plus Arrow Up or Arrow Down moves it"
                        onpointerdown={(event) => beginDrag(event, group, destination)}
                        onkeydown={(event) => onEditKeydown(event, group, destination)}
                      >
                        {#snippet icon()}<Icon
                            class="mc-sidebar-icon"
                            aria-hidden="true"
                          />{/snippet}
                        {destination.label}
                      </Sidebar.MenuButton>
                      {#if destination.pinned === true}
                        <Lock
                          class="size-16 shrink-0"
                          style="color: var(--mc-chrome-text-muted)"
                          aria-hidden="true"
                        />
                      {:else}
                        <button
                          type="button"
                          class="shrink-0 rounded-md p-4"
                          style="color: var(--mc-chrome-text-muted)"
                          aria-label="Remove {destination.label} from your sidebar"
                          onclick={() => setStarred(destination.id, false)}
                        >
                          <StarOff class="size-16" aria-hidden="true" />
                        </button>
                      {/if}
                    </div>
                  {:else if destination.shipped}
                    <Sidebar.MenuButton
                      href={destination.href}
                      tooltip={destination.label}
                      isActive={current}
                      aria-current={current ? "page" : undefined}
                      data-arrived={isNewArrival(destination.id) ? "true" : undefined}
                    >
                      {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                      {destination.label}
                    </Sidebar.MenuButton>
                  {:else}
                    <!-- An announced Soon row: no destination yet, so no href and disabled —
                         honest about not existing. The badge rides the label (both hide in the
                         collapsed rail, where the tooltip carries the truth instead and the
                         un-navigable muted icon is the Soon treatment). -->
                    <Sidebar.MenuButton
                      disabled
                      tooltip="{destination.label} — coming soon"
                      class="cursor-default"
                      data-arrived={isNewArrival(destination.id) ? "true" : undefined}
                    >
                      {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                      {destination.label}
                      <Badge variant="neutral" class="ms-8">Soon</Badge>
                    </Sidebar.MenuButton>
                  {/if}
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          </Sidebar.Group>
        {/each}
      </Sidebar.Content>
      <Sidebar.Footer>
        <!-- Keyboard reorders narrate here (polite: never steals focus from the row). -->
        <span class="sr-only" role="status">{moveAnnouncement}</span>
        <Sidebar.Menu>
          {#if customizing}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton href={libraryDestination.href} tooltip={libraryDestination.label}>
                {#snippet icon()}<LibraryIcon
                    class="mc-sidebar-icon"
                    aria-hidden="true"
                  />{/snippet}
                {libraryDestination.label}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          {/if}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton
              href={settingsDestination.href}
              tooltip={settingsDestination.label}
              isActive={page.url.pathname.startsWith("/settings")}
              aria-current={page.url.pathname.startsWith("/settings") ? "page" : undefined}
            >
              {#snippet icon()}<SettingsIcon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
              {settingsDestination.label}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
          <Sidebar.MenuItem>
            <!-- In-place customization (owner-preferred over any settings page): the same rows
                 rearrange where they live. -->
            <Sidebar.MenuButton
              tooltip={customizing ? "Done customizing" : "Customize sidebar"}
              aria-pressed={customizing}
              onclick={() => {
                customizing = !customizing;
                // Arranging needs the labels (and the collapsed rail's tooltip wrapper owns
                // pointer events that would swallow the drag), so entering edit expands.
                if (customizing) collapsed = false;
              }}
            >
              {#snippet icon()}
                {#if customizing}
                  <Check class="mc-sidebar-icon" aria-hidden="true" />
                {:else}
                  <SlidersHorizontal class="mc-sidebar-icon" aria-hidden="true" />
                {/if}
              {/snippet}
              {customizing ? "Done" : "Customize"}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
        <Sidebar.Trigger />
      </Sidebar.Footer>
    </Sidebar.Root>

    <!-- Named so the work canvas resizes as its own view-transition group when the rail
         collapses. It paints its OWN surface: the collapse animation layers the old and new
         canvas snapshots without a crossfade, so a transparent-background snapshot would let the
         outgoing text show through the incoming one (the owner caught the double-exposure). -->
    <div
      class="flex grow flex-col overflow-hidden bg-surface-default"
      style="view-transition-name: mc-app-canvas"
    >
      <TopBar.Root>
        <!-- Rest state reads just "Search…" (owner-directed): the keyboard hints moved INTO the
             open palette's input row, shown only while the query is empty. -->
        <TopBar.Search class="max-w-md grow" onclick={() => (paletteOpen = true)}>
          Search…
        </TopBar.Search>
        <TopBar.Actions>
          <!-- +New and alerts land here with their slices. -->
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

      <main class="grow overflow-auto p-24">
        {@render children()}
      </main>
    </div>
  </div>
</Tooltip.Provider>

<CommandPalette bind:open={paletteOpen} sidebarCollapsed={collapsed} />

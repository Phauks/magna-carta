<script lang="ts">
  /*
   * The assembled App Shell — the only fixed chrome (page-archetypes Layout A): the ink sidebar
   * (brand corner + the destination registry) and the TopBar framing a light, calm routed
   * canvas. The design system owns the parts; THIS composition, the registry filtering, and the
   * palette wiring are the app's domain knowledge.
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
  import Settings from "@lucide/svelte/icons/settings";
  import Timer from "@lucide/svelte/icons/timer";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import ProfileMenu from "$lib/components/profile-menu.svelte";
  import Badge from "@magna-carta/design-system/badge";
  import {
    DESTINATION_GROUPS,
    isCurrentDestination,
    visibleDestinations,
  } from "$lib/navigation/destinations.ts";
  import { developerPreferences } from "$lib/settings/developer-preferences.svelte.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  let collapsed = $state(false);
  let paletteOpen = $state(false);

  // Shipped destinations navigate; announced ones render as honest Soon rows (the owner is
  // feeling out the ordering ahead of the builds — the registry documents the draft).
  const destinations = visibleDestinations();
  const groups = DESTINATION_GROUPS.map((group) => ({
    ...group,
    destinations: destinations.filter((destination) => destination.group === group.id),
  })).filter((group) => group.destinations.length > 0);

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
                  {#if destination.shipped}
                    <Sidebar.MenuButton
                      href={destination.href}
                      tooltip={destination.label}
                      isActive={current}
                      aria-current={current ? "page" : undefined}
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
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton
              href="/settings/theme"
              tooltip="Settings"
              isActive={page.url.pathname.startsWith("/settings")}
              aria-current={page.url.pathname.startsWith("/settings") ? "page" : undefined}
            >
              {#snippet icon()}<Settings class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
              Settings
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

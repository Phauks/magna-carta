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
  import * as Avatar from "@magna-carta/design-system/avatar";
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import * as Sidebar from "@magna-carta/design-system/sidebar";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import * as TopBar from "@magna-carta/design-system/top-bar";
  import {
    isPaletteChord,
    paletteShortcutLabel,
  } from "@magna-carta/design-system/internal/platform";
  import Settings from "@lucide/svelte/icons/settings";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import {
    DESTINATION_GROUPS,
    isCurrentDestination,
    shippedDestinations,
  } from "$lib/navigation/destinations.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  let collapsed = $state(false);
  let paletteOpen = $state(false);

  const destinations = shippedDestinations();
  const groups = DESTINATION_GROUPS.map((group) => ({
    ...group,
    destinations: destinations.filter((destination) => destination.group === group.id),
  })).filter((group) => group.destinations.length > 0);

  // The palette chord, detected from the OS (never hardcoded) — one shared module answers the
  // Apple-vs-everyone question for the keycap label AND the listener, so they cannot disagree.
  const paletteShortcut = paletteShortcutLabel();

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
        <BrandMark />
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
                  <Sidebar.MenuButton
                    href={destination.href}
                    tooltip={destination.label}
                    isActive={current}
                    aria-current={current ? "page" : undefined}
                  >
                    {#snippet icon()}<Icon class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    {destination.label}
                  </Sidebar.MenuButton>
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
              href="/settings/appearance"
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
        <TopBar.Search
          shortcut={paletteShortcut}
          class="max-w-md grow"
          onclick={() => (paletteOpen = true)}
        >
          Search or jump to anything
        </TopBar.Search>
        <TopBar.Actions>
          <!-- +New, the billable timer, and alerts land here with their slices. -->
          <Avatar.Root>
            <Avatar.Fallback>MC</Avatar.Fallback>
          </Avatar.Root>
        </TopBar.Actions>
      </TopBar.Root>

      <main class="grow overflow-auto p-24">
        {@render children()}
      </main>
    </div>
  </div>
</Tooltip.Provider>

<CommandPalette bind:open={paletteOpen} sidebarCollapsed={collapsed} />

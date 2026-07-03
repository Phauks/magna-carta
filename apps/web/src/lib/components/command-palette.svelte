<script lang="ts">
  /*
   * The Ctrl+K command palette — a Dialog hosting the design system's Command (the house
   * pattern: the dialog owns open/close/focus-trap; the palette owns filtering).
   *
   * DISCOVERABILITY CONTRACT — the palette renders REGISTRIES, never hand-listed items.
   * Every group below derives from a canonical registry: app pages from the destination
   * registry (src/lib/navigation/destinations.ts), settings pages from the settings-section
   * registry (src/lib/settings/settings-sections.ts). A new UI surface becomes searchable by
   * being added to its registry — the same edit that puts it in the nav puts it here, so
   * search can never lag the app. A surface that is in no registry is by definition not
   * discoverable; if a new kind of surface has no registry yet, create one and add a provider
   * group here — do NOT hardcode an item (a hardcoded item is invisible to the registry's
   * owners and silently rots). Matters/contacts/actions join as their registries ship.
   */
  import { goto } from "$app/navigation";
  import * as Command from "@magna-carta/design-system/command";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import {
    PRESENCE_SCALE_FADE,
    type PresenceClass,
  } from "@magna-carta/design-system/internal/floating";
  import BugReportDialog from "$lib/components/bug-report-dialog.svelte";
  import {
    PALETTE_ENTRANCE_PRESENCE,
    readPaletteEntranceVariant,
  } from "$lib/developer/palette-entrance.ts";
  import { shippedDestinations } from "$lib/navigation/destinations.ts";
  import { ECOSYSTEM_SITES } from "$lib/navigation/ecosystem-sites.ts";
  import { bandedSettingsSections } from "$lib/settings/settings-sections.ts";

  let {
    open = $bindable(false),
    sidebarCollapsed = false,
  }: { open?: boolean; sidebarCollapsed?: boolean } = $props();

  const destinations = shippedDestinations();
  // Shipped sections flattened per band — the registry already gates development-only
  // sections out of production builds, so no extra filtering here.
  const settingsBands = bandedSettingsSections().map((band) => ({
    id: band.id,
    label: band.label,
    sections: band.groups.flatMap((group) => group.sections),
  }));

  // The dialog recipe centers via `inset: 0; margin: auto`; starting the inset past the rail
  // centers the palette over the WORK CANVAS, not the screen (owner review 2026-07-02). This is
  // the FALLBACK position, used only when the top-bar trigger cannot be measured.
  const insetStart = $derived(
    sidebarCollapsed ? "var(--mc-size-sidebar-rail)" : "var(--mc-size-sidebar)",
  );

  // The palette opens ON the search trigger, not screen-center, so it reads as the search bar
  // itself activating in place (owner review 2026-07-02). Re-measured at every open — the
  // trigger travels with the sidebar seam, so a cached rect would go stale — and measured
  // synchronously in the derived (not an effect) so the panel's very first painted frame is
  // already anchored, never one centered frame followed by a jump.
  //
  // The last anchored style is LATCHED in a plain variable: Bits keeps the panel mounted
  // through its exit animation after `open` flips false, and reverting to the centered
  // fallback mid-exit flashed the closing panel to screen-center for a frame (owner report
  // 2026-07-02). The latch keeps the exit exactly where the panel opened.
  let lastAnchoredStyle: string | null = null;
  const contentStyle = $derived.by(() => {
    if (open && typeof document !== "undefined") {
      const triggerRect = document
        .querySelector(".mc-top-bar-search")
        ?.getBoundingClientRect();
      if (triggerRect) {
        // Explicit start insets + auto end insets defeat the recipe's `inset: 0; margin: auto`
        // centering: the panel pins to the trigger's own box and grows DOWNWARD (fit-content
        // block size). max-inline-size: none releases the wrapper's max-w clamp so the measured
        // width always wins; the prose token caps the list so it never runs off the viewport.
        lastAnchoredStyle =
          `inset-block-start: ${triggerRect.top}px; ` +
          `inset-inline-start: ${triggerRect.left}px; ` +
          `inset-block-end: auto; inset-inline-end: auto; ` +
          `inline-size: ${triggerRect.width}px; max-inline-size: none; ` +
          `margin: var(--mc-space-0); max-block-size: var(--mc-size-prose);`;
        return lastAnchoredStyle;
      }
    }
    return lastAnchoredStyle ?? `inset-inline-start: ${insetStart}`;
  });

  // Entrance-animation TRIAL HARNESS: in development builds a developer-console preference
  // (Motion module, "Palette entrance") picks the panel's presence recipe so the owner can feel
  // each candidate live. Re-read at every open — the console select applies on the NEXT open —
  // and LATCHED like the anchor style above, so the exit animation always matches the entrance
  // the panel opened with even if the preference changes mid-open. Production (and an unset
  // preference) always gets the shipped scale-fade. Once the owner picks a winner, hard-code
  // that presence here and remove the console control + palette-entrance.ts.
  let latchedPresence: PresenceClass = PRESENCE_SCALE_FADE;
  const presence = $derived.by(() => {
    if (open && import.meta.env.DEV) {
      latchedPresence = PALETTE_ENTRANCE_PRESENCE[readPaletteEntranceVariant()];
    }
    return latchedPresence;
  });

  function navigateTo(href: string): void {
    open = false;
    void goto(href);
  }

  // "Report a bug" is reachable from search as well as the profile menu (owner directive:
  // everything under the profile icon must be findable here). The palette owns its own dialog
  // instance — the component is self-contained, so no state threads through the shell.
  let bugReportOpen = $state(false);

  function openBugReport(): void {
    open = false;
    bugReportOpen = true;
  }

  function openEcosystemSite(href: string): void {
    open = false;
    window.open(href, "_blank", "noopener,noreferrer");
  }
</script>

<!-- rounded-md: the container's radius must match the trigger's (.mc-top-bar-search,
     radius-md) so the anchored open reads as the same shape awake — geometry only; the panel
     keeps its own light overlay surface. The pairing is documented in the two recipes
     (design-system: top-bar/top-bar.css and command/command.css). -->
<Dialog.Root bind:open>
  <Dialog.Content
    showClose={false}
    {presence}
    class="overflow-hidden rounded-md p-0"
    style={contentStyle}
  >
    <Dialog.Title class="sr-only">Command menu</Dialog.Title>
    <Command.Root label="Command menu" class="border-0 bg-transparent">
      <Command.Input placeholder="Search or jump to anything…" />
      <Command.List>
        <Command.Viewport>
          <Command.Empty>No results found.</Command.Empty>
          <Command.Group>
            <Command.GroupHeading>Go to</Command.GroupHeading>
            <Command.GroupItems>
              {#each destinations as destination (destination.id)}
                <Command.Item onSelect={() => navigateTo(destination.href)}>
                  {destination.label}
                </Command.Item>
              {/each}
            </Command.GroupItems>
          </Command.Group>
          <!-- One palette group per settings band, so search results say WHOSE setting a hit is
               ("My settings" vs "Firm settings" — the scope must be legible in search). Items
               keep the "Settings:" prefix so typing "settings" still surfaces them all. -->
          {#each settingsBands as band (band.id)}
            {#if band.sections.length > 0}
              <Command.Group>
                <Command.GroupHeading>{band.label}</Command.GroupHeading>
                <Command.GroupItems>
                  {#each band.sections as section (section.id)}
                    <Command.Item onSelect={() => navigateTo(section.href)}>
                      Settings: {section.label}
                    </Command.Item>
                  {/each}
                </Command.GroupItems>
              </Command.Group>
            {/if}
          {/each}
          <!-- Everything under the profile icon is searchable too (owner directive): the bug
               report action, and the ecosystem sites from their registry — not-yet-wired sites
               render disabled with the same "Soon" voice as the menu, so search tells the truth
               about what exists without hiding what is coming. -->
          <Command.Group>
            <Command.GroupHeading>Help & websites</Command.GroupHeading>
            <Command.GroupItems>
              <Command.Item onSelect={openBugReport}>Report a bug</Command.Item>
              {#each ECOSYSTEM_SITES as site (site.id)}
                {#if site.href !== null}
                  {@const siteHref = site.href}
                  <Command.Item onSelect={() => openEcosystemSite(siteHref)}>
                    Website: {site.label}
                  </Command.Item>
                {:else}
                  <Command.Item disabled>Website: {site.label} — soon</Command.Item>
                {/if}
              {/each}
            </Command.GroupItems>
          </Command.Group>
        </Command.Viewport>
      </Command.List>
    </Command.Root>
  </Dialog.Content>
</Dialog.Root>

<BugReportDialog bind:open={bugReportOpen} />

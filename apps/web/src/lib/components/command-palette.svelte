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
   * owners and silently rots). Matters/directory/actions join as their registries ship.
   *
   * NOT EVERY ENTRY IS A DESTINATION. The registries above all describe an href, and selecting one
   * is a `goto`. A developer surface that opens IN PLACE — the header's Build Information panel is
   * the first — has no address to navigate to, so it would have had to be the hardcoded item this
   * contract forbids. Its registry is $lib/developer/diagnostic-actions.ts: an id, a label, the
   * words it should be findable by, whether this build offers it, and the function that runs. The
   * next tool of that shape joins there and is searchable in the same commit, with no edit here.
   *
   * THE FIRM'S RECORDS ARE NOT IN ANY REGISTRY, AND ARE NOT SEARCHED HERE. The palette's last row
   * hands the typed text to the Search page (src/routes/(app)/search), which asks the server. It is
   * one row for whatever was typed, never a list of matters or notes rendered inside the palette:
   * a result here would be a second, shallower answer to the question that page exists to answer.
   */
  import { goto } from "$app/navigation";
  import { openBeside } from "$lib/navigation/open-beside.ts";
  import * as Command from "@magna-carta/design-system/command";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Keyboard from "@magna-carta/design-system/keyboard";
  import { paletteShortcutLabel } from "@magna-carta/design-system/internal/platform";
  import {
    PRESENCE_SCALE_FADE,
    type PresenceClass,
  } from "@magna-carta/design-system/internal/floating";
  import { issueReport } from "$lib/components/issue-report.svelte.ts";
  import {
    PALETTE_ENTRANCE_PRESENCE,
    readPaletteEntranceVariant,
  } from "$lib/developer/palette-entrance.ts";
  import { visibleDestinations } from "$lib/navigation/destinations.ts";
  import { grantedPermissions } from "$lib/tools/tool-permissions.ts";
  import { toolDestinations } from "$lib/navigation/tool-destinations.ts";
  import { SEARCH_PLACEHOLDER } from "$lib/navigation/search.ts";
  import { searchAddress } from "$lib/search/search-address.ts";
  import { ECOSYSTEM_SITES } from "$lib/navigation/ecosystem-sites.ts";
  import { bandedSettingsSections } from "$lib/settings/settings-sections.ts";
  import { availableDiagnosticActions } from "$lib/developer/diagnostic-actions.ts";

  let {
    open = $bindable(false),
    sidebarCollapsed = false,
  }: { open?: boolean; sidebarCollapsed?: boolean } = $props();

  // Shipped destinations navigate; announced ones surface as disabled "— soon" rows so search
  // tells the same truth as the sidebar. Gated by permission, never by the member's own show/hide:
  // a row they hid is still a row they went looking for, and one they may not hold is not theirs to
  // find.
  const destinations = visibleDestinations(grantedPermissions());
  // Shipped sections flattened per band — the registry already gates development-only
  // sections out of production builds, so no extra filtering here.
  const settingsBands = bandedSettingsSections().map((band) => ({
    id: band.id,
    label: band.label,
    sections: band.groups.flatMap((group) => group.sections),
  }));
  // Individual tools, derived from the tool catalog + its web presentation layer — the same
  // registry the rail's Tools group renders. A built tool navigates to its page; a not-yet-built
  // one surfaces as a disabled "— soon" row, exactly as an announced destination does.
  const tools = toolDestinations();
  // Surfaces that OPEN rather than navigate, from their own registry. Read at render rather than
  // held in a constant: an entry decides its own availability, and a permission that arrives after
  // the shell mounted must be able to light one up.
  const diagnosticActions = $derived(availableDiagnosticActions());

  // An anchored panel (placement="anchored", below) positions itself against the viewport with
  // its own insets; centring it the way a centred panel is, `inset: 0; margin: auto`, and starting
  // the inset past the rail centers the palette over the WORK CANVAS, not the screen (owner review
  // 2026-07-02). This is the FALLBACK position, used only when the top-bar trigger cannot be
  // measured.
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
        // Explicit start insets + auto end insets pin the (fixed) panel to the trigger's own box,
        // and it grows DOWNWARD (fit-content block size). max-inline-size: none releases the
        // wrapper's max-w clamp so the measured width always wins; the prose token caps the list
        // so it never runs off the viewport.
        lastAnchoredStyle =
          `inset-block-start: ${triggerRect.top}px; ` +
          `inset-inline-start: ${triggerRect.left}px; ` +
          `inset-block-end: auto; inset-inline-end: auto; ` +
          `inline-size: ${triggerRect.width}px; max-inline-size: none; ` +
          `margin: var(--mc-space-0); max-block-size: var(--mc-size-prose);`;
        return lastAnchoredStyle;
      }
    }
    return (
      lastAnchoredStyle ??
      `inset: var(--mc-space-0); margin: auto; inset-inline-start: ${insetStart};`
    );
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

  /*
   * The keyboard hints live INSIDE the open palette (owner-directed — the rest-state trigger
   * reads just "Search…"): shown while the query is EMPTY, gone the moment anything is typed,
   * back if it is cleared. They overlay the input row's end (absolute, no reserved text space),
   * so appearing and disappearing never reflows the row. The chord chip stays in the set — the
   * owner wants the shortcut learnable at the moment of first click.
   */
  let searchQuery = $state("");
  const paletteShortcut = paletteShortcutLabel();

  function navigateTo(href: string): void {
    open = false;
    void goto(href);
  }

  // "Report a bug" is reachable from search as well as the profile menu (owner directive:
  // everything under the profile icon must be findable here). The dialog itself is the shell's,
  // mounted once for every door into it ($lib/components/issue-report.svelte.ts); the palette
  // contributes the gesture and nothing else.
  function openBugReport(): void {
    open = false;
    issueReport.open();
  }

  // The palette closes first, then the action runs: an action that opens a popover anchored to the
  // header cannot be seen underneath an open palette, and closing after would race its own
  // transition.
  function runDiagnosticAction(run: () => void): void {
    open = false;
    run();
  }

  function openEcosystemSite(href: string): void {
    open = false;
    openBeside(href, "external");
  }
</script>

<!-- placement="anchored": the palette opens ON its trigger, not in the centre of the dialog's
     stage, so it positions itself against the viewport with the insets in contentStyle.
     rounded-md: the container's radius must match the trigger's (.mc-top-bar-search,
     radius-md) so the anchored open reads as the same shape awake — geometry only; the panel
     keeps its own light overlay surface. The pairing is documented in the two recipes
     (design-system: top-bar/top-bar.css and command/command.css). -->
<Dialog.Root bind:open>
  <Dialog.Content
    showClose={false}
    {presence}
    placement="anchored"
    class="overflow-hidden rounded-md p-0"
    style={contentStyle}
  >
    <Dialog.Title class="sr-only">Command menu</Dialog.Title>
    <Command.Root label="Command menu" class="border-0 bg-transparent">
      <div class="relative">
        <!-- Same label as the passive top-bar trigger (one home in navigation/search.ts): the
             palette opens ON the trigger, so the active and passive text must never drift. -->
        <Command.Input placeholder={SEARCH_PLACEHOLDER} bind:value={searchQuery} />
        {#if searchQuery.trim() === ""}
          <div
            class="pointer-events-none absolute inset-y-0 flex items-center gap-8"
            style="inset-inline-end: var(--mc-space-12)"
          >
            <Keyboard>↑↓</Keyboard>
            <span class="text-xs text-text-muted">navigate</span>
            <Keyboard>↵</Keyboard>
            <span class="text-xs text-text-muted">select</span>
            <Keyboard>Esc</Keyboard>
            <span class="text-xs text-text-muted">close</span>
            <Keyboard>{paletteShortcut}</Keyboard>
          </div>
        {/if}
      </div>
      <Command.List>
        <Command.Viewport>
          <!-- Only while nothing is typed. Once there is text, the last row offers to search the
               firm's records for it, so "nothing found" above that row would be untrue. -->
          {#if searchQuery.trim() === ""}
            <Command.Empty>No results found.</Command.Empty>
          {/if}
          <Command.Group>
            <Command.GroupHeading>Go to</Command.GroupHeading>
            <Command.GroupItems>
              {#each destinations as destination (destination.id)}
                {#if destination.shipped}
                  <Command.Item onSelect={() => navigateTo(destination.href)}>
                    {destination.label}
                  </Command.Item>
                {:else}
                  <Command.Item disabled>{destination.label} — soon</Command.Item>
                {/if}
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
          <!-- Individual tools, so "speed" reaches the Network Speed Test and "whois" the WHOIS
               lookup. Each item's keywords fold in the tool's description, its cluster and its lay
               synonyms so it is findable by more than its name ("bandwidth" → speed test, "domain"
               → WHOIS, "internet" → all three). This group is also what replaced the /tools index:
               the descriptions and the search were the only things that screen carried, and they
               are here from one keystroke with no navigation first. A tool with no page yet renders
               disabled with the same "— soon" voice the destinations group uses. -->
          <Command.Group>
            <Command.GroupHeading>Tools</Command.GroupHeading>
            <Command.GroupItems>
              {#each tools as tool (tool.id)}
                {#if tool.launchable}
                  <Command.Item keywords={[...tool.keywords]} onSelect={() => navigateTo(tool.href)}>
                    {tool.name}
                  </Command.Item>
                {:else}
                  <Command.Item keywords={[...tool.keywords]} disabled>
                    {tool.name} — soon
                  </Command.Item>
                {/if}
              {/each}
            </Command.GroupItems>
          </Command.Group>
          <!-- Developer and support surfaces that open in place rather than at an address, from the
               diagnostic-action registry. An entry that this build does not offer is omitted
               entirely rather than shown disabled: unlike an announced destination there is nothing
               coming that a reader should be told about. -->
          {#if diagnosticActions.length > 0}
            <Command.Group>
              <Command.GroupHeading>Diagnostics</Command.GroupHeading>
              <Command.GroupItems>
                {#each diagnosticActions as action (action.id)}
                  <Command.Item
                    keywords={[...action.keywords]}
                    onSelect={() => runDiagnosticAction(action.run)}
                  >
                    {action.label}
                  </Command.Item>
                {/each}
              </Command.GroupItems>
            </Command.Group>
          {/if}
          <!-- Everything under the profile icon is searchable too (owner directive): the bug
               report action, and the ecosystem sites from their registry — not-yet-wired sites
               render disabled with the same "Soon" voice as the menu, so search tells the truth
               about what exists without hiding what is coming. -->
          <Command.Group>
            <Command.GroupHeading>Help & websites</Command.GroupHeading>
            <Command.GroupItems>
              <Command.Item onSelect={openBugReport}>Report an Issue</Command.Item>
              <!-- Hand-mirrored from the profile menu like Report a bug (the seam has no
                   registry yet — it gains one, or a live route, when accounts ship). -->
              <Command.Item disabled>Account Settings (soon)</Command.Item>
              {#each ECOSYSTEM_SITES as site (site.id)}
                {#if site.href === null && site.opensWindow !== undefined}
                  {@const opensWindow = site.opensWindow}
                  <Command.Item
                    onSelect={() => {
                      open = false;
                      opensWindow();
                    }}
                  >
                    Website: {site.label}
                  </Command.Item>
                {:else if site.href !== null}
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
          <!-- The firm's records, which no registry holds. Whatever was typed can be taken to the
               Search page, where every matter the reader may see is searched for it. This row is
               the typed text itself and not an entry anybody lists, so it is always mounted: the
               filter above asks whether an entry matches the text, and this one is the text. It
               is LAST on purpose. A reader who types "mat" and presses Enter still lands on
               Matters, and one who types words no screen is named for finds this the only row. -->
          {#if searchQuery.trim() !== ""}
            <Command.Group forceMount>
              <Command.GroupHeading>Search</Command.GroupHeading>
              <Command.GroupItems>
                <Command.Item
                  forceMount
                  value={`search-every-matter ${searchQuery}`}
                  onSelect={() => navigateTo(searchAddress(searchQuery))}
                >
                  Search Every Matter For “{searchQuery.trim()}”
                </Command.Item>
              </Command.GroupItems>
            </Command.Group>
          {/if}
        </Command.Viewport>
      </Command.List>
    </Command.Root>
  </Dialog.Content>
</Dialog.Root>

<script lang="ts">
  /*
   * The settings shell — a two-column arrangement inside the work canvas: the section nav on the
   * left, rendered from the settings section registry (one canonical list, so adding a section
   * is a registry entry + a page, never a nav edit), and the active section's page on the right.
   *
   * The nav's three levels are made unmistakable (they read at three distinct registers, not
   * three shades of the same list):
   *
   * - BAND — a glyph naming WHOSE settings these are beside a firm small-caps label, seated on
   *   a full-width rule. The glyphs are plain symbolic Lucide icons (person / building /
   *   server): the member's avatar and the Magna Carta mark were tried here and the owner
   *   rejected both (2026-07-03) — identity marks stay in the chrome, the nav carries symbols.
   *   Every band gets the SAME single hairline: a double rule under the firm band was likewise
   *   tried and rejected ("no setting on the left side should have a double line") — do not
   *   reintroduce either; the glyphs and the indent stagger carry the scope distinction.
   * - GROUP — small-caps muted, indented one step past the band edge.
   * - PAGE ROW — sentence-case pills, indented one step past the group. The two-step stagger is
   *   the legibility device: access level, category, destination.
   *
   * Firm sections this member can only VIEW carry a quiet hairline chip stating "View" at the
   * row's end — a stated fact, never a lock glyph (locks advertise secrets; a chip states
   * standing). Derived from the permission seam, so it flips with the member's grants.
   *
   * Each page keeps its own Masthead: the heading belongs to the content, and the nav stays a
   * finding aid, not chrome. Canvas voice throughout — standard tokens, no chrome-* register.
   */
  import { page } from "$app/state";
  import Badge from "@magna-carta/design-system/badge";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Building2 from "@lucide/svelte/icons/building-2";
  import Server from "@lucide/svelte/icons/server";
  import UserRound from "@lucide/svelte/icons/user-round";
  import {
    bandedSettingsSections,
    isCurrentSettingsSection,
    type SettingsSection,
  } from "$lib/settings/settings-sections.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  const bands = bandedSettingsSections();

  // Every posture on this surface — each page's editable-or-read-only standing, and the nav's own
  // "View" tag — is an answer about the signed-in member, so the read is started once here rather
  // than by each page. It is shared and at-most-once, so a page that also reads the session for a
  // narrower right of its own costs nothing extra.
  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  // "View" appears only where an edit right EXISTS and this member lacks it; sections with no
  // declared area (pure diagnostics) are readable by design and need no standing stated.
  function viewOnly(section: SettingsSection): boolean {
    return (
      section.scope === "firm" &&
      section.editPermissionArea !== undefined &&
      !canEditFirmSettings(section.editPermissionArea)
    );
  }
</script>

<!--
  TWO INDEPENDENT SCROLL COLUMNS (owner-directed): the section nav and the settings content
  each scroll on their own, and the canvas itself never scrolls on settings routes. The columns
  reach the canvas's TRUE edges (owner: the padding frame around the scroll areas read as a
  border and wasted width) — the -m-24 swallows the canvas's own padding and the breathing room
  moves INSIDE each scroll area, so scrollbars sit at the actual edges. This also retires the
  whole-canvas scrollbar shift that made the nav appear to move between pages (the content
  column's own stable scrollbar gutter carries that guarantee now — see the pages).

  The content column is a flex STACK, not a scroll container: each settings page renders
  header / scrolling middle / exit footer as its three stories, so the footer holds the bottom
  of the screen even on short pages.
-->
<div class="-m-24 flex items-start" style="block-size: calc(100dvh - var(--mc-size-top-bar))">
  <!--
    The nav column is a narrow fixed measure (the popover width token plus its own internal
    breathing room) rather than the sidebar width: the labels are short, and the page should
    read as one composition — nav beside content — not two islands separated by dead air.
    Fixed (not max-content) so the hover/active pills keep a steady width as sections with
    longer labels ship.
  -->
  <nav
    aria-label="Settings sections"
    class="mc-scrollbar flex h-full shrink-0 flex-col gap-32 overflow-y-auto p-24"
    style="inline-size: calc(var(--mc-size-popover) + var(--mc-space-48))"
  >
    {#each bands as band (band.id)}
      <div class="flex flex-col gap-16">
        <!-- The band header. px-12 aligns the cap-line with the group headers' indent origin;
             one hairline for every band (the firm double rule was owner-rejected). The glyphs
             are plain symbols in the band's own muted ink — never an avatar or a brand mark
             (owner-rejected here). -->
        <div class="flex items-center gap-8 border-b border-border-strong px-12 pb-8">
          {#if band.id === "user"}
            <UserRound class="size-16 text-text-muted" aria-hidden="true" />
          {:else if band.id === "firm"}
            <Building2 class="size-16 text-text-muted" aria-hidden="true" />
          {:else}
            <Server class="size-16 text-text-muted" aria-hidden="true" />
          {/if}
          <FieldLabel as="p" class="text-text-default"
          >
            {band.label}
          </FieldLabel>
        </div>

        <div class="flex flex-col gap-24">
          {#each band.groups as group (group.id)}
            <div class="flex flex-col gap-8">
              <!-- Group header: one indent step (12) past the band's cap-line at 12. -->
              <FieldLabel as="p" class="ps-24">
                {group.label}
              </FieldLabel>
              <!-- Page rows: one further step — the pills start at 24 and their own px-12 puts
                   the row text at 36, completing the three-level stagger. -->
              <ul class="flex flex-col gap-4" style="padding-inline-start: var(--mc-space-24)">
                {#each group.sections as section (section.id)}
                  {@const current = isCurrentSettingsSection(section, page.url.pathname)}
                  <li>
                    <!--
                      Control-sized rounded rows, the canvas-register cousin of the sidebar's menu
                      buttons: hover is a quiet surface tint, and the active row carries the gilt
                      start-edge bar as an inset shadow (same device as the sidebar recipe — a border
                      would bend around the rounded corners) plus a selected fill and firmer text.
                    -->
                    <a
                      href={section.href}
                      aria-current={current ? "page" : undefined}
                      class="flex items-center justify-between gap-8 rounded-md px-12 text-sm transition-colors duration-fast ease-standard {current
                        ? 'bg-surface-selected font-medium text-text-default'
                        : 'text-text-muted hover:bg-surface-raised hover:text-text-default'}"
                      style="min-block-size: var(--mc-control-sm);{current
                        ? ' box-shadow: inset var(--mc-focus-ring-width) var(--mc-space-0) var(--mc-space-0) var(--mc-space-0) var(--mc-accent-default);'
                        : ''}"
                    >
                      {section.label}
                      {#if viewOnly(section)}
                        <Badge variant="outline" caps>
                          View
                        </Badge>
                      {/if}
                    </a>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </nav>

  <div class="flex h-full min-w-0 grow flex-col">
    {@render children()}
  </div>
</div>

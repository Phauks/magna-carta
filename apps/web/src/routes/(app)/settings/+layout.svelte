<script lang="ts">
  /*
   * The settings shell — a two-column arrangement inside the work canvas: the section nav on the
   * left, rendered from the settings section registry (one canonical list, so adding a section
   * is a registry entry + a page, never a nav edit), and the active section's page on the right.
   *
   * The nav's three levels are made unmistakable (they read at three distinct registers, not
   * three shades of the same list):
   *
   * - BAND — an identity plate: a glyph naming WHOSE settings these are (the member's avatar for
   *   "My settings", the firm's mark for "Firm settings") beside a firm small-caps label, seated
   *   on a full-width rule. The firm band's rule is a DOUBLE RULE — the ledger's device for
   *   authority and totals — so one glance separates "mine" (single rule) from "the firm's"
   *   (double rule).
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
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Badge from "@magna-carta/design-system/badge";
  import {
    bandedSettingsSections,
    isCurrentSettingsSection,
    type SettingsSection,
  } from "$lib/settings/settings-sections.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  const bands = bandedSettingsSections();

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

<div class="flex items-start gap-32">
  <!--
    The nav column is a narrow fixed measure (the popover width token, 224px) rather than the
    sidebar width: the labels are short, and the page should read as one composition — nav
    beside content — not two islands separated by dead air. Fixed (not max-content) so the
    hover/active pills keep a steady width as sections with longer labels ship.

    Sticky: the canvas (<main> in app-shell.svelte) is the scroll container below the top bar,
    so the nav pins at the canvas's own padding offset (24) while long pages scroll beside it —
    no jump between resting and stuck positions. If the section list ever outgrows the
    viewport, the nav scrolls within itself (max-block-size = viewport minus the top bar and
    the canvas's vertical padding) rather than trapping the pinned column.
  -->
  <nav
    aria-label="Settings sections"
    class="sticky flex shrink-0 flex-col gap-32 overflow-y-auto"
    style="inline-size: var(--mc-size-popover); inset-block-start: var(--mc-space-24); max-block-size: calc(100dvh - var(--mc-size-top-bar) - var(--mc-space-48))"
  >
    {#each bands as band (band.id)}
      <div class="flex flex-col gap-16">
        <!-- The identity plate. px-12 aligns the cap-line with the group headers' indent origin. -->
        <div class="flex flex-col">
          <div class="flex items-center gap-8 border-b border-border-strong px-12 pb-8">
            {#if band.id === "user"}
              <!-- The member's avatar — the same MC-initials fallback seam as the profile menu;
                   the member's photograph takes over when accounts arrive. size-20 is the
                   smallest circle the two initials stay legible in. -->
              <Avatar.Root class="size-20">
                <Avatar.Fallback class="text-xs">MC</Avatar.Fallback>
              </Avatar.Root>
            {:else}
              <!-- The firm's mark. The BrandMark component is chrome-register (fixed 2xl gold
                   glyph + a wordmark inked for dark chrome surfaces — near-invisible on the
                   canvas) with no size seam, so the glyph is composed here from the same tokens
                   at canvas scale: the blackletter face, the accent gold. The firm's OWN mark
                   replaces this when firm branding arrives. -->
              <span
                aria-hidden="true"
                class="text-lg"
                style="font-family: var(--mc-font-blackletter); color: var(--mc-accent-default); line-height: var(--mc-leading-tight)"
              >
                M
              </span>
            {/if}
            <p
              class="text-xs font-semibold text-text-default uppercase"
              style="letter-spacing: var(--mc-tracking-caps)"
            >
              {band.label}
            </p>
          </div>
          {#if band.id === "firm"}
            <!-- The second stroke of the double rule: an empty spacer whose bottom border sits
                 one small step under the header's own rule — two stacked hairlines, the ledger
                 total device, built from border tokens alone. -->
            <div
              aria-hidden="true"
              class="border-b border-border-strong"
              style="block-size: var(--mc-space-4)"
            ></div>
          {/if}
        </div>

        <div class="flex flex-col gap-24">
          {#each band.groups as group (group.id)}
            <div class="flex flex-col gap-8">
              <!-- Group header: one indent step (12) past the band's cap-line at 12. -->
              <p
                class="text-xs text-text-muted uppercase"
                style="letter-spacing: var(--mc-tracking-caps); padding-inline-start: var(--mc-space-24)"
              >
                {group.label}
              </p>
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
                        <Badge
                          variant="outline"
                          class="text-xs uppercase"
                          style="letter-spacing: var(--mc-tracking-caps)"
                        >
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

  <div class="min-w-0 grow">
    {@render children()}
  </div>
</div>

<script lang="ts">
  /*
   * The settings shell — a two-column arrangement inside the work canvas: a quiet section nav
   * on the left, rendered from the settings section registry (one canonical list, so adding a
   * section is a registry entry + a page, never a nav edit), and the active section's page on
   * the right. The nav nests band headers ("My settings" / "Firm settings") over group headers
   * over section rows; empty groups and empty bands render nothing. Each page keeps its own
   * Masthead: the heading belongs to the content, and the nav stays a finding aid, not chrome.
   * Canvas voice throughout — standard tokens, no chrome-* register.
   */
  import { page } from "$app/state";
  import {
    bandedSettingsSections,
    isCurrentSettingsSection,
  } from "$lib/settings/settings-sections.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  const bands = bandedSettingsSections();
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
        <!--
          Band header — one register above the group headers: same small-caps voice, but firmer
          ink and weight so the two-level hierarchy reads at a glance. px-12 aligns the cap-line
          with the row text inside the pills below.
        -->
        <p
          class="px-12 text-xs font-semibold text-text-default uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {band.label}
        </p>
        <div class="flex flex-col gap-24">
          {#each band.groups as group (group.id)}
            <div class="flex flex-col gap-8">
              <p
                class="px-12 text-xs text-text-muted uppercase"
                style="letter-spacing: var(--mc-tracking-caps)"
              >
                {group.label}
              </p>
              <ul class="flex flex-col gap-4">
                {#each group.sections as section (section.id)}
                  {@const current = isCurrentSettingsSection(section, page.url.pathname)}
                  <li>
                    <!--
                      Control-sized rounded rows, the canvas-register cousin of the sidebar's menu
                      buttons: hover is a quiet surface tint, and the active row carries the gilt
                      start-edge bar as an inset shadow (same device as the sidebar recipe — a border
                      would bend around the rounded corners) plus a selected fill and firmer text.
                      Group separation is space alone — no hairlines.
                    -->
                    <a
                      href={section.href}
                      aria-current={current ? "page" : undefined}
                      class="flex items-center rounded-md px-12 text-sm transition-colors duration-fast ease-standard {current
                        ? 'bg-surface-selected font-medium text-text-default'
                        : 'text-text-muted hover:bg-surface-raised hover:text-text-default'}"
                      style="min-block-size: var(--mc-control-sm);{current
                        ? ' box-shadow: inset var(--mc-focus-ring-width) var(--mc-space-0) var(--mc-space-0) var(--mc-space-0) var(--mc-accent-default);'
                        : ''}"
                    >
                      {section.label}
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

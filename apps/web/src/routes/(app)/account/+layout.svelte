<script lang="ts">
  /*
   * The account shell — a two-column arrangement inside the work canvas, mirroring the settings
   * shell (src/routes/(app)/settings/+layout.svelte): a section rail on the left rendered from
   * the account section registry (one canonical list, so adding a section is a registry entry +
   * a page, never a nav edit), and the active section's page on the right.
   *
   * A SINGLE band — "Account" beside a person glyph on one hairline — because every section here
   * is the member's own. (Settings bands by ownership across member / firm / platform; this
   * surface has one owner, so one band.) The glyph is a plain symbolic Lucide icon, never an
   * avatar or brand mark — identity marks stay in the chrome, the nav carries symbols.
   *
   * Each page keeps its own masthead: the heading belongs to the content, the rail stays a
   * finding aid. Canvas voice throughout — standard tokens, no chrome-* register.
   */
  import { page } from "$app/state";
  import UserRound from "@lucide/svelte/icons/user-round";
  import {
    ACCOUNT_BAND_LABEL,
    accountSections,
    isCurrentAccountSection,
  } from "$lib/account/account-sections.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  const sections = accountSections();
</script>

<!--
  TWO INDEPENDENT SCROLL COLUMNS, mirroring the settings shell: the rail and the content each
  scroll on their own, and the canvas itself never scrolls on account routes. The columns reach
  the canvas's TRUE edges — the -m-24 swallows the canvas's own padding and the breathing room
  moves INSIDE each scroll area, so scrollbars sit at the actual edges. The content column is a
  flex STACK (header / scrolling middle) so the page's masthead pins above its own scroll area.
-->
<div class="-m-24 flex items-start" style="block-size: calc(100dvh - var(--mc-size-top-bar))">
  <nav
    aria-label="Account sections"
    class="mc-scrollbar flex h-full shrink-0 flex-col gap-32 overflow-y-auto p-24"
    style="inline-size: calc(var(--mc-size-popover) + var(--mc-space-48))"
  >
    <div class="flex flex-col gap-16">
      <!-- The band header: one hairline, a plain person glyph in muted ink beside the small-caps
           label — never an avatar or brand mark here. -->
      <div class="flex items-center gap-8 border-b border-border-strong px-12 pb-8">
        <UserRound class="size-16 text-text-muted" aria-hidden="true" />
        <p
          class="text-xs font-semibold text-text-default uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {ACCOUNT_BAND_LABEL}
        </p>
      </div>

      <!-- Page rows: control-sized rounded rows, the canvas cousin of the sidebar's menu buttons.
           Hover is a quiet surface tint; the active row carries the gilt start-edge bar as an
           inset shadow (a border would bend around the rounded corners) plus a selected fill and
           firmer text — the same device the settings rail uses. -->
      <ul class="flex flex-col gap-4" style="padding-inline-start: var(--mc-space-24)">
        {#each sections as section (section.id)}
          {@const current = isCurrentAccountSection(section, page.url.pathname)}
          <li>
            <a
              href={section.href}
              aria-current={current ? "page" : undefined}
              class="flex items-center gap-8 rounded-md px-12 text-sm transition-colors duration-fast ease-standard {current
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
  </nav>

  <div class="flex h-full min-w-0 grow flex-col">
    {@render children()}
  </div>
</div>

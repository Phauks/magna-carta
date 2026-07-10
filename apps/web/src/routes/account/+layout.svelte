<script lang="ts">
  /*
   * The account surface — the member's own identity and credentials, rendered in the Secure Shell
   * (no workspace chrome; see secure-shell.svelte). A SINGLE "Account" band — every section here
   * is the member's own — beside a plain person glyph on one hairline; the rail is sourced from
   * the account section registry (one canonical list, so adding a section is a registry entry + a
   * page, never a nav edit). The active row carries the gilt start-edge bar as an inset shadow,
   * the same device the settings rail uses.
   *
   * Each page keeps its own masthead: the heading belongs to the content, the rail stays a finding
   * aid. Canvas voice throughout — standard tokens, no chrome-* register (that lives in the shell's
   * header band).
   */
  import { page } from "$app/state";
  import UserRound from "@lucide/svelte/icons/user-round";
  import SecureShell from "$lib/components/secure-shell.svelte";
  import {
    ACCOUNT_BAND_LABEL,
    accountSections,
    isCurrentAccountSection,
  } from "$lib/account/account-sections.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  const sections = accountSections();
</script>

<SecureShell>
  {#snippet rail()}
    <nav
      aria-label="Account sections"
      class="mc-scrollbar flex shrink-0 flex-col gap-32 overflow-y-auto p-24"
      style="inline-size: calc(var(--mc-size-popover) + var(--mc-space-48))"
    >
      <div class="flex flex-col gap-16">
        <!-- The band header: one hairline, a plain person glyph in muted ink beside the small-caps
             label — never an avatar or brand mark here (identity marks stay in the shell's chrome
             band). -->
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
             firmer text. -->
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
  {/snippet}
  {@render children()}
</SecureShell>

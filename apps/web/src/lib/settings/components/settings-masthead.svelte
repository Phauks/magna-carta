<script lang="ts">
  /*
   * The settings page header — INFORMATION ONLY, the top story of the three-story settings page
   * (owner-settled): the HEADER carries the page's name and facts, the MIDDLE is the settings
   * plates scrolling in their own container, and the BOTTOM is the exit
   * (settings-commit-footer.svelte, draft pages only). No save controls live here.
   *
   * Title at the start; the UNIVERSAL group at the far right of the title row, the same order
   * on every page: the posture badge(s), the documentation seam, then the history trigger as
   * the terminal anchor.
   *
   * NO DESCRIPTOR LIVES HERE. The band carries the page's NAME and the standing facts about it
   * (how its settings land, where its documentation is, what has changed) — never a sentence
   * explaining what the page governs. That sentence is real and worth keeping, so it moved into
   * the page's own content, where it scrolls with the plates it describes
   * (settings-description.svelte; owner's ruling, 2026-09-06). Every screen's header in this
   * application is its name and nothing else — docs/conventions/design-corrections.md,
   * "Screen headers".
   *
   * PINNED BY STRUCTURE, not by sticky: the settings content column is a flex stack (header /
   * scrolling middle / exit footer — see the settings +layout), so this band simply sits above
   * the scroll area and the plates scroll beneath its bottom hairline. It carries the column's
   * own top/inline padding so the scroll area underneath can reach the true canvas edges.
   *
   * No "Settings" eyebrow (owner-directed: obvious, and it steals space) — the band starts at
   * the page name. The posture badge is the ONE statement of how the page's settings land —
   * "Applies on save" / "Applies immediately" / "Managed by the firm" — so the rows carry no
   * separate caption.
   */
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { openBeside } from "$lib/navigation/open-beside.ts";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import Badge from "@magna-carta/design-system/badge";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import BookOpen from "@lucide/svelte/icons/book-open";
  import SettingsLedger from "$lib/settings/components/settings-ledger.svelte";
  import { ECOSYSTEM_SITES } from "$lib/navigation/ecosystem-sites.ts";
  import { SETTINGS_SECTIONS } from "$lib/settings/settings-sections.ts";
  import type { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import type { SettingsLedgerEntry } from "$lib/settings/settings-ledger-store.svelte.ts";

  let {
    sectionId,
    title,
    posture,
    draft,
    badgeLabel,
    preview = false,
    showHistory = true,
    restoreAction,
  }: {
    sectionId: string;
    /** The page title (Title Case, like every setting name). */
    title: string;
    posture: "draft" | "instant" | "readOnly";
    /** Draft pages pass their page draft so history restores can stage through it. */
    draft?: SettingsDraft;
    /** Overrides the posture's default badge text (e.g. diagnostics pages). */
    badgeLabel?: string;
    /** Marks a demonstration page whose settings are not yet in effect (local values only). */
    preview?: boolean;
    /** Off for pages with no ledger section (the trail would always be empty and untrue). */
    showHistory?: boolean;
    /** Passed through to the history trail — instant pages restore by re-applying. */
    restoreAction?: (entry: SettingsLedgerEntry) => (() => void) | null;
  } = $props();

  const POSTURE_BADGES: Record<typeof posture, string> = {
    draft: "Applies on save",
    instant: "Applies immediately",
    readOnly: "Managed by the firm",
  };

  /*
   * The per-page documentation link — a light-up seam. It goes live only when BOTH halves
   * exist: the Documentation ecosystem site's base URL (ecosystem-sites.ts, href null today)
   * and this section's documentationPath (settings-sections.ts). Until then the button is an
   * honest Soon seam: aria-disabled with no action, NOT the disabled attribute — a disabled
   * button swallows hover, and the tooltip carrying "— soon" IS the Soon device here.
   */
  const documentationBase = ECOSYSTEM_SITES.find((site) => site.id === "documentation")?.href;
  const documentationHref = $derived.by(() => {
    const documentationPath = SETTINGS_SECTIONS.find(
      (candidate) => candidate.id === sectionId,
    )?.documentationPath;
    if (typeof documentationBase !== "string" || documentationPath === undefined) return null;
    return `${documentationBase}${documentationPath}`;
  });

  function openDocumentation(): void {
    if (documentationHref === null) return;
    openBeside(documentationHref, "external");
  }
</script>

<div class="border-b border-border-strong px-24 pt-24 pb-12">
  <ScreenHeader {title}>
    <!-- The universal information group, the same order on every page; history anchors the
         terminal edge. -->
    {#snippet actions()}
      <Badge variant="neutral" caps>
        {badgeLabel ?? POSTURE_BADGES[posture]}
      </Badge>
      {#if preview}
        <!-- Demonstration pages only: these settings are not yet in effect — values persist on
             this device and govern nothing until the authenticated settings API wires in. -->
        <Badge variant="info" caps>
          Preview
        </Badge>
      {/if}
      <Tooltip.Root>
        {#if documentationHref !== null}
          <Tooltip.Trigger
            class={buttonClasses({ variant: "ghost", size: "sm" })}
            aria-label="Documentation"
            onclick={openDocumentation}
          >
            <BookOpen class="size-16" aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Content>Documentation</Tooltip.Content>
        {:else}
          <Tooltip.Trigger
            class="{buttonClasses({ variant: 'ghost', size: 'sm' })} cursor-not-allowed text-text-subtle"
            aria-label="Documentation (soon)"
            aria-disabled="true"
          >
            <BookOpen class="size-16" aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Content>Documentation (soon)</Tooltip.Content>
        {/if}
      </Tooltip.Root>
      {#if showHistory}
        <SettingsLedger
          {sectionId}
          {draft}
          canRestore={posture === "draft" && draft !== undefined}
          {restoreAction}
        />
      {/if}
    {/snippet}
  </ScreenHeader>
</div>

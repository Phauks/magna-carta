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
   * EVERY BAND AND EVERY GROUP FOLDS, and the heading is the control — the one disclosure
   * grammar the rail already uses, drawn by the design system's NavigationLayout.Group so the
   * two columns cannot answer the same question two ways. It is not decoration: the three bands
   * open hold better than twenty rows, which on a laptop is a column taller than the screen, and
   * a navigation with a scrollbar of its own beside a page with one is a surface that looks like
   * it is made of parts. The band and group holding THIS page are never folded away from the
   * reader (see the reveal below), and the whole registry is still reachable from the command
   * palette whatever is folded — hiding must never remove capability.
   *
   * Firm sections this member can only VIEW carry a quiet hairline chip stating "View" at the
   * row's end — a stated fact, never a lock glyph (locks advertise secrets; a chip states
   * standing). Derived from the permission seam, so it flips with the member's grants.
   *
   * Each page keeps its own Masthead: the heading belongs to the content, and the nav stays a
   * finding aid, not chrome. Canvas voice throughout — standard tokens, no chrome-* register.
   */
  import { untrack, type Snippet } from "svelte";
  import { page } from "$app/state";
  import Badge from "@magna-carta/design-system/badge";
  import NavigationLayout, {
    NavigationLayoutGroup,
    NavigationLayoutRow,
  } from "@magna-carta/design-system/navigation-layout";
  import Building2 from "@lucide/svelte/icons/building-2";
  import Server from "@lucide/svelte/icons/server";
  import UserRound from "@lucide/svelte/icons/user-round";
  import {
    bandedSettingsSections,
    isCurrentSettingsSection,
    type SettingsBand,
    type SettingsSection,
    type SettingsSectionGroup,
  } from "$lib/settings/settings-sections.ts";
  import {
    isSettingsBandCollapsed,
    isSettingsGroupCollapsed,
    setSettingsBandCollapsed,
    setSettingsGroupCollapsed,
  } from "$lib/settings/settings-navigation-folds.svelte.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";

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

  /*
   * THE FOLD, AND THE ONE THING THAT OVERRIDES IT.
   *
   * A member's folds are a per-browser preference (settings-navigation-folds.svelte.ts), stored as
   * departures from everything-open. On top of that sits a reveal that belongs to WHERE THE READER
   * IS STANDING rather than to what they chose: arriving at a page inside a folded group opens that
   * group and its band, because a column that has hidden the very page it is beside is a column
   * that has stopped being a finding aid.
   *
   * The reveal lasts the session and is never written to storage — the member never asked for it —
   * and pressing the heading clears it, so folding a group that holds the current page folds it and
   * it stays folded. Bands and groups share a key space here, so each key carries its level: the
   * "firm" band and the "firm" group are two different things with one name.
   */
  const bandKey = (band: SettingsBand): string => `band:${band}`;
  const groupKey = (group: SettingsSectionGroup): string => `group:${group}`;

  const currentKeys = $derived.by((): readonly string[] => {
    for (const band of bands) {
      for (const group of band.groups) {
        const holdsCurrent = group.sections.some((section) =>
          isCurrentSettingsSection(section, page.url.pathname),
        );
        if (holdsCurrent) return [bandKey(band.id), groupKey(group.id)];
      }
    }
    return [];
  });

  let revealed = $state<readonly string[]>([]);
  // What the reveal was last computed for. A plain variable rather than state: it guards the effect
  // against re-revealing what the member has just folded, and re-running on its own change would be
  // exactly that.
  let revealedFor = "";

  $effect(() => {
    const keys = currentKeys;
    const signature = keys.join(" ");
    if (signature === revealedFor) return;
    revealedFor = signature;
    const next = new Set(untrack(() => revealed));
    for (const key of keys) next.add(key);
    revealed = [...next];
  });

  function bandExpanded(band: SettingsBand): boolean {
    return !isSettingsBandCollapsed(band) || revealed.includes(bandKey(band));
  }

  function groupExpanded(group: SettingsSectionGroup): boolean {
    return !isSettingsGroupCollapsed(group) || revealed.includes(groupKey(group));
  }

  // The press acts on what the reader can SEE, which is why it drops the reveal first: a band held
  // open only because this page is inside it must fold when its heading is pressed.
  function toggleBand(band: SettingsBand): void {
    const open = bandExpanded(band);
    revealed = revealed.filter((key) => key !== bandKey(band));
    setSettingsBandCollapsed(band, open);
  }

  function toggleGroup(group: SettingsSectionGroup): void {
    const open = groupExpanded(group);
    revealed = revealed.filter((key) => key !== groupKey(group));
    setSettingsGroupCollapsed(group, open);
  }
</script>

<!--
  THE FRAME IS THE DESIGN SYSTEM'S. NavigationLayout owns the two independent scroll columns, the
  canvas-inset cancel, the nav's width (`standard` is the popover measure plus space-24 a side,
  exactly the width this nav was drawn to) and the reserved scrollbar gutters, so the settings
  surface cannot drift from the other two-sided screens. What stays here is the nav's CONTENT —
  the bands, the glyphs, the links — which the layout deliberately imposes no structure on.

  contentScrolls is false because every settings page stages its own three stories: the masthead,
  the one scroll region (settings-scroll-region.svelte) and the exit footer. The content column
  is therefore a bare full-height flex stack, and the footer holds the bottom of the screen even
  on a short page.
-->
<NavigationLayout navigationLabel="Settings sections" navigationWidth="standard" contentScrolls={false}>
  {#snippet navigation()}
    <div class="flex flex-col gap-32">
      {#each bands as band (band.id)}
        <!-- The band header and its fold are the design system's part: the glyph, the rule, the
             caps voice, the chevron and the three-level indent stagger all live in one recipe, so
             this column can never re-choose any of them. -->
        <NavigationLayoutGroup
          level="band"
          label={band.label}
          expanded={bandExpanded(band.id)}
          onToggle={() => toggleBand(band.id)}
        >
          {#snippet icon()}
            {#if band.id === "user"}
              <UserRound aria-hidden="true" />
            {:else if band.id === "firm"}
              <Building2 aria-hidden="true" />
            {:else}
              <Server aria-hidden="true" />
            {/if}
          {/snippet}
          {#each band.groups as group (group.id)}
            <NavigationLayoutGroup
              label={group.label}
              expanded={groupExpanded(group.id)}
              onToggle={() => toggleGroup(group.id)}
            >
              <ul class="flex flex-col gap-4">
                {#each group.sections as section (section.id)}
                  {@const current = isCurrentSettingsSection(section, page.url.pathname)}
                  <li>
                    <!--
                      The row is the design system's. It carries the control height, the hover
                      tint and the lit row's selected fill with its gilt start-edge bar — the same
                      part the Tools and Reports columns draw, so the three two-sided screens
                      cannot drift apart in what a choice on the left looks like. Two branches
                      because a snippet handed to a component cannot be declared inside a
                      conditional, and the View chip belongs to exactly one of them.
                    -->
                    {#if viewOnly(section)}
                      <NavigationLayoutRow href={section.href} {current}>
                        {section.label}
                        {#snippet trailing()}<Badge variant="outline" caps>View</Badge>{/snippet}
                      </NavigationLayoutRow>
                    {:else}
                      <NavigationLayoutRow href={section.href} {current}>
                        {section.label}
                      </NavigationLayoutRow>
                    {/if}
                  </li>
                {/each}
              </ul>
            </NavigationLayoutGroup>
          {/each}
        </NavigationLayoutGroup>
      {/each}
    </div>
  {/snippet}

  {@render children()}
</NavigationLayout>

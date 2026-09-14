<script lang="ts">
  /*
   * The navigation column of a two-sided catalogue screen: every entry the member may open,
   * grouped as its registry groups them, with the one the reader is standing on lit. Tools and
   * Reports both draw it inside the design system's NavigationLayout, so the two screens cannot
   * drift apart in what a "list of things on the left" looks like.
   *
   * IT READS THE SAME PROJECTION THE LANDING SCREEN READS. The sections are the catalogue's own
   * (tool-catalogue.ts, report-catalogue.ts), so an entry added to a registry reaches the column
   * with no edit here, and the column and the landing index can never disagree about what the
   * catalogue holds. Names only: the descriptive line, the view switch and the search stay on the
   * landing screen, which is where a reader goes to find out what a thing does.
   *
   * A ROW IS THE SETTINGS NAV'S ROW. Control-sized, rounded, a quiet surface tint on hover, and
   * the active row carrying the gilt start-edge bar as an inset shadow (a border would bend
   * around the rounded corners) with a selected fill and firmer text. The same treatment, so a
   * reader who has learned one two-sided screen has learned them all.
   *
   * A NAME WRAPS RATHER THAN TRUNCATES. The column is the popover measure wide, and a report's
   * name beside a Soon mark does not fit it on one line; a row that reads "Property Listin..."
   * has stopped naming the thing, which is the one job a navigation row has. So the name takes a
   * second line where it needs one and the row grows to hold it — the control height is a
   * minimum, not a size.
   *
   * AN ENTRY WITH NOWHERE TO GO IS STILL A ROW. The standing rule is that a designed-but-unwired
   * surface ships visible and marked, never omitted: a soon entry stands in its group with its
   * glyph and name, unlinked and quieter, wearing the Soon mark, and carrying what it waits on as
   * its hover title where the registry knows it. It is never dressed as a disabled control, which
   * would read as broken rather than as not yet.
   */
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import type { CatalogueSection } from "$lib/catalogue/catalogue.ts";
  import { isCurrentCatalogueEntry } from "./catalogue-navigation.ts";

  let {
    sections,
    pathname,
    noun,
  }: {
    /** Everything the catalogue holds, in the order its registry declares. */
    sections: readonly CatalogueSection[];
    /** The address the reader is on, which decides the lit row. */
    pathname: string;
    /** What the catalogue holds, plural and lower-case, for the nothing-here sentence. */
    noun: string;
  } = $props();

  const ROW =
    "flex items-center gap-8 rounded-md px-12 py-4 text-sm transition-colors duration-fast ease-standard";
  const ROW_AT_REST = "text-text-muted hover:bg-surface-raised hover:text-text-default";
  const ROW_CURRENT = "bg-surface-selected font-medium text-text-default";
  const ROW_HEIGHT = "min-block-size: var(--mc-control-sm);";
  const ROW_CURRENT_BAR =
    " box-shadow: inset var(--mc-focus-ring-width) var(--mc-space-0) var(--mc-space-0) var(--mc-space-0) var(--mc-accent-default);";
</script>

<div class="flex flex-col gap-24">
  {#each sections as section (section.id)}
    <div class="flex flex-col gap-8">
      <!-- The group header's cap-line at 12; the rows start one step in, so a lit row's fill
           begins flush with the header's text — the settings nav's stagger, one level shorter
           because a catalogue has groups and no bands. -->
      <FieldLabel as="p" class="px-12">{section.label}</FieldLabel>
      <ul class="flex flex-col gap-4 ps-12">
        {#each section.entries as entry (entry.id)}
          {@const Icon = entry.icon}
          {@const current = isCurrentCatalogueEntry(entry, pathname)}
          <li>
            {#if entry.href !== null}
              <a
                href={entry.href}
                aria-current={current ? "page" : undefined}
                class="{ROW} {current ? ROW_CURRENT : ROW_AT_REST}"
                style="{ROW_HEIGHT}{current ? ROW_CURRENT_BAR : ''}"
              >
                <Icon class="size-16 shrink-0" aria-hidden="true" />
                <span class="min-w-0 grow">{entry.name}</span>
              </a>
            {:else}
              <span
                aria-disabled="true"
                title={entry.waitsOn === undefined ? undefined : soonDependencySentence(entry.waitsOn)}
                class="{ROW} text-text-subtle"
                style={ROW_HEIGHT}
              >
                <Icon class="size-16 shrink-0" aria-hidden="true" />
                <span class="min-w-0 grow">{entry.name}</span>
                <MaturityBadge stage={entry.stage} class="shrink-0" />
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <!-- The column is the structure, and the one sentence about its emptiness stands inside it.
         A catalogue reaches this only when the member holds no permission to anything in it. -->
    <p class="px-12 text-sm text-text-muted">No {noun} are available to you.</p>
  {/each}
</div>

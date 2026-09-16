<script lang="ts">
  /*
   * The navigation column of a two-sided catalogue screen: every entry the member may open,
   * grouped as its registry groups them, with the one the reader is standing on lit. Tools and
   * Reports both draw it inside the design system's NavigationLayout, so the two screens cannot
   * drift apart in what a "list of things on the left" looks like.
   *
   * IT READS THE SAME PROJECTION THE LANDING SCREEN READS. The sections are the catalogue's own
   * (report-catalogue.ts), so an entry added to a registry reaches the column
   * with no edit here, and the column and the landing index can never disagree about what the
   * catalogue holds. Names only: the descriptive line, the view switch and the search stay on the
   * landing screen, which is where a reader goes to find out what a thing does.
   *
   * A ROW IS THE DESIGN SYSTEM'S ROW. NavigationLayout.Row carries the control height, the hover
   * tint, the lit row's selected fill and gilt start-edge bar, and the wrap that keeps a long name
   * readable — the same part the settings nav uses, so a reader who has learned one two-sided
   * screen has learned them all. What stays here is the grouping and the indent stagger, which are
   * the catalogue's own and which the layout deliberately leaves to its consumer.
   *
   * AN ENTRY WITH NOWHERE TO GO IS STILL A ROW. The standing rule is that a designed-but-unwired
   * surface ships visible and marked, never omitted: a soon entry stands in its group with its
   * glyph and name, unlinked and quieter, wearing the Soon mark, and carrying what it waits on as
   * its hover title where the registry knows it. Passing `href={null}` is what says so — the same
   * spelling the catalogue vocabulary uses — and the row is never dressed as a disabled control,
   * which would read as broken rather than as not yet.
   */
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { NavigationLayoutRow } from "@magna-carta/design-system/navigation-layout";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import type { CatalogueSection } from "./catalogue.ts";
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
          <li>
            <!-- Two branches because the Soon mark belongs to exactly one of them, and a snippet
                 handed to a component cannot be declared inside a conditional. -->
            {#if entry.href === null}
              <NavigationLayoutRow
                href={null}
                title={entry.waitsOn === undefined
                  ? undefined
                  : soonDependencySentence(entry.waitsOn)}
              >
                {#snippet icon()}<Icon />{/snippet}
                {entry.name}
                {#snippet trailing()}<MaturityBadge stage={entry.stage} />{/snippet}
              </NavigationLayoutRow>
            {:else}
              <NavigationLayoutRow
                href={entry.href}
                current={isCurrentCatalogueEntry(entry, pathname)}
              >
                {#snippet icon()}<Icon />{/snippet}
                {entry.name}
              </NavigationLayoutRow>
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

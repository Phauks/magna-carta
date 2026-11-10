<script lang="ts">
  /*
   * The community board's own top bar. The board is a separate site on its own host, publicly
   * readable, so it carries the brand lockup with "Community" beside it (the same lockup the public
   * status page wears) instead of the application's shell, and its navigation is the board's five
   * places. Changelog leaves the board for the public changelog on the main domain.
   */
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Button from "@magna-carta/design-system/button";
  import Lightbulb from "@lucide/svelte/icons/lightbulb";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Newspaper from "@lucide/svelte/icons/newspaper";
  import { displayInitials } from "@magna-carta/community/display";

  export type CommunityPlace = "requests" | "questions" | "roadmap" | "known-issues";

  let {
    current,
    viewerDisplayName,
  }: {
    current: CommunityPlace;
    /** The signed-in member's board name, or null for a reader who has not signed in. */
    viewerDisplayName: string | null;
  } = $props();

  const PLACES = [
    { place: "requests", label: "Requests", icon: Lightbulb },
    { place: "questions", label: "Questions", icon: CircleHelp },
    { place: "roadmap", label: "Roadmap", icon: Columns3 },
    { place: "known-issues", label: "Known Issues", icon: TriangleAlert },
  ] as const;
</script>

<header class="border-b border-border-default bg-surface-default">
  <div class="flex items-center gap-24 px-32 py-12">
    <div class="flex items-center gap-8">
      <BrandMark />
      <FieldLabel>Community</FieldLabel>
    </div>
    <nav aria-label="Community" class="flex items-center gap-4">
      {#each PLACES as entry (entry.place)}
        {@const Icon = entry.icon}
        <a
          href="#{entry.place}"
          aria-current={entry.place === current ? "page" : undefined}
          class="flex items-center gap-8 rounded-md px-12 py-4 text-sm font-medium text-text-muted hover:bg-surface-sunken hover:text-text-default aria-[current=page]:bg-surface-selected aria-[current=page]:text-text-default"
        >
          <Icon class="size-16" aria-hidden="true" />
          {entry.label}
        </a>
      {/each}
      <a
        href="#changelog"
        class="flex items-center gap-8 rounded-md px-12 py-4 text-sm font-medium text-text-muted hover:bg-surface-sunken hover:text-text-default"
      >
        <Newspaper class="size-16" aria-hidden="true" />
        Changelog
      </a>
    </nav>
    <div class="ml-auto flex items-center gap-12">
      {#if viewerDisplayName === null}
        <Button variant="secondary" size="sm">Sign In</Button>
      {:else}
        <Avatar.Root>
          <Avatar.Fallback>{displayInitials(viewerDisplayName)}</Avatar.Fallback>
        </Avatar.Root>
      {/if}
    </div>
  </div>
</header>

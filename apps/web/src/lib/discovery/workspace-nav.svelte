<script lang="ts">
  /*
   * The review workspace's strip — route-driven navigation in the tabs register, the same visual
   * language as the matter's section strip and for the same reason: a reader has learned what a
   * strip of destinations looks like, and a second dialect of it would teach nothing.
   *
   * Real anchors inside a nav landmark rather than Bits UI's Tabs, whose state-based ARIA tablist
   * is the wrong semantics for links that change the address. No tablist ARIA is faked onto them;
   * where the reader is says so with aria-current.
   *
   * NO FOLD, because there is nothing to fold. Two entries fit any canvas, and the arithmetic the
   * matter strip needs for fourteen sections would be machinery here with nothing to do.
   */
  import { page } from "$app/state";
  import { WORKSPACE_ENTRIES } from "./workspace-strip.ts";

  let { reviewSetId }: { reviewSetId: string } = $props();

  function href(slug: string): string {
    return `/discovery/review-sets/${reviewSetId}/${slug}`;
  }

  function isCurrent(slug: string, pathname: string): boolean {
    const target = href(slug);
    return pathname === target || pathname.startsWith(`${target}/`);
  }

  // The shared tab treatment — the Tabs recipe's geometry and inks, spoken in token utilities.
  const tabClasses =
    "relative inline-flex items-center gap-8 px-12 py-8 text-sm leading-tight whitespace-nowrap " +
    "transition-colors duration-fast ease-standard";
  const tabInactiveClasses = "font-medium text-text-muted hover:text-text-default";
  const tabActiveClasses = "font-semibold text-text-default";
</script>

<nav aria-label="Review set" class="border-b border-border-strong">
  <div class="flex items-center">
    {#each WORKSPACE_ENTRIES as entry (entry.slug)}
      {@const current = isCurrent(entry.slug, page.url.pathname)}
      <a
        href={href(entry.slug)}
        title={entry.holds}
        aria-current={current ? "page" : undefined}
        class="{tabClasses} {current ? tabActiveClasses : tabInactiveClasses}"
      >
        {entry.label}
        {#if current}
          <!-- The gold bar over the rule — the active mark of the tabs register. -->
          <span
            class="absolute inset-x-12 bottom-0 bg-accent-default"
            style="block-size: var(--mc-focus-ring-width)"
            aria-hidden="true"
          ></span>
        {/if}
      </a>
    {/each}
  </div>
</nav>

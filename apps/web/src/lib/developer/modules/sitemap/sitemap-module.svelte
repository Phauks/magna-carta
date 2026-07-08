<script lang="ts">
  /*
   * The sitemap module — direct links to fixture and dev-only pages (dev-pages.ts), so a
   * half-built surface's design is reachable when the real data that would route to it does not
   * exist yet. Grouped; the registry is the only place to add a page. Links navigate the current
   * window, so from the popped-out console they turn it into a quick page viewer.
   */
  import { DEV_PAGE_GROUPS } from "../../dev-pages.ts";
</script>

<div class="flex flex-col gap-16">
  {#each DEV_PAGE_GROUPS as group (group.title)}
    <div class="flex flex-col gap-8">
      <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        {group.title}
      </p>
      <ul class="flex flex-col gap-2">
        {#each group.pages as devPage (devPage.href)}
          <li>
            <a
              href={devPage.href}
              class="flex items-baseline justify-between gap-8 rounded-md px-8 py-4 text-sm hover:bg-surface-sunken"
            >
              <span class="truncate">{devPage.label}</span>
              {#if devPage.note}
                <span class="shrink-0 text-xs text-text-muted">{devPage.note}</span>
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</div>

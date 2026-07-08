<script lang="ts">
  /*
   * The sitemap module — direct links to fixture and dev-only pages (dev-pages.ts), so a
   * half-built surface's design is reachable when the real data that would route to it does not
   * exist yet. Grouped; the registry is the only place to add a page.
   *
   * From the popped-out console (window.opener set) a link drives the MAIN window and keeps this
   * one as the dev view — you browse pages over there while the console stays put here. In the
   * top-bar popover (no opener) the link just navigates normally.
   */
  import { DEV_PAGE_GROUPS } from "../../dev-pages.ts";

  function openPage(event: MouseEvent, href: string): void {
    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      event.preventDefault();
      opener.location.href = href;
      opener.focus();
    }
  }
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
              onclick={(event) => openPage(event, devPage.href)}
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

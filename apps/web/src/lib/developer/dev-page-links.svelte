<script lang="ts">
  import FieldLabel from "@magna-carta/design-system/field-label";
  /*
   * The grouped page-link list for the Fixtures module (and any future listing that's a flat,
   * optionally-titled set rather than a tree). The Sitemap uses its own tree renderer.
   */
  import type { DevPageGroup } from "./dev-page.ts";
  import { openDevPage } from "./open-dev-page.ts";

  let { groups }: { groups: readonly DevPageGroup[] } = $props();
</script>

<div class="flex flex-col gap-16">
  {#each groups as group, index (group.title ?? index)}
    <div class="flex flex-col gap-8">
      {#if group.title}
        <FieldLabel as="p">
          {group.title}
        </FieldLabel>
      {/if}
      <ul class="flex flex-col gap-2">
        {#each group.pages as devPage (devPage.href)}
          <li>
            <a
              href={devPage.href}
              onclick={(event) => openDevPage(event, devPage.href)}
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

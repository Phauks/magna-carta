<script lang="ts">
  /*
   * THE SHARED WITH CELL: up to three people's initials, then their names. The names are
   * the column's value, so what a reader sorts and filters by is what they read here; the initials
   * are only there so a shared row is seen at a glance down the column. A row only the firm can see
   * is blank, never a word saying so.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import type { SharedPerson } from "./sharing-index.ts";

  let { people, text }: { people: readonly SharedPerson[]; text: string } = $props();

  const SHOWN = 3;
  const shown = $derived(people.slice(0, SHOWN));
</script>

{#if people.length > 0}
  <span class="flex min-w-0 items-center gap-8" title={text}>
    <span class="flex shrink-0 items-center gap-4">
      {#each shown as person (person.entityId)}
        <Avatar.Root
          class="size-24 bg-status-info-subtle"
          aria-hidden="true"
        >
          <Avatar.Fallback class="text-2xs text-status-info-subtle-foreground">
            {person.initials}
          </Avatar.Fallback>
        </Avatar.Root>
      {/each}
    </span>
    <span class="truncate">{text}</span>
  </span>
{/if}

<script lang="ts">
  /*
   * Who will read a report, said before it is sent: the firm's own admins, and Magna Carta where
   * the firm shares its reports. Read when a report dialog opens; until the answer arrives, and if
   * it cannot be read, only what is certain is said.
   */
  import { createQuery } from "@tanstack/svelte-query";
  import { incidentsGetSharingOptions } from "@magna-carta/api-client";
  import { SESSION_STABLE } from "$lib/api/screen-data.ts";

  const sharing = createQuery(() => ({ ...incidentsGetSharingOptions(), staleTime: SESSION_STABLE }));
  const shared = $derived(sharing.data?.sharesWithMagnaCarta === true);
</script>

<p class="text-xs text-text-muted">
  {#if shared}
    Read by your firm's admins and by Magna Carta, so the problem can be fixed. No document, file
    name or matter content is sent with it.
  {:else}
    Read by your firm's admins. No document, file name or matter content is sent with it.
  {/if}
</p>

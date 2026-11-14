<script lang="ts">
  /* The Shared Rooms card under the app root's cache and tooltip provider, as the Meetings page has it. */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { queryClient } from "$lib/api/screen-data.ts";
  import SharedRoomsCard from "../src/lib/meetings/shared-rooms-card.svelte";

  let { canHost }: { canHost: boolean } = $props();
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    <SharedRoomsCard {canHost} />
  </Tooltip.Provider>
</QueryClientProvider>

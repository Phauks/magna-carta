<script lang="ts">
  /* The My Room card under the app root's cache and tooltip provider, as the Meetings page has it. */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { queryClient } from "$lib/api/screen-data.ts";
  import MyRoomCard from "../src/lib/meetings/my-room-card.svelte";
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    <MyRoomCard />
  </Tooltip.Provider>
</QueryClientProvider>

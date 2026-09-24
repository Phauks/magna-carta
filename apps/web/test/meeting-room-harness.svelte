<script lang="ts">
  /*
   * The meeting screen under what the app's own root gives it: the one cache its reads go through,
   * and the one Tooltip.Provider the screen header's controls read their delays from.
   */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { queryClient } from "$lib/api/screen-data.ts";
  import MeetingPage from "../src/routes/(app)/meetings/[id]/+page.svelte";
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    <MeetingPage />
  </Tooltip.Provider>
</QueryClientProvider>

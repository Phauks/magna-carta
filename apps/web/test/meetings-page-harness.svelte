<script lang="ts">
  /*
   * The Meetings screen under the two things the app's own root gives it: the one cache it reads
   * through, and the one Tooltip.Provider every tooltip beneath it reads its delays from. Without
   * the second, the screen header's favourite control takes the whole render down with
   * `Context "Tooltip.Provider" not found`, which is the app's own arrangement rather than
   * anything this screen chose.
   */
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { queryClient } from "$lib/api/screen-data.ts";
  import MeetingsPage from "../src/routes/(app)/meetings/+page.svelte";
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    <MeetingsPage />
  </Tooltip.Provider>
</QueryClientProvider>

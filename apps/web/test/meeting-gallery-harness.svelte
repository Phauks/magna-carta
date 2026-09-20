<script lang="ts">
  /*
   * The gallery under what the app's root gives it: the one Tooltip.Provider a tile's pin control
   * reads its delays from. A Tooltip.Root with no provider above it throws as it mounts.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import MeetingGrid from "$lib/meetings/meeting-grid.svelte";
  import type { ComponentProps } from "svelte";

  let props: ComponentProps<typeof MeetingGrid> = $props();
</script>

<Tooltip.Provider>
  <MeetingGrid {...props} />
</Tooltip.Provider>

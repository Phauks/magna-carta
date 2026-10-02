<script lang="ts">
  /*
   * The host's per-person menu under what the app's root gives it: the one Tooltip.Provider the
   * surfaces around it read their delays from. A Tooltip.Root with no provider above it throws as
   * it mounts, and this menu sits inside components that carry one.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import MeetingHostMenu from "$lib/meetings/meeting-host-menu.svelte";
  import type { ComponentProps } from "svelte";

  let props: ComponentProps<typeof MeetingHostMenu> = $props();
</script>

<Tooltip.Provider>
  <MeetingHostMenu {...props} />
</Tooltip.Provider>

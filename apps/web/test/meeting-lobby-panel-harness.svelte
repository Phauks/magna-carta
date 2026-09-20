<script lang="ts">
  /*
   * The host's lobby panel under what the app's root gives it: the one Tooltip.Provider the
   * surfaces inside it read their delays from. A Tooltip.Root with no provider above it throws as
   * it mounts.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import MeetingLobbyPanel from "$lib/meetings/meeting-lobby-panel.svelte";
  import type { ComponentProps } from "svelte";

  let props: ComponentProps<typeof MeetingLobbyPanel> = $props();
</script>

<Tooltip.Provider>
  <MeetingLobbyPanel {...props} />
</Tooltip.Provider>

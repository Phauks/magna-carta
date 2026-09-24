<script lang="ts">
  /*
   * The control bar under the one Tooltip.Provider the app's root gives it — its glyph controls name
   * themselves on hover through the design system's tooltip, and a Tooltip.Root with no provider
   * above it throws as it mounts.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import MeetingControls from "$lib/meetings/meeting-controls.svelte";
  import type { ComponentProps } from "svelte";

  let props: ComponentProps<typeof MeetingControls> = $props();
</script>

<Tooltip.Provider>
  <MeetingControls {...props} />
</Tooltip.Provider>

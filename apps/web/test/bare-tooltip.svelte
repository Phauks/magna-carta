<script lang="ts">
  /*
   * A tooltip the way the signed-out screens carry one: a Root/Trigger/Content triple with nothing
   * of its own above it. Beneath the root layout it renders; mounted bare, it throws — which is
   * exactly the pair root-layout-tooltip-provider.test.ts pins.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
</script>

<Tooltip.Root>
  <Tooltip.Trigger>Build</Tooltip.Trigger>
  <Tooltip.Content>Build Information</Tooltip.Content>
</Tooltip.Root>

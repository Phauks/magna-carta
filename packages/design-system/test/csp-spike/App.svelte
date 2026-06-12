<script lang="ts">
  // CSP spike probe (bits-ui issue #1995): one Dialog (scroll-lock + focus trap), one
  // Popover and one Tooltip (Floating UI positioning) — deliberately unstyled beyond
  // probe.css. Behavior probe only; not a design-system component.
  import { Dialog, Popover, Tooltip } from "bits-ui";
</script>

<main>
  <h1>CSP spike probe</h1>

  <Dialog.Root>
    <Dialog.Trigger data-testid="dialog-trigger">Open dialog</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay data-testid="dialog-overlay" data-dialog-overlay />
      <Dialog.Content data-testid="dialog-content" data-dialog-content>
        <Dialog.Title>Probe dialog</Dialog.Title>
        <Dialog.Description>Scroll-lock and focus-trap probe.</Dialog.Description>
        <button data-testid="dialog-first-button" type="button">First</button>
        <button data-testid="dialog-second-button" type="button">Second</button>
        <Dialog.Close data-testid="dialog-close">Close</Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>

  <Popover.Root>
    <Popover.Trigger data-testid="popover-trigger">Open popover</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content data-testid="popover-content" data-popover-content>
        Popover content (Floating UI positioned)
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>

  <Tooltip.Provider delayDuration={0}>
    <Tooltip.Root>
      <Tooltip.Trigger data-testid="tooltip-trigger">Hover for tooltip</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content data-testid="tooltip-content" data-tooltip-content>
          Tooltip content (Floating UI positioned)
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>

  <div class="tall-spacer" aria-hidden="true"></div>
</main>

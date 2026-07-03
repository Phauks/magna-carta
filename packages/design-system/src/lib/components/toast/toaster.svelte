<script lang="ts">
  /*
   * Toaster — the transient-notification host (Tier 3: wraps svelte-sonner, NOT Bits UI). Mounts
   * ONCE near the app root (like Tooltip.Provider); the `toast()` function exported from index.ts
   * then enqueues notifications into it from anywhere. Sonner owns the portal, the stacking, the
   * swipe-to-dismiss and the auto-timeout; styling and layering are ours.
   *
   * Token bridge (sonner's documented CSS-variable channel): sonner reads its surface colours from
   * `--normal-bg/-text/-border` and its per-intent colours from the `--{success,error,warning,info}-
   * -{bg,text,border}` trios. It DEFINES those as literal HSL defaults in its own stylesheet
   * ([data-sonner-toaster]); we re-point them at our design tokens. Setting them INLINE on the host
   * beats any stylesheet rule, so the override needs no class-hook overrides in components.css and
   * keeps every value a `var(--mc-…)` token (no literals anywhere).
   *
   * Intent → status token (so a success toast reads identically to a success Alert, which consumes
   * the same subtle status tokens):
   *   success → status.success   error (sonner's name for danger) → status.danger
   *   warning → status.warning    info → status.info
   * Each intent gets the SUBTLE register: background = status.<intent>-subtle, text =
   * status.<intent>-subtle-foreground, and a soft same-hue hairline = status.<intent>-subtle-border.
   * That pale tint + deep same-hue text is the contrast-safe pairing the gate guarantees AA across
   * every theme × mode — the same calm callout Alert makes, not a saturated block.
   *
   * richColors is set ON here: it is the flag that makes sonner apply the per-intent trios above
   * (sonner only reads `--success-*` etc. under `[data-rich-colors='true']`). Without it, success and
   * error would fall back to the neutral `--normal-*` surface and lose their status colour, breaking
   * parity with Alert. Plain `toast()` (no intent) still uses the neutral surface.
   *
   * Defaults set here (callers and per-toast options still override): duration={5000} (a calm 5s),
   * closeButton (every toast is dismissible — sonner reveals it on hover/focus, so it is also a
   * keyboard-reachable dismiss), and pauseWhenPageIsHidden (a toast doesn't expire while the user is
   * away in another tab). sonner's default hotkey (Alt+T) is kept: Alt+T focuses the toast region so
   * keyboard users can Tab to the action/close button.
   */
  import { Toaster as SonnerToaster } from "svelte-sonner";
  import type { ComponentProps } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { Z_LAYER_CLASSES } from "../../internal/floating.ts";

  // The token bridge: sonner's CSS variables → our design tokens. Inline on the host so it overrides
  // sonner's own [data-sonner-toaster] defaults; the trios apply per-intent under richColors.
  const TOKEN_BRIDGE = [
    "--normal-bg: var(--mc-surface-raised)",
    "--normal-text: var(--mc-text-default)",
    "--normal-border: var(--mc-border-default)",
    "--success-bg: var(--mc-status-success-subtle)",
    "--success-text: var(--mc-status-success-subtle-foreground)",
    "--success-border: var(--mc-status-success-subtle-border)",
    "--error-bg: var(--mc-status-danger-subtle)",
    "--error-text: var(--mc-status-danger-subtle-foreground)",
    "--error-border: var(--mc-status-danger-subtle-border)",
    "--warning-bg: var(--mc-status-warning-subtle)",
    "--warning-text: var(--mc-status-warning-subtle-foreground)",
    "--warning-border: var(--mc-status-warning-subtle-border)",
    "--info-bg: var(--mc-status-info-subtle)",
    "--info-text: var(--mc-status-info-subtle-foreground)",
    "--info-border: var(--mc-status-info-subtle-border)",
  ].join("; ");

  let {
    position = "bottom-right",
    richColors = true,
    duration = 5000,
    closeButton = true,
    pauseWhenPageIsHidden = true,
    class: className,
    style,
    ...restProps
  }: ComponentProps<typeof SonnerToaster> = $props();
</script>

<SonnerToaster
  {position}
  {richColors}
  {duration}
  {closeButton}
  {pauseWhenPageIsHidden}
  class={mergeClasses(Z_LAYER_CLASSES.toast, className)}
  style={style ? `${TOKEN_BRIDGE}; ${style}` : TOKEN_BRIDGE}
  {...restProps}
/>

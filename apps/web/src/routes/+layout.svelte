<script lang="ts">
  import '../app.css'
  // The one Toaster host: toast() calls from anywhere in the app enqueue into it.
  import { Toaster } from '@magna-carta/design-system/toast'
  // The one Tooltip.Provider: every Tooltip.Root beneath it reads its open/close delays from here,
  // and a Root with no Provider above it does not render bare — it throws
  // (`Context "Tooltip.Provider" not found`) and takes the screen down with it. It sits HERE, above
  // every route group, because tooltips are not confined to the signed-in shell: the version chip
  // carries one onto the sign-in, password-reset and joining screens, which mount outside the (app)
  // group. While the Provider lived inside the app shell, clearing cookies and reloading landed a
  // visitor on a sign-in screen that crashed before it drew (test/root-layout-tooltip-provider.test.ts
  // pins this). The Toaster sits inside it for the same reason: a toast that ever carries a tooltip
  // must not be the next surface to find the context missing.
  import * as Tooltip from '@magna-carta/design-system/tooltip'
  // The render boundary: a throw while a route renders draws the failure screen with an Error ID
  // rather than leaving a blank page (the same crash above was the console-only kind). Inside the
  // Provider, so the failure screen's own controls have every context the rest of the app has.
  import RenderBoundary from '$lib/diagnostics/render-boundary.svelte'

  let { children } = $props()
</script>

<Tooltip.Provider>
  <RenderBoundary>
    {@render children()}
  </RenderBoundary>
  <Toaster />
</Tooltip.Provider>

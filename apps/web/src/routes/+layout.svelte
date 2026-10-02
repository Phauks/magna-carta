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
  // A guest's page gets its own boundary instead. Its address is the link it was opened from, token
  // and all, and the application's failure screen prints the address and offers a way into the
  // application — neither of which somebody outside the firm may be handed.
  import GuestRenderBoundary, {
    isGuestPageAddress,
  } from '$lib/meetings/guest-render-boundary.svelte'
  import { page } from '$app/state'
  // The one query cache: every screen's reads resolve against it, which is what lets a read started
  // in a route's load (on hover, before the click) be the same read the component then renders from.
  // It sits at the root rather than inside the (app) group because the sign-in and joining screens
  // read too, and a second cache under them would answer the same questions twice.
  import { QueryClientProvider } from '@tanstack/svelte-query'
  import { queryClient } from '$lib/api/screen-data.ts'

  let { children } = $props()
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider>
    {#if isGuestPageAddress(page.url.pathname)}
      <GuestRenderBoundary>
        {@render children()}
      </GuestRenderBoundary>
    {:else}
      <RenderBoundary>
        {@render children()}
      </RenderBoundary>
    {/if}
    <Toaster />
  </Tooltip.Provider>
</QueryClientProvider>

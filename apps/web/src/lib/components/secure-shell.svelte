<script lang="ts">
  /*
   * The Secure Shell — the fixed chrome for the elevated, walled-off surfaces where sensitive
   * personal and firm operations live (account credentials now; firm-user administration is the
   * next surface to reuse this). Deliberately NOT the App Shell: the workspace sidebar and its
   * tools (search, the timer, notifications, the profile menu) fall away so nothing competes with
   * a high-stakes task, and the quiet chrome band signals the shift into a more serious mode.
   *
   * Two honest exits — the brand mark returns Home (the universal convention), and Close (the X,
   * or the Escape key) returns to the previous screen. Same window, plain navigation: no popup, no
   * window.close.
   *
   * Reused across the secure surfaces; each supplies its own scoped rail (its sections) and its
   * page content. This shell owns only the stripped chrome band and the two-column frame.
   */
  import { afterNavigate, goto } from "$app/navigation";
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import X from "@lucide/svelte/icons/x";
  import type { Snippet } from "svelte";
  import { SECURE_SHELL_FALLBACK_RETURN, secureShellReturnTarget } from "./secure-shell-return.ts";

  let { rail, children }: { rail: Snippet; children: Snippet } = $props();

  // The screen Close returns to — captured ONCE, from the navigation that brought the member into
  // this surface. Moving between the surface's own subpages never changes it, so Close always
  // leaves the whole surface (not steps back one subpage). Reached directly (a full page load, no
  // in-app origin) → Home. `afterNavigate` runs on mount with that entry navigation, then on every
  // later navigation; the flag keeps only the first (the entry). The reading of that navigation —
  // including why a full page load is answered by its type rather than by `from` — is
  // ./secure-shell-return.ts.
  let returnTo = SECURE_SHELL_FALLBACK_RETURN;
  let entryCaptured = false;
  afterNavigate((navigation) => {
    if (entryCaptured) return;
    entryCaptured = true;
    returnTo = secureShellReturnTarget(navigation);
  });

  function close(): void {
    goto(returnTo);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex h-screen flex-col overflow-hidden bg-surface-default">
  <!-- The stripped chrome band: the brand returns Home, Close returns to the previous screen —
       nothing else lives here. Chrome-register surface, where the brand mark belongs (identity at
       the program's edges; the work canvas below stays calm). -->
  <header
    class="flex shrink-0 items-center justify-between gap-8 bg-chrome-surface px-16"
    style="min-block-size: var(--mc-size-top-bar)"
  >
    <a href="/home" aria-label="Magna Carta — Home" class="rounded-md">
      <BrandMark />
    </a>
    <button type="button" class="mc-top-bar-icon-button" aria-label="Close" onclick={close}>
      <X class="size-16" aria-hidden="true" />
    </button>
  </header>

  <!-- The two-column secure frame: the scoped rail beside the surface content, each scrolling on
       its own; the frame itself never scrolls. -->
  <div class="flex min-h-0 grow">
    {@render rail()}
    <div class="flex min-w-0 grow flex-col">
      {@render children()}
    </div>
  </div>
</div>

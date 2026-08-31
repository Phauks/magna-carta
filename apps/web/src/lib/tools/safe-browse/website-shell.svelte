<script lang="ts">
  /*
   * The browser-shell viewport for a safe-browse capture. The frame renders the moment a capture
   * starts and holds its shape while the isolated remote browser works: the viewport shows a calm
   * placeholder until the capture has completed, and only then does the finished screenshot
   * populate in. Nothing partial ever appears — the member sees either the placeholder or the
   * finished static image of the suspect page, never a half-loaded one. The screenshot is a plain
   * <img> over a data: URL; nothing in the frame is live, and the top bar's address is text, never
   * an anchor.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Globe from "@lucide/svelte/icons/globe";

  let {
    capturing,
    finalUrl = null,
    differentHost = false,
    screenshot = null,
  }: {
    /** Whether the isolated browser is still rendering — the viewport holds its placeholder. */
    capturing: boolean;
    /** The address the capture actually ended on; null while the capture is running. */
    finalUrl?: string | null;
    /** Whether the capture ended on a different host than the one the member asked about. */
    differentHost?: boolean;
    /** The finished screenshot as an <img> source, or null when the renderer returned none. */
    screenshot?: string | null;
  } = $props();
</script>

<div class="overflow-hidden rounded-md border border-border-default">
  <div
    class="flex min-w-0 items-center gap-8 border-b border-border-default bg-surface-sunken px-12 py-8"
  >
    <Globe class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
    {#if capturing}
      <Skeleton class="h-16 w-1/2" />
    {:else if finalUrl !== null}
      <span class="min-w-0 truncate font-mono text-xs text-text-default" title={finalUrl}>
        {finalUrl}
      </span>
      {#if differentHost}
        <Badge variant="warning" class="shrink-0">Different Site</Badge>
      {/if}
    {/if}
  </div>
  <div class="mc-scrollbar aspect-video overflow-y-auto bg-surface-sunken">
    {#if capturing}
      <div class="flex h-full flex-col items-center justify-center gap-8">
        <Skeleton class="h-16 w-96" />
        <p class="text-sm text-text-muted">Rendering in the isolated browser…</p>
      </div>
    {:else if screenshot !== null}
      <img
        src={screenshot}
        alt="Static screenshot of the captured page"
        class="block w-full max-w-full"
      />
    {:else}
      <div class="flex h-full items-center justify-center">
        <p class="text-sm text-text-muted">The renderer returned no screenshot for this page.</p>
      </div>
    {/if}
  </div>
</div>

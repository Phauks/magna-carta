<script lang="ts">
  /*
   * A scan or file shown on the page itself, under the list it was picked from (owner's ask,
   * 2026-11-19: "allow clicking a file from within this screen"). An image is drawn, a PDF is
   * opened in the browser's own viewer, and Download saves it. Previous and Next step through the
   * other files of the same list, so a stack of check scans can be read without closing anything.
   */
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Download from "@lucide/svelte/icons/download";
  import X from "@lucide/svelte/icons/x";
  import type { PreviewFile } from "./preview-file.ts";

  let {
    files,
    shownKey,
    onShow,
    onClose,
  }: {
    files: readonly PreviewFile[];
    shownKey: string;
    onShow: (key: string) => void;
    onClose: () => void;
  } = $props();

  const index = $derived(files.findIndex((file) => file.key === shownKey));
  const shown = $derived(files[index]);
</script>

{#if shown !== undefined}
  <figure class="flex flex-col gap-8 rounded-md border border-border-default bg-surface-raised p-8">
    <figcaption class="flex flex-wrap items-center gap-8">
      <span class="min-w-0 flex-1 truncate text-sm font-medium" title={shown.name}>{shown.name}</span>
      {#if files.length > 1}
        <span class="text-xs text-text-muted">{index + 1} of {files.length}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous file"
          disabled={index <= 0}
          onclick={() => onShow(files[index - 1]?.key ?? shownKey)}
        >
          <ChevronLeft class="size-16" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next file"
          disabled={index >= files.length - 1}
          onclick={() => onShow(files[index + 1]?.key ?? shownKey)}
        >
          <ChevronRight class="size-16" aria-hidden="true" />
        </Button>
      {/if}
      <a
        class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
        href={shown.url}
        download={shown.name}
        aria-label="Download {shown.name}"
        title="Download"
      >
        <Download class="size-16" aria-hidden="true" />
      </a>
      <Button variant="ghost" size="icon-sm" aria-label="Close" title="Close" onclick={onClose}>
        <X class="size-16" aria-hidden="true" />
      </Button>
    </figcaption>
    {#if shown.contentType === "application/pdf"}
      <iframe src={shown.url} title={shown.name} class="aspect-4/3 w-full rounded-sm bg-surface-sunken"></iframe>
    {:else}
      <img src={shown.url} alt={shown.name} class="aspect-4/3 w-full rounded-sm bg-surface-sunken object-contain" />
    {/if}
  </figure>
{/if}

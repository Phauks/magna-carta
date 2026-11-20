<script lang="ts">
  /*
   * The scans and files chosen for one line, or for the whole deposit, before it is recorded: a
   * row each (click to show it here, x to take it off), a place to drop more, and the file being
   * shown. Nothing is sent until Record; the screen sends them once each line has its receipt.
   */
  import Button from "@magna-carta/design-system/button";
  import Dropzone from "@magna-carta/design-system/dropzone";
  import { formatByteSize } from "$lib/firm-usage/firm-usage-format.ts";
  import FileText from "@lucide/svelte/icons/file-text";
  import X from "@lucide/svelte/icons/x";
  import FilePreview from "./file-preview.svelte";
  import { FILE_TYPES, type PendingFile } from "./deposit-form.svelte.ts";
  import { objectAddress } from "./object-addresses.ts";

  let {
    files,
    label,
    shownKey = $bindable(null),
    disabled = false,
    onAdd,
    onRemove,
  }: {
    files: readonly PendingFile[];
    /** What the drop surface is for, for a screen reader: "Files for line 2". */
    label: string;
    shownKey?: string | null;
    disabled?: boolean;
    onAdd: (files: File[]) => void;
    onRemove: (key: string) => void;
  } = $props();

  const previews = $derived(
    files.map((pending) => ({
      key: pending.key,
      name: pending.file.name,
      url: objectAddress(pending.file),
      contentType: pending.file.type,
    })),
  );
</script>

<div class="flex flex-col gap-8">
  {#if files.length > 0}
    <ul class="flex flex-col gap-4" aria-label={label}>
      {#each files as pending (pending.key)}
        <li
          class="flex items-center gap-8 rounded-md border border-border-default bg-surface-raised px-8 py-4"
          data-shown={shownKey === pending.key ? "" : undefined}
        >
          {#if pending.file.type.startsWith("image/")}
            <img src={objectAddress(pending.file)} alt="" class="size-24 shrink-0 rounded-sm object-cover" />
          {:else}
            <FileText class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
          {/if}
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-start text-sm text-text-link underline underline-offset-2"
            title="Show {pending.file.name}"
            onclick={() => (shownKey = shownKey === pending.key ? null : pending.key)}
          >
            {pending.file.name}
          </button>
          {#if pending.kind === "scan"}
            <span class="text-xs text-text-muted">Scan</span>
          {/if}
          <span class="text-xs text-text-muted tabular-nums">{formatByteSize(pending.file.size)}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove {pending.file.name}"
            title="Remove"
            {disabled}
            onclick={() => {
              if (shownKey === pending.key) shownKey = null;
              onRemove(pending.key);
            }}
          >
            <X class="size-16" aria-hidden="true" />
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if shownKey !== null}
    <FilePreview
      files={previews}
      shownKey={shownKey}
      onShow={(key) => (shownKey = key)}
      onClose={() => (shownKey = null)}
    />
  {/if}
  <Dropzone
    class="flex-row flex-wrap gap-8 px-12 py-8 text-start"
    {label}
    prompt="Drop a scan, a confirmation or a receipt here, or choose a file"
    accept={FILE_TYPES}
    multiple
    {disabled}
    onFiles={onAdd}
  />
</div>

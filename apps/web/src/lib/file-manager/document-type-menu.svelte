<script lang="ts">
  /*
   * Setting a document type. It is a DROPDOWN ANCHORED to whatever opened it, never a modal: the
   * choice is one value from a list, and a dialog for that stops the reader from seeing the row
   * they are classifying.
   *
   * It filters as you type, because a firm's vocabulary runs to hundreds of labels and a plain list
   * does not scale to that. Typing a label the firm does not have offers to ADD it: the vocabulary
   * is the firm's own and editable, which is the whole point of it being a firm list rather than
   * ours.
   */
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Input from "@magna-carta/design-system/input";
  import Check from "@lucide/svelte/icons/check";
  import Plus from "@lucide/svelte/icons/plus";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { Snippet } from "svelte";
  import type { DocumentTypeSummary } from "./matter-file-api.ts";

  let {
    documentTypes,
    chosenDocumentTypeId,
    onPick,
    onAdd,
    trigger,
  }: {
    documentTypes: readonly DocumentTypeSummary[];
    /** The type in force, or null where none is set. */
    chosenDocumentTypeId: string | null;
    onPick: (documentTypeId: string | null) => void;
    onAdd: (name: string) => void;
    /** The control this menu hangs off: the field that displays the value. */
    trigger: Snippet;
  } = $props();

  let query = $state("");

  const live = $derived(documentTypes.filter((type) => type.deactivatedAt === null));
  const matching = $derived(
    live.filter((type) => type.name.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const exact = $derived(
    live.some((type) => type.name.toLowerCase() === query.trim().toLowerCase()),
  );
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {@render trigger()}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="mc-scrollbar overflow-y-auto">
    <div class="p-4">
      <Input
        size="sm"
        bind:value={query}
        placeholder={placeholderOf("Document Type")}
        aria-label="Filter the firm's document types"
      />
    </div>
    <DropdownMenu.Item onSelect={() => onPick(null)}>
      {#if chosenDocumentTypeId === null}
        <Check class="size-16" aria-hidden="true" />
      {/if}
      <span class="text-text-muted">No document type</span>
    </DropdownMenu.Item>
    {#each matching as type (type.id)}
      <DropdownMenu.Item onSelect={() => onPick(type.id)}>
        {#if chosenDocumentTypeId === type.id}
          <Check class="size-16" aria-hidden="true" />
        {/if}
        {type.name}
      </DropdownMenu.Item>
    {/each}
    {#if matching.length === 0 && query.trim() === ""}
      <!-- An empty catalogue is genuinely empty. Nothing here is padded with examples. -->
      <DropdownMenu.Item disabled title="The firm has not recorded any document types yet.">
        No document types yet
      </DropdownMenu.Item>
    {/if}
    {#if query.trim() !== "" && !exact}
      <DropdownMenu.Separator />
      <DropdownMenu.Item onSelect={() => onAdd(query.trim())}>
        <Plus class="size-16" aria-hidden="true" />
        Add "{query.trim()}" to the Firm's Types
      </DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>

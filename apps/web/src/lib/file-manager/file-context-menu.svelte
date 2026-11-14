<script lang="ts">
  /*
   * The right-click menu over the file area — one menu wrapping the whole list rather than one per
   * row, because the row a right-click landed on is recorded from the event and the menu acts on
   * that. A menu per row would put a trigger element inside every table row, which a table body
   * cannot hold.
   *
   * WHAT IT RENDERS IS A MODEL, not a template full of conditions: file-menu-model.ts decides which
   * items exist, what each one is called over this particular selection, and which are disabled and
   * why. This component turns that into rows. The three flyouts are rendered here because each is a
   * grid of controls rather than a list of items — colours, marks, and the firm's document types.
   */
  import * as ContextMenu from "@magna-carta/design-system/context-menu";
  import Badge from "@magna-carta/design-system/badge";
  import Input from "@magna-carta/design-system/input";
  import Keyboard from "@magna-carta/design-system/keyboard";
  import Pin from "@lucide/svelte/icons/pin";
  import Check from "@lucide/svelte/icons/check";
  import Plus from "@lucide/svelte/icons/plus";
  import { FOLDER_COLORS, FOLDER_ICONS } from "@magna-carta/design-system/folder-tree";
  import type { FolderColorName, FolderIconName } from "@magna-carta/design-system/folder-tree";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { Snippet } from "svelte";
  import type { DocumentTypeSummary } from "./matter-file-api.ts";
  import type { FileMenuCommand, FileMenuEntry } from "./file-menu-model.ts";

  let {
    entries,
    documentTypes,
    /** The type every file in the scope already carries, when they agree. */
    sharedDocumentTypeId = null,
    sharedColor = null,
    sharedIcon = null,
    onCommand,
    onPickDocumentType,
    onAddDocumentType,
    onPickColor,
    onPickIcon,
    onPickConversion,
    onOpenChange,
    children,
  }: {
    entries: readonly FileMenuEntry[];
    documentTypes: readonly DocumentTypeSummary[];
    sharedDocumentTypeId?: string | null;
    sharedColor?: FolderColorName | null;
    sharedIcon?: FolderIconName | null;
    onCommand: (command: FileMenuCommand) => void;
    onPickDocumentType: (documentTypeId: string | null) => void;
    onAddDocumentType: (name: string) => void;
    onPickColor: (color: FolderColorName) => void;
    onPickIcon: (icon: FolderIconName) => void;
    /** A Convert target was chosen, by the conversion graph's format id. */
    onPickConversion: (formatId: string) => void;
    onOpenChange?: (open: boolean) => void;
    children: Snippet;
  } = $props();

  /** The type flyout filters as you type, because a firm's vocabulary runs to hundreds of labels. */
  let typeQuery = $state("");
  const matchingTypes = $derived(
    documentTypes
      .filter((type) => type.deactivatedAt === null)
      .filter((type) => type.name.toLowerCase().includes(typeQuery.trim().toLowerCase())),
  );
  /** Typing a label the firm does not have offers to add it: the vocabulary is the firm's own. */
  const exactMatch = $derived(
    documentTypes.some((type) => type.name.toLowerCase() === typeQuery.trim().toLowerCase()),
  );
</script>

<ContextMenu.Root {onOpenChange}>
  <!-- The trigger region IS the list area, so it has to grow with the column it sits in: an
       auto-height trigger left the table at its content height and the footer floating mid-screen. -->
  <ContextMenu.Trigger class="flex min-h-0 flex-1 flex-col">
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    {#each entries as entry, index (index)}
      {#if entry.kind === "separator"}
        <ContextMenu.Separator />
      {:else if entry.kind === "item"}
        <ContextMenu.Item
          disabled={entry.disabledReason !== undefined}
          title={entry.disabledReason}
          data-danger={entry.danger === true ? "true" : undefined}
          onSelect={() => onCommand(entry.command)}
          closeOnSelect={entry.command !== "pin" && entry.command !== "unpin"}
        >
          {#if entry.command === "pin" || entry.command === "unpin"}
            <!-- One glyph, and fill is the only difference between pinned and not. A second
                 geometry would read as a different thing. -->
            <Pin
              class="size-16"
              aria-hidden="true"
              fill={entry.pinned === true ? "currentColor" : "none"}
            />
          {/if}
          {entry.label}
          {#if entry.soon === true}
            <Badge variant="neutral" class="ms-auto">Soon</Badge>
          {:else if entry.shortcut !== undefined}
            <Keyboard class="ms-auto">{entry.shortcut}</Keyboard>
          {/if}
        </ContextMenu.Item>
      {:else if entry.command === "documentType"}
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger disabled={entry.disabledReason !== undefined}>
            {entry.label}
          </ContextMenu.SubTrigger>
          <ContextMenu.SubContent class="mc-scrollbar overflow-y-auto">
            <!-- The field keeps its own keys: without this, a character typed here reaches the
                 menu's typeahead and jumps focus onto a type row mid-word. -->
            <div class="p-4" role="presentation" onkeydown={ContextMenu.keepMenuFieldKeys}>
              <Input
                size="sm"
                bind:value={typeQuery}
                placeholder={placeholderOf("Document Type")}
                aria-label="Filter the firm's document types"
              />
            </div>
            <ContextMenu.Item onSelect={() => onPickDocumentType(null)}>
              {#if sharedDocumentTypeId === null}
                <Check class="size-16" aria-hidden="true" />
              {/if}
              <span class="text-text-muted">No document type</span>
            </ContextMenu.Item>
            {#each matchingTypes as type (type.id)}
              <ContextMenu.Item onSelect={() => onPickDocumentType(type.id)}>
                {#if sharedDocumentTypeId === type.id}
                  <Check class="size-16" aria-hidden="true" />
                {/if}
                {type.name}
              </ContextMenu.Item>
            {/each}
            {#if typeQuery.trim() !== "" && !exactMatch}
              <ContextMenu.Separator />
              <ContextMenu.Item onSelect={() => onAddDocumentType(typeQuery.trim())}>
                <Plus class="size-16" aria-hidden="true" />
                Add "{typeQuery.trim()}" to the Firm's Types
              </ContextMenu.Item>
            {/if}
          </ContextMenu.SubContent>
        </ContextMenu.Sub>
      {:else if entry.command === "color"}
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger>
            <!-- The label's own pip is a swatch like any other, so it is a true square too: that
                 is where the rounding a reader keeps seeing actually lives. -->
            <span
              class="mc-folder-tree-pip"
              data-folder-color={sharedColor ?? "none"}
              aria-hidden="true"
            ></span>
            {entry.label}
          </ContextMenu.SubTrigger>
          <ContextMenu.SubContent class="mc-folder-tree-palette">
            {#each FOLDER_COLORS as color (color.name)}
              <ContextMenu.Item
                class="mc-folder-tree-swatch"
                data-folder-color={color.name}
                data-folder-ink={color.ink}
                aria-label={color.label}
                onSelect={() => onPickColor(color.name)}
              >
                {#if sharedColor === color.name}
                  <!-- Inside the square, in whichever ink reads against that fill: an indicator
                       that never leaves the box cannot overlap its neighbours. -->
                  <Check class="mc-folder-tree-swatch-check" aria-hidden="true" />
                {/if}
              </ContextMenu.Item>
            {/each}
          </ContextMenu.SubContent>
        </ContextMenu.Sub>
      {:else if entry.command === "icon"}
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger>{entry.label}</ContextMenu.SubTrigger>
          <ContextMenu.SubContent>
            {#each FOLDER_ICONS as choice (choice.name)}
              {@const Glyph = choice.closed}
              <ContextMenu.Item onSelect={() => onPickIcon(choice.name)}>
                <Glyph class="mc-folder-tree-menu-icon" aria-hidden="true" />
                {choice.label}
                {#if (sharedIcon ?? "plain") === choice.name}
                  <Check class="mc-folder-tree-menu-check" aria-hidden="true" />
                {/if}
              </ContextMenu.Item>
            {/each}
          </ContextMenu.SubContent>
        </ContextMenu.Sub>
      {:else}
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger disabled={entry.disabledReason !== undefined} title={entry.disabledReason}>
            {entry.label}
          </ContextMenu.SubTrigger>
          <ContextMenu.SubContent class="mc-scrollbar overflow-y-auto">
            <!-- The targets read as extensions, never as our category names (file-menu-model.ts). -->
            {#each entry.formats ?? [] as format (format.id)}
              <ContextMenu.Item onSelect={() => onPickConversion(format.id)}>{format.label}</ContextMenu.Item>
            {/each}
          </ContextMenu.SubContent>
        </ContextMenu.Sub>
      {/if}
    {/each}
  </ContextMenu.Content>
</ContextMenu.Root>

<script lang="ts">
  /*
   * THE OPEN CONVERSATION'S OWN MENU — the `…` beside its name.
   *
   * The owner's ruling for the Magnus page (docs/conventions/magnus-rulings.md, R2.11): the acts on a
   * conversation live in one menu rather than a row of icons. It is the screen-header page menu's
   * twin (apps/web/src/lib/screen/page-actions-menu.svelte): the same vertical ellipsis named
   * "More", the same Copy Link and Open in New Tab first, so a member meets one control for "the
   * thing I am looking at" whether that is a page or the conversation inside it. The link is to THIS
   * conversation, which is why the page menu's own link cannot serve: the workspace's address is the
   * whole workspace, and only this menu knows which conversation is open.
   *
   * Then the conversation's own acts: rename, save it to a different matter (whose dialog warns that
   * the matter decides who can read it), download its transcript, and delete it, last and set apart.
   * Only live acts are here. Sharing, pinning and folders are in the owner's ruling and have no
   * record behind them yet, and a seam behind a glyph is a seam nobody sees
   * (docs/conventions/design-corrections.md), so they arrive with their tables, not before.
   */
  import Download from "@lucide/svelte/icons/download";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import Link from "@lucide/svelte/icons/link";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { toast } from "@magna-carta/design-system/toast";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { page } from "$app/state";
  import { openBeside } from "$lib/navigation/open-beside.ts";
  import { conversationLink } from "./conversation-link.ts";

  let {
    conversationId,
    disabled = false,
    downloading = false,
    onRename,
    onMove,
    onDownload,
    onDelete,
  }: {
    /** The open conversation, or null while none is open (the menu is then refused). */
    conversationId: string | null;
    /** True while a message is being sent, when the record should not change underneath it. */
    disabled?: boolean;
    /** True while a transcript download is being assembled, so a second press does not start another. */
    downloading?: boolean;
    onRename: () => void;
    onMove: () => void;
    onDownload: () => void;
    onDelete: () => void;
  } = $props();

  /*
   * Rename opens the edit field where the name stands. The menu hands focus back to its trigger as
   * it closes, which would blur the field the moment it opened and commit an unchanged name, so a
   * rename waits for the close and keeps focus off the trigger.
   */
  let renameOnClose = false;

  const link = $derived(
    conversationId === null ? null : conversationLink(page.url, conversationId).href,
  );

  async function copyLink(): Promise<void> {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy the link. Open the conversation in a new tab and copy it there.");
    }
  }

  function openInNewTab(): void {
    if (link === null) return;
    openBeside(link, "requested");
  }
</script>

<DropdownMenu.Root>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props: tooltipProps })}
        <DropdownMenu.Trigger
          {...tooltipProps}
          class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
          aria-label="More about this conversation"
          disabled={conversationId === null}
        >
          <EllipsisVertical class="size-16" aria-hidden="true" />
        </DropdownMenu.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">More</Tooltip.Content>
  </Tooltip.Root>
  <DropdownMenu.Content
    align="end"
    onCloseAutoFocus={(event) => {
      if (!renameOnClose) return;
      renameOnClose = false;
      event.preventDefault();
      onRename();
    }}
  >
    <DropdownMenu.Item onSelect={() => void copyLink()}>
      <Link class="size-16 shrink-0" aria-hidden="true" />
      Copy Link
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={openInNewTab}>
      <SquareArrowOutUpRight class="size-16 shrink-0" aria-hidden="true" />
      Open in New Tab
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item {disabled} onSelect={() => (renameOnClose = true)}>
      <PencilLine class="size-16 shrink-0" aria-hidden="true" />
      Rename
    </DropdownMenu.Item>
    <DropdownMenu.Item {disabled} onSelect={onMove}>
      <FolderInput class="size-16 shrink-0" aria-hidden="true" />
      Save to a Different Matter
    </DropdownMenu.Item>
    <DropdownMenu.Item disabled={downloading} onSelect={onDownload}>
      <Download class="size-16 shrink-0" aria-hidden="true" />
      {downloading ? "Preparing Transcript" : "Download Transcript"}
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item {disabled} onSelect={onDelete}>
      <Trash2 class="size-16 shrink-0" aria-hidden="true" />
      Delete
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<script lang="ts">
  /*
   * THE PAGE'S OWN MENU — the `…` beside the favourite star on every screen header.
   *
   * It holds what is ABOUT this page rather than work done ON it: a link to it, a second tab of it,
   * and whatever secondary page-level actions the screen passes in (a settings page it hands off
   * to, a history it can forget). Search, create, filters and the screen's main action stay on the
   * row at the inline end; this menu is never where a member goes to do the day's work.
   *
   * WHY BESIDE THE STAR AND NOT IN PLACE OF IT (owner's selection, 2026-11-09). The star shows a
   * state as well as offering a gesture: a gold star is the only thing that tells a member the page
   * is already a favourite, and inside a menu that answer is hidden. So the star stays where it was
   * and the menu sits next to it, on the title's row, which is where a screen with a trailing column
   * keeps its page-level controls together (see screen-header.svelte).
   *
   * ONE "MORE" ACROSS THE PRODUCT. It wears the record window's own menu control — the vertical
   * ellipsis named "More", items as plain DropdownMenu rows with a leading icon — so a member who
   * meets it on a screen and again in a record's dialog header (a person over Directory, a task)
   * meets the same control (packages/design-system/src/lib/components/record-window).
   *
   * IT ALWAYS EARNS ITS GLYPH. A menu is drawn only when opening it offers two or more live items
   * (docs/conventions/design-corrections.md, "A menu earns its glyph"), and the two below work on
   * every page, so a screen that passes nothing still gets a menu worth opening. A screen's own
   * items go beneath a separator, and they are live ones only: an unwired action stays on the row,
   * disabled and marked Soon, because a seam behind a glyph is a seam nobody sees.
   */
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Link from "@lucide/svelte/icons/link";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { toast } from "@magna-carta/design-system/toast";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { page } from "$app/state";
  import type { Snippet } from "svelte";

  let { title, items }: { title: string; items?: Snippet } = $props();

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(page.url.href);
      toast.success("Link copied.");
    } catch {
      // The clipboard refuses without a secure context or a user gesture the browser accepts. The
      // address bar still carries the same link, so the fallback is to say where it is.
      toast.error("Could not copy the link. Copy it from the address bar instead.");
    }
  }

  function openInNewTab(): void {
    // `noopener` so the new tab cannot reach back into this one through `window.opener`.
    window.open(page.url.href, "_blank", "noopener");
  }
</script>

<DropdownMenu.Root>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props: tooltipProps })}
        <DropdownMenu.Trigger
          {...tooltipProps}
          class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
          aria-label="More"
          data-page-actions=""
        >
          <EllipsisVertical class="size-16" aria-hidden="true" />
        </DropdownMenu.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">More</Tooltip.Content>
  </Tooltip.Root>
  <DropdownMenu.Content align="start">
    <DropdownMenu.Item onSelect={() => void copyLink()}>
      <Link class="size-16 shrink-0" aria-hidden="true" />
      Copy Link
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={openInNewTab}>
      <SquareArrowOutUpRight class="size-16 shrink-0" aria-hidden="true" />
      Open in New Tab
    </DropdownMenu.Item>
    {#if items !== undefined}
      <DropdownMenu.Separator />
      {@render items()}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>

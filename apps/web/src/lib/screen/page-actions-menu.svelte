<script lang="ts">
  /*
   * THE PAGE'S OWN MENU — the `…` beside the title on every screen header.
   *
   * It holds what is ABOUT this page rather than work done ON it: saving it as a favourite, a link
   * to it, a second tab of it,
   * and whatever secondary page-level actions the screen passes in (a settings page it hands off
   * to, a history it can forget). Search, create, filters and the screen's main action stay on the
   * row at the inline end; this menu is never where a member goes to do the day's work.
   *
   * THE FAVOURITE IS ITS FIRST ITEM (owner's direction, 2026-11-09: "move star to page ... menu").
   * Add to Favorites or Remove from Favorites, with the star glyph filled gold while the page is
   * saved, so the menu answers "is this a favourite" the moment it opens. It still reaches every
   * page without a screen opting in, because every screen's header draws this menu. WHAT IT SAVES
   * is the address in the bar and the header's own title, never a name scraped from the DOM: a
   * favourite named from a heading silently renames itself the day the heading's markup changes.
   *
   * ONE "MORE" ACROSS THE PRODUCT. It wears the record window's own menu control — the vertical
   * ellipsis named "More", items as plain DropdownMenu rows with a leading icon — so a member who
   * meets it on a screen and again in a record's dialog header (a person over Directory, a task)
   * meets the same control (packages/design-system/src/lib/components/record-window).
   *
   * IT ALWAYS EARNS ITS GLYPH. A menu is drawn only when opening it offers two or more live items
   * (docs/conventions/design-corrections.md, "A menu earns its glyph"), and the three below work on
   * every page, so a screen that passes nothing still gets a menu worth opening. A screen's own
   * items go beneath a separator, and they are live ones only: an unwired action stays on the row,
   * disabled and marked Soon, because a seam behind a glyph is a seam nobody sees.
   */
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Link from "@lucide/svelte/icons/link";
  import Star from "@lucide/svelte/icons/star";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { toast } from "@magna-carta/design-system/toast";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import { isFavorite, toggleFavorite } from "$lib/navigation/favorites.svelte.ts";

  let { title, items }: { title: string; items?: Snippet } = $props();

  const path = $derived(page.url.pathname);
  const saved = $derived(isFavorite(path));

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
    <!-- `data-favorite` carries the state for anything scripted; the filled glyph and the label
         carry it for a reader. -->
    <DropdownMenu.Item
      data-favorite={saved ? "true" : "false"}
      onSelect={() => toggleFavorite(path, title)}
    >
      <Star
        class="size-16 shrink-0 {saved ? 'fill-current text-accent-default' : ''}"
        aria-hidden="true"
      />
      {saved ? "Remove from Favorites" : "Add to Favorites"}
    </DropdownMenu.Item>
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

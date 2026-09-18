<script lang="ts">
  /*
   * THE STAR EVERY SCREEN CARRIES — how a page becomes a favourite.
   *
   * It lives in the screen header, which is the one component every screen in the product builds
   * its title from, so the gesture reaches every page without a single screen opting in: a matter,
   * a tool, a client's record, a review set, a section deep inside a matter. That was the whole
   * problem to solve (owner's direction, 2026-09-16) — the platform cannot declare in advance which
   * of ten thousand matters somebody opens every morning, so the person standing on it says so.
   *
   * WHAT IT SAVES is the address in the bar and the title beside it, which is why it takes the
   * title rather than reading one from the DOM: the screen's own name is already in hand, and a
   * favourite named by scraping a heading is a favourite that silently renames itself the day the
   * heading's markup changes.
   *
   * A STAR, not a bookmark or a pin, and the mark is the point. Customize mode's show/hide gave the
   * star up for an eye on the same ruling, precisely so one symbol stopped answering two questions.
   *
   * THE STAR CARRIES THE STATE ALONE (owner's correction, 2026-09-17: "only the star should be
   * yellow, there should not be a box around the star"). So this is not a pressed toggle: the ghost
   * recipe rings a pressed control with an accent hairline, which is right for a view or pane toggle
   * whose glyph does not change, and here it drew a box around the one mark already doing the
   * talking. The state is the glyph — filled and gold when saved, an outline in the header's muted
   * ink when not — with the label saying it in words for a reader who cannot see the fill, and
   * `data-favorite` carrying it for anything scripted.
   */
  import Star from "@lucide/svelte/icons/star";
  import Button from "@magna-carta/design-system/button";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { page } from "$app/state";
  import { isFavorite, toggleFavorite } from "$lib/navigation/favorites.svelte.ts";

  let { title }: { title: string } = $props();

  const path = $derived(page.url.pathname);
  const saved = $derived(isFavorite(path));
  const label = $derived(saved ? `Remove ${title} from favorites` : `Add ${title} to favorites`);
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        data-favorite={saved ? "true" : "false"}
        onclick={() => toggleFavorite(path, title)}
      >
        <!-- Filled while it is saved: a favourite is a state, and an outline that only changed
             colour reads as a hover at a glance. -->
        <Star class="size-16 {saved ? 'fill-current text-accent-default' : ''}" aria-hidden="true" />
      </Button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content side="bottom">{saved ? "In your favorites" : "Add to favorites"}</Tooltip.Content>
</Tooltip.Root>

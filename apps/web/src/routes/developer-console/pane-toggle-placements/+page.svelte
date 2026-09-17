<script lang="ts">
  /*
   * Pane toggle placements — where the control that shows and hides a side pane could live, with
   * every candidate rendered from the shipping components over one fixture so they can be compared
   * rather than described.
   *
   * WHAT PROMPTED IT. Time, Fees, Costs and Billing each draw a row above their table whose only
   * occupant, most of the time, is one glyph: the details-pane toggle. The row costs a control's
   * height plus the stack gap, taken off the top of a table that is already fighting for it, and it
   * is spent on a control that is not an act on the records at all. The file manager is where the
   * glyph came from, and there it ends a toolbar the screen has to draw anyway — the ledgers copied
   * the button without copying the band it was standing in.
   *
   * Files is included because it carries TWO of these toggles and is the only screen in the product
   * that lets a reader close its own navigation, so whatever answer the ledgers take, Files has to
   * be able to take as well — or has to be a deliberate exception.
   *
   * WHAT WAS CHOSEN: the counts strip's inline end, on every surface, Files included — and both of
   * Files' toggles kept for now rather than the folder tree's being dropped. The ruling and its
   * reasoning live in docs/conventions/design-corrections.md and docs/conventions/file-manager-rulings.md;
   * this page stays as what the choice was made against, so a later round can see what was weighed
   * rather than re-deriving it. The specimens are candidates, not the product: the shipping
   * arrangement is the real ledgers and the real file manager.
   *
   * This is a decision surface, not a screen: nothing here ships as it stands. Dev builds only,
   * like the rest of the developer console — behind the import.meta.env.DEV gate.
   */
  import type { Snippet } from "svelte";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import PaneSpecimen from "./pane-specimen.svelte";
</script>

<svelte:head><title>Pane toggle placements · Magna Carta</title></svelte:head>

{#snippet specimen(
  heading: string,
  cost: string,
  note: string,
  body: Snippet,
)}
  <section class="flex flex-col gap-12">
    <div class="flex max-w-prose flex-col gap-4">
      <h3 class="text-lg font-semibold">{heading}</h3>
      <p class="text-xs font-semibold text-text-link">{cost}</p>
      <p class="text-sm text-text-muted">{note}</p>
    </div>
    {@render body()}
  </section>
{/snippet}

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <ScreenHeader title="Pane toggle placements" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <p class="text-sm text-text-muted">
        Every candidate home for the show-and-hide-the-pane control, rendered from the real design
        system over one fixture. Each specimen is the same fixed height, so what a placement takes
        from the table is the visible difference between two of them. Press the glyphs — the panes
        really open. The figures under each heading are measured from these specimens, not estimated:
        today's row costs 41 points above the table, and the counts strip grows from 32 to 41 to seat
        the control.
      </p>
      <p class="text-sm text-text-muted">
        The ledger specimens come first, then the file manager, which carries two of these toggles
        and is the only screen in the product that lets a reader close its own folder tree.
      </p>
      <p class="text-sm text-text-default">
        <strong>Chosen: the counts strip's inline end</strong>, on every surface — and both of the
        file manager's toggles kept for now. This page stays as the record of what that was weighed
        against; the shipping arrangement is the real ledgers and the real file manager.
      </p>
    </header>

    <div class="flex flex-col gap-32">
      <h2 class="text-xl font-semibold">A ledger — one pane, no toolbar of its own</h2>

      {#snippet ledgerRow()}
        <PaneSpecimen placement="row" />
      {/snippet}
      {@render specimen(
        "Today — a row of its own",
        "Costs the table a control's height plus the stack gap, always.",
        "The row exists for the glyph. Nothing else is in it unless a filter is on, and a reader scanning the screen meets an empty band before they meet the ledger. This is the specimen the others are measured against.",
        ledgerRow,
      )}

      {#snippet ledgerRowFiltered()}
        <PaneSpecimen placement="row" filtered />
      {/snippet}
      {@render specimen(
        "Today, under a filter",
        "The same height, now shared.",
        "The one state where the row earns itself — and even here Clear Filters says what the counts strip beneath the table already says with Show all. The strip states the filter and offers the way out; the row states nothing and offers the same way out again.",
        ledgerRowFiltered,
      )}

      {#snippet ledgerFooter()}
        <PaneSpecimen placement="footer" />
      {/snippet}
      {@render specimen(
        "The counts strip's inline end",
        "Grows the strip 32 to 41 points, and removes a 41-point row: a net 32 back to the table.",
        "The strip under the table already holds one line at a fixed height and already carries the surface's own trailing figures. The file manager already puts undo, redo and the zoom steps in exactly this slot, which makes this the product's existing answer for a quiet control that acts on the surface rather than on a record — the ledgers simply never followed it. The pane's own state stays legible: the glyph reads pressed.",
        ledgerFooter,
      )}

      {#snippet ledgerEdge()}
        <PaneSpecimen placement="edge" />
      {/snippet}
      {@render specimen(
        "The pane's own edge",
        "Costs no height at all: it floats over the frame.",
        "The control sits on the boundary it moves, which is the most literal thing it could say. Two prices: it floats over the pane's content when the pane is open, so the panel needs inline-end room kept clear for it, and it sits close enough to the resize divider that the standing ruling against a grip handle in the middle of the screen is worth re-testing against it.",
        ledgerEdge,
      )}

      {#snippet ledgerBand()}
        <PaneSpecimen placement="band" />
      {/snippet}
      {@render specimen(
        "The matter's header band",
        "Costs the ledger no height: the band is drawn over every section already.",
        "The band already carries the matter's search and the one create control, and the layout draws it over all fourteen sections — so the toggle would sit in one place on every screen that has a pane, rather than a different distance down the page on each. It needs a seam: the band would take the toggle the way it takes the create control, claimed by whichever section has a pane and absent on the ones that do not. The band is also further from the pane than any other candidate.",
        ledgerBand,
      )}

      {#snippet ledgerSelection()}
        <PaneSpecimen placement="selection" />
      {/snippet}
      {@render specimen(
        "No toggle: the selection opens it",
        "Costs no height, and removes a control.",
        "Select a row and the pane is what that looks like; let go and it goes. The counts strip's Select none already closes it, so nothing new is drawn anywhere. This is the only candidate that changes a settled decision rather than moving a button: the details panel's own rule today is that selection is not presentation — clicking a row selects it and does nothing else, and the pane opens from its own control alone.",
        ledgerSelection,
      )}
    </div>

    <div class="flex flex-col gap-32">
      <h2 class="text-xl font-semibold">Files — two panes, and a toolbar it draws anyway</h2>

      {#snippet filesRow()}
        <PaneSpecimen surface="files" placement="row" />
      {/snippet}
      {@render specimen(
        "Today — both glyphs end the toolbar",
        "Costs no height: the toolbar is drawn either way.",
        "Back, forward, up, the breadcrumb and the search all have to be here, so the two toggles end a row the screen was always going to draw. This is why Files never had the ledgers' problem, and why it is the one surface where leaving the toggles where they are is defensible.",
        filesRow,
      )}

      {#snippet filesFooter()}
        <PaneSpecimen surface="files" placement="footer" />
      {/snippet}
      {@render specimen(
        "Both glyphs in the counts strip",
        "Nine points on the strip, and one answer for all five surfaces.",
        "If the ledgers move to the strip, Files can follow and the platform has one place a reader looks for either pane on any screen. Files already has controls in this slot, so the two would join undo, redo and the zoom steps rather than arriving alone.",
        filesFooter,
      )}

      {#snippet filesEdge()}
        <PaneSpecimen surface="files" placement="edge" />
      {/snippet}
      {@render specimen(
        "Each glyph on its own pane's edge",
        "Costs no height: they float over the frame.",
        "The clearest reading of the two: the left glyph on the left edge, the right glyph on the right, each on the boundary it moves. It is also the arrangement that most needs the panes to keep room clear at their outer edges, on the surface that has the most content pressed against them.",
        filesEdge,
      )}

      {#snippet filesNoRailToggle()}
        <PaneSpecimen surface="files" placement="footer" railToggle={false} />
      {/snippet}
      {@render specimen(
        "The folder tree cannot be closed",
        "Removes a control outright.",
        "Files is the only screen in the product that lets a reader hide its own navigation, and the tree is what makes it a file manager rather than a list. The divider still drags the rail down to a sliver, so the width is still the reader's — what goes is the second glyph, the second preference, and the state where the file manager is a table with no tree beside it. The details pane keeps its toggle, wherever the ledgers put theirs.",
        filesNoRailToggle,
      )}
    </div>
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    This review surface is only available in development builds.
  </p>
{/if}

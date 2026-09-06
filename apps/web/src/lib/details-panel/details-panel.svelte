<script lang="ts">
  /*
   * DetailsPanel.Root — the smaller altitude, beside the list.
   *
   * THREE FACES, ONE PANEL, and the shape is the same on every ledger that has one: nothing
   * selected, it speaks for the matter; one record selected, it shows that record; several
   * selected, it speaks for the selection and counts what a verb would act on. The four financial
   * ledgers each wrote that shape out in full, down to identical class strings, which meant a
   * correction to the panel was four edits and was twice applied to three of them.
   *
   * SELECTION IS NOT PRESENTATION. Clicking a row selects it and does nothing else; the panel opens
   * from its own control alone, and while it is open it follows whatever is selected. That is why
   * nothing here is an opener — the surface owns whether the panel is showing, and persists it.
   *
   * THE PANEL REACHES A RECORD; IT DOES NOT EDIT ONE. Editing lives in the record window's header,
   * so a reader who has learned it once finds it on every kind of record. What belongs here are the
   * verbs that act on a record without opening it.
   *
   * WHAT THIS SHELL DOES NOT DECIDE: which faces a surface has, what its verbs are, or what it
   * calls its own figures. It carries the frame, the header grammar, the scrolling body and the
   * ruled sections; a surface hands it words and controls. A panel needing a fourth face composes
   * it out of the same parts rather than adding a mode here.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";

  let {
    label,
    children,
    ...restProps
  }: HTMLAttributes<HTMLElement> & {
    /** The panel's accessible name — what it is showing, e.g. "Cost details". */
    label: string;
    children: Snippet;
  } = $props();
</script>

<aside
  class="flex h-full w-full flex-col border-l border-border-default bg-surface-default"
  aria-label={label}
  {...restProps}
>
  {@render children()}
</aside>

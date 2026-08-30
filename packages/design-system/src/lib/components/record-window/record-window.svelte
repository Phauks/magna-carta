<script lang="ts">
  /*
   * RecordWindow — the two-pane window a record opens in, and the only one there is.
   *
   * The left pane is the record itself: the important, changeable information, dense and
   * top-aligned. The right pane is context in tabs. Beneath both sits one action bar whose geometry
   * never changes, so an act a state refuses shows disabled with its reason rather than vanishing
   * and moving everything else.
   *
   * THE SHELL IS DOMAIN-BLIND, ON PURPOSE AND MECHANICALLY. A kind of record contributes its left
   * pane, its tab set and its action bar as snippets, and nothing else — no field, no verb, no word
   * of any one kind of record settles here. That is what keeps one window able to serve every kind:
   * the moment the shell learns about one of them, the next kind needs its own window and the
   * reader has two things to learn instead of one. tooling/lint-one-ui asserts it at the source.
   *
   * THE HEADER CARRIES EXACTLY FOUR CONTROLS, IN ONE ORDER: Edit, Print, expand, close. A reader
   * learns the window once. Edit lives here rather than in the surface that opened the record,
   * because opening a record and editing one are different acts and only one of them belongs to a
   * list. Print layers its sheet ABOVE this window rather than replacing it, so closing the sheet
   * hands back the record that was being read — that is the caller's job in `onPrint`, and the
   * reason this control does not close anything itself. The same source scan asserts the set and
   * its order.
   *
   * The window is capped at the viewport and only its body scrolls, so a long record can never push
   * its own close control off-screen. Expanding it to the full viewport is remembered for the
   * session (record-window-session.svelte.ts).
   */
  import type { Snippet } from "svelte";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Printer from "@lucide/svelte/icons/printer";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import * as Dialog from "../dialog/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import RecordWindowContext from "./record-window-context.svelte";
  import { recordWindowSession } from "./record-window-session.svelte.ts";
  import type { RecordWindowTab } from "./types.ts";

  let {
    open = $bindable(false),
    expanded = $bindable(),
    heading,
    subtitle,
    record,
    tabs,
    defaultTab,
    actions,
    onEdit,
    onPrint,
    editDisabledReason,
    class: className,
  }: {
    /** Whether the window is showing. Bindable, so a surface can open and close it. */
    open?: boolean;
    /**
     * Whether the window fills the viewport. Bindable; left undefined it follows the choice the
     * reader last made this session, which is what makes the toggle feel like it stayed pressed.
     */
    expanded?: boolean;
    /** The record's name, as the reader knows it. */
    heading: string;
    /**
     * The line beneath the heading. The record's own reference number belongs here and only here —
     * repeating it in the record pane makes a reader check whether the two agree.
     */
    subtitle: Snippet;
    /** The LEFT pane: the record itself, dense and top-aligned. */
    record: Snippet;
    /** The RIGHT pane: context, one tab each. */
    tabs: readonly RecordWindowTab[];
    /** Which tab the window opens on. Defaults to the first. */
    defaultTab?: string;
    /** The bottom action bar's contents. Its geometry is the shell's, its verbs are the caller's. */
    actions: Snippet;
    /** Take the record into editing. */
    onEdit: () => void;
    /** Present the record's printable sheet, layered above this window. */
    onPrint: () => void;
    /**
     * Why this account may not edit this record. Given, Edit renders disabled and says this instead
     * of disappearing: a control that vanishes leaves the reader wondering whether they missed it.
     */
    editDisabledReason?: string;
    class?: string;
  } = $props();

  const isExpanded = $derived(expanded ?? recordWindowSession.expanded);
  const editable = $derived(editDisabledReason === undefined);

  function toggleExpanded(): void {
    const next = !isExpanded;
    recordWindowSession.expanded = next;
    expanded = next;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    showClose={false}
    data-expanded={isExpanded ? "true" : "false"}
    class={mergeClasses(
      "mc-record-window",
      isExpanded ? "h-screen w-screen max-w-none" : "max-h-screen w-full max-w-5xl",
      className,
    )}
  >
    <!-- Plain divs, not <header>/<footer>: those map to the banner and contentinfo landmarks, which
         may not sit inside a dialog. The classes carry the structure; the roles would be wrong. -->
    <div class="mc-record-window-header">
      <div class="mc-record-window-identity">
        <Dialog.Title class="mc-record-window-heading">{heading}</Dialog.Title>
        <Dialog.Description class="mc-record-window-subtitle">
          {@render subtitle()}
        </Dialog.Description>
      </div>
      <div class="mc-record-window-header-actions">
        <button
          type="button"
          data-record-window-action="edit"
          class="mc-record-window-header-action"
          disabled={!editable}
          title={editDisabledReason ?? "Edit"}
          aria-label={editable ? "Edit" : `Edit: ${editDisabledReason}`}
          onclick={onEdit}
        >
          <Pencil class="mc-record-window-header-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-record-window-action="print"
          class="mc-record-window-header-action"
          title="Print"
          aria-label="Print"
          onclick={onPrint}
        >
          <Printer class="mc-record-window-header-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-record-window-action="expand"
          class="mc-record-window-header-action"
          aria-pressed={isExpanded}
          title={isExpanded ? "Shrink back to a window" : "Fill the screen"}
          aria-label={isExpanded ? "Shrink back to a window" : "Fill the screen"}
          onclick={toggleExpanded}
        >
          {#if isExpanded}
            <Minimize2 class="mc-record-window-header-icon" aria-hidden="true" />
          {:else}
            <Maximize2 class="mc-record-window-header-icon" aria-hidden="true" />
          {/if}
        </button>
        <Dialog.Close
          data-record-window-action="close"
          class="mc-record-window-header-action"
          title="Close"
          aria-label="Close"
        >
          <X class="mc-record-window-header-icon" aria-hidden="true" />
        </Dialog.Close>
      </div>
    </div>

    <div class="mc-record-window-body">
      <div class="mc-record-window-record">
        {@render record()}
      </div>
      <div class="mc-record-window-context">
        <RecordWindowContext {tabs} {defaultTab} />
      </div>
    </div>

    <div class="mc-record-window-actions">
      {@render actions()}
    </div>
  </Dialog.Content>
</Dialog.Root>

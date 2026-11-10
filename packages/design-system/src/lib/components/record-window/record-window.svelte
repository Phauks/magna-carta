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
   * THE HEADER CARRIES ONE ORDERED SET OF CONTROLS: the record kind's menu (when it has one),
   * Edit, Print, expand, close. A reader learns the window once. Edit lives here rather than in
   * the surface that opened the record, because opening a record and editing one are different
   * acts and only one of them belongs to a list. Print layers its sheet ABOVE this window rather
   * than replacing it, so closing the sheet hands back the record that was being read — that is
   * the caller's job in `onPrint`, and the reason this control does not close anything itself. The
   * menu is the one caller-supplied control, because a record kind's rare acts and its settings
   * need a home that is not a fifth field or a wider action bar; its CONTENT is the caller's, its
   * place and its glyph are the shell's. The same source scan asserts the set and its order, which
   * is also why the verbs that commit a change live in the action bar and never up here.
   *
   * EDITING HAPPENS IN THIS WINDOW, IN PLACE. Edit does not call out to the caller to open
   * something; it raises the window's own `editing` flag, the left pane re-renders as fields in the
   * same geometry, and the same tabs and the same action bar stay where they were. A second surface
   * for changing a record somebody is already looking at is the exact thing one window exists to
   * prevent, so the contract is shaped to make it unavailable rather than discouraged: there is no
   * callback to hang another window off, and the pane that shows the values is the same snippet
   * that shows the fields, so the two can never drift into different layouts.
   *
   *   - The SHELL owns the commit and the abandon. It renders them, names them, places them and
   *     orders them; a record kind supplies only the handlers. "Save" meaning one thing on one kind
   *     of record and something else on another is a defect rather than a liberty, and a reader who
   *     has learned where the commit sits has learned it everywhere.
   *   - THE TABS STAY REACHABLE while editing. Somebody changing a record routinely needs to look
   *     at what rides beside it — what is attached, what has happened to it — and a window that
   *     locks its own context until the change is finished is a trap the reader can only escape by
   *     abandoning work. The tabs are context, so they stay read-only either way and are not told
   *     which mode the window is in.
   *   - A CLOSE GESTURE NEVER DISCARDS SILENTLY. Every way out of the window — this header's close,
   *     Escape, a press outside the panel — runs through one guard, and while there is unsaved work
   *     it asks. A record kind that can see it has nothing to lose says so with `unsavedChanges`
   *     and the question is skipped.
   *
   * FIT FIRST, CAP SECOND. A record that fits sizes to its content and does not scroll at all; only
   * a record that genuinely exceeds the viewport caps, and then the BODY alone moves while the
   * header and the action bar stay put. The reasoning lives with the recipe (record-window.css),
   * which is where the two rules are expressed.
   *
   * Expanding it to the full viewport is the frame's capability, shared with the action dialog and
   * remembered for the session (../../internal/frame-expansion.svelte.ts); the control is this
   * window's own, because the header set is asserted at the source.
   */
  import type { Snippet } from "svelte";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Printer from "@lucide/svelte/icons/printer";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import * as Dialog from "../dialog/index.ts";
  import * as DropdownMenu from "../dropdown-menu/index.ts";
  import Button from "../button/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { CloseGuard } from "../../internal/close-guard.svelte.ts";
  import DiscardQuestion from "../../internal/discard-question.svelte";
  import RecordSubjectLine from "../record-reference/record-subject.svelte";
  import type { RecordSubject } from "../record-reference/types.ts";
  import RecordWindowContext from "./record-window-context.svelte";
  import { FrameExpansion, recordWindowExpansion } from "../../internal/frame-expansion.svelte.ts";
  import type { RecordWindowTab } from "./types.ts";

  let {
    open = $bindable(false),
    expanded = $bindable(),
    editing = $bindable(false),
    heading,
    subtitle,
    record,
    tabs,
    defaultTab,
    actions,
    menu,
    editControl = true,
    onSave,
    onCancel,
    onPrint,
    editDisabledReason,
    saveDisabledReason,
    saveLabel = "Save",
    unsavedChanges = true,
    class: className,
    style,
  }: {
    /** Whether the window is showing. Bindable, so a surface can open and close it. */
    open?: boolean;
    /**
     * Whether the window fills the viewport. Bindable; left undefined it follows the choice the
     * reader last made this session, which is what makes the toggle feel like it stayed pressed.
     */
    expanded?: boolean;
    /**
     * Whether the record's fields are open for change. The window owns this: the header's Edit
     * control raises it and the action bar's abandon lowers it. Bindable, because a record kind
     * that opens straight into the fields (a new record has nothing to read) raises it itself, and
     * because only the caller knows whether a commit succeeded and may therefore lower it.
     */
    editing?: boolean;
    /** The record's name, as the reader knows it. */
    heading: string;
    /**
     * The line beneath the heading. The record's own reference number belongs here and only here —
     * repeating it in the record pane makes a reader check whether the two agree.
     *
     * A `RecordSubject` — the reference, and the few facts about the record worth stating beside it
     * — which the design system renders, so a record window and the panel that CREATED that record
     * name it the same way. The snippet arm stays for a subject that carries real markup.
     */
    subtitle: RecordSubject | Snippet;
    /**
     * The LEFT pane: the record itself, dense and top-aligned. It is handed the mode, so ONE
     * snippet renders the values and the fields. Two snippets would be two layouts, and they would
     * disagree about where a field sits within a week.
     */
    record: Snippet<[{ editing: boolean }]>;
    /** The RIGHT pane: context, one tab each. Reachable in both modes, read-only in both. */
    tabs: readonly RecordWindowTab[];
    /** Which tab the window opens on. Defaults to the first. */
    defaultTab?: string;
    /**
     * The bottom action bar's contents. Its geometry is the shell's, its verbs are the caller's —
     * except the two the shell reserves: while editing, the shell appends the abandon and the
     * commit after whatever this renders, so they are always the last two controls in the bar and
     * always in that order. It is handed the mode for the same reason the record pane is: the verbs
     * of reading a record are not the verbs of changing one.
     */
    actions: Snippet<[{ editing: boolean }]>;
    /**
     * The record kind's own menu: its rare acts and its settings, as DropdownMenu items. Given, the
     * header leads its control set with the one caller-supplied control; withheld, nothing renders
     * and the set is the shell's four.
     */
    menu?: Snippet;
    /**
     * Whether the header offers Edit. Withheld for a record kind whose fields are edited in place,
     * each saving as it changes: there is no separate mode to enter, so a control for entering one
     * would be a door to nowhere. A new record of such a kind still opens straight into its fields
     * and still commits with Save, because there is nothing yet to save a field onto.
     */
    editControl?: boolean;
    /**
     * Commit the change. Given, the window can be edited; withheld, Edit refuses, because a mode
     * with no way to commit is worse than no mode at all. The window does NOT leave editing on its
     * own afterwards: a commit can fail, and only the caller knows whether this one landed, so it
     * lowers `editing` when it did.
     */
    onSave?: () => void;
    /**
     * Abandon the change. The window has already left editing by the time this runs; a record kind
     * uses it to put its own fields back where they were.
     */
    onCancel?: () => void;
    /** Present the record's printable sheet, layered above this window. */
    onPrint: () => void;
    /**
     * Why this account may not take this record into editing. Given, Edit renders disabled and says
     * this instead of disappearing: a control that vanishes leaves the reader wondering whether
     * they missed it. It refuses ENTRY only — a record kind that opens straight into the fields is
     * editing regardless, and its own Edit control is the one thing it cannot press.
     */
    editDisabledReason?: string;
    /**
     * Why the change cannot be committed as it stands — a required field still empty, a commit
     * already in flight. Given, Save renders disabled and carries this, on the same rule as Edit.
     */
    saveDisabledReason?: string;
    /**
     * What the commit says. It closes nothing itself — the caller decides what follows a landed
     * save — but a record kind whose save always closes says so on the control ("Save & Close"),
     * because a button that names its whole act needs no second reading.
     */
    saveLabel?: string;
    /**
     * Whether leaving editing would lose something. Defaults to true, because the shell cannot see
     * the fields and must not guess that nothing was typed; a record kind that tracks its own
     * changes passes false and the reader is not asked a question with one answer.
     */
    unsavedChanges?: boolean;
    class?: string;
    /**
     * Inline sizing for the WINDOWED state, token-derived (e.g. a fixed block-size so a record
     * whose tabs differ in length does not resize under the reader). Ignored while expanded:
     * filling the screen is the gesture, and a cap would fight it.
     */
    style?: string;
  } = $props();

  const expansion = new FrameExpansion(recordWindowExpansion, {
    read: () => expanded,
    write: (next) => {
      expanded = next;
    },
  });
  const isExpanded = $derived(expansion.expanded);

  /*
   * Why Edit is refused, if it is. Two refusals answer here rather than one: the account may not
   * change this record, or the record kind handed the window no way to commit. The second is closed
   * off at the same door as the first, because a reader who can enter a mode they cannot leave by
   * finishing has been trapped by the window rather than told something by it.
   */
  const editRefusal = $derived(
    editDisabledReason ?? (onSave === undefined ? "This record cannot be changed here." : undefined),
  );
  const editVerb = $derived(editing ? "Stop editing" : "Edit");
  const editAccessibleName = $derived(
    editRefusal === undefined ? editVerb : `Edit: ${editRefusal}`,
  );
  const saveAccessibleName = $derived(
    saveDisabledReason === undefined ? "Save" : `Save: ${saveDisabledReason}`,
  );

  /*
   * The unsaved-work guard, shared with the modal shell (../../internal/close-guard.svelte.ts).
   * It was written here first and lived here alone until ActionDialog needed the same question; a
   * second copy would have been two questions with two wordings, drifting apart the first time one
   * of them was corrected. The predicate is read at the moment of the gesture rather than held,
   * because a record goes dirty and clean again while the window is open.
   *
   * Only an EDITING window has anything to lose — a record being read has nothing to discard — so
   * the editing check lives in the predicate rather than at each call site.
   */
  const guard = new CloseGuard(() => editing && unsavedChanges);

  /*
   * A window that closed while its fields were open must not reopen showing them: a record is read
   * before it is changed, whichever door the next one arrives through. Written as a transition
   * rather than as "closed means reading" so a caller that raises the flag and then opens the
   * window — the way a new record, which has nothing to read, is entered — is not undone.
   */
  let wasOpen = false;
  $effect(() => {
    if (wasOpen && !open) editing = false;
    wasOpen = open;
  });

  function leaveEditing(): void {
    editing = false;
    onCancel?.();
  }

  function closeWindow(): void {
    if (editing) leaveEditing();
    open = false;
  }

  /** Leave editing, asking first while there is something to lose. */
  function requestLeaveEditing(): void {
    if (guard.request("leaveEditing")) leaveEditing();
  }

  /*
   * The one guard every way out of the window runs through — this header's close, Escape, a press
   * outside the panel. Having one is the point: a second exit that skipped the question would make
   * the question decorative.
   */
  function requestCloseWindow(): void {
    if (guard.request("closeSurface")) closeWindow();
  }

  function discardAndContinue(): void {
    if (guard.release() === "closeSurface") {
      closeWindow();
      return;
    }
    leaveEditing();
  }

  function toggleEditing(): void {
    if (editing) {
      requestLeaveEditing();
      return;
    }
    editing = true;
  }

  function toggleExpanded(): void {
    expansion.toggle();
  }
</script>

<Dialog.Root
  bind:open={
    () => open,
    (next) => {
      if (next) {
        open = true;
        return;
      }
      requestCloseWindow();
    }
  }
>
  <Dialog.Content
    showClose={false}
    data-modal-shell="record-window"
    data-expanded={isExpanded ? "true" : "false"}
    data-editing={editing ? "true" : "false"}
    class={mergeClasses(
      "mc-modal-frame mc-record-window",
      // Width is a utility, never the recipe: the dialog panel underneath arrives wearing its own
      // default cap as a utility, and only another utility can replace it. Height needs no
      // utility: the stage the panel sits in caps it at the screen less its gutter. Expanded drops
      // the cap entirely, because filling the screen IS the gesture.
      expansion.panelClasses("w-full max-w-record-window"),
      className,
    )}
    style={isExpanded ? undefined : style}
  >
    <!-- Plain divs, not <header>/<footer>: those map to the banner and contentinfo landmarks, which
         may not sit inside a dialog. The classes carry the structure; the roles would be wrong. -->
    <div class="mc-modal-frame-header mc-record-window-header">
      <div class="mc-modal-frame-identity mc-record-window-identity">
        <Dialog.Title class="mc-modal-frame-heading mc-record-window-heading">{heading}</Dialog.Title>
        <Dialog.Description class="mc-modal-frame-subtitle mc-record-window-subtitle">
          {#if typeof subtitle === "function"}
            {@render subtitle()}
          {:else}
            <RecordSubjectLine subject={subtitle} />
          {/if}
        </Dialog.Description>
      </div>
      <div class="mc-modal-frame-header-actions mc-record-window-header-actions">
        {#if menu}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              data-record-window-action="menu"
              class="mc-modal-frame-header-action mc-record-window-header-action"
              title="More"
              aria-label="More"
            >
              <EllipsisVertical class="mc-modal-frame-header-icon mc-record-window-header-icon" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              {@render menu()}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
        {#if editControl}
        <button
          type="button"
          data-record-window-action="edit"
          class="mc-modal-frame-header-action mc-record-window-header-action"
          disabled={editRefusal !== undefined}
          aria-pressed={editing}
          title={editRefusal ?? editVerb}
          aria-label={editAccessibleName}
          onclick={toggleEditing}
        >
          <Pencil class="mc-modal-frame-header-icon mc-record-window-header-icon" aria-hidden="true" />
        </button>
        {/if}
        <button
          type="button"
          data-record-window-action="print"
          class="mc-modal-frame-header-action mc-record-window-header-action"
          title="Print"
          aria-label="Print"
          onclick={onPrint}
        >
          <Printer class="mc-modal-frame-header-icon mc-record-window-header-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-record-window-action="expand"
          class="mc-modal-frame-header-action mc-record-window-header-action"
          aria-pressed={isExpanded}
          title={expansion.label}
          aria-label={expansion.label}
          onclick={toggleExpanded}
        >
          {#if isExpanded}
            <Minimize2 class="mc-modal-frame-header-icon mc-record-window-header-icon" aria-hidden="true" />
          {:else}
            <Maximize2 class="mc-modal-frame-header-icon mc-record-window-header-icon" aria-hidden="true" />
          {/if}
        </button>
        <!-- A plain control rather than the dialog's own Close part, so that closing runs the
             unsaved-work guard the other exits run. The header set is unchanged: four controls,
             four markers, one order. -->
        <button
          type="button"
          data-record-window-action="close"
          class="mc-modal-frame-header-action mc-record-window-header-action"
          title="Close"
          aria-label="Close"
          onclick={requestCloseWindow}
        >
          <X class="mc-modal-frame-header-icon mc-record-window-header-icon" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="mc-modal-frame-body mc-record-window-body">
      <div class="mc-modal-frame-pane mc-record-window-record mc-scrollbar">
        {@render record({ editing })}
      </div>
      <div class="mc-modal-frame-context mc-record-window-context">
        <RecordWindowContext {tabs} {defaultTab} />
      </div>
    </div>

    <div class="mc-modal-frame-actions mc-record-window-actions">
      {@render actions({ editing })}
      {#if editing}
        <!-- The reserved commit, always last: whatever a record kind adds sits before it, so the
             commit is the final control in every window in the product. There is no Cancel beside
             it — the header's close and Escape already run the unsaved-work guard, and a second
             way out at the reader's strong hand was pressed by accident more than on purpose. -->
        <Button
          disabled={saveDisabledReason !== undefined}
          title={saveDisabledReason ?? "Save this record"}
          aria-label={saveAccessibleName}
          onclick={() => onSave?.()}
        >
          {saveLabel}
        </Button>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

<!--
  The question a close gesture asks while there is unsaved work. The question itself, its verbs and
  its shape are the shared component's; only the sentence naming what would be lost is this
  window's, because what is at stake in a record being changed is not what is at stake in a form
  being filled.
-->
<DiscardQuestion
  {guard}
  description="This record has changes that have not been saved. Leaving now throws them away; the record itself stays exactly as it was."
  onDiscard={discardAndContinue}
/>

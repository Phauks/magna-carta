<script lang="ts">
  /*
   * ActionDialog — the panel an act is asked for in, and the only one there is.
   *
   * A record is READ and CHANGED in a RecordWindow; an act is ASKED FOR here. Between them they are
   * every modal surface the product has, so a reader learns two panels rather than one per screen.
   * Both sit on the same frame (styles/recipes/modal-frame.css): the same header band, the same
   * pane geometry, the same action bar, the same fit-first/cap-second sizing. A reader who has
   * learned where a record's commit sits has learned where every panel's commit sits.
   *
   * THE SHELL IS DOMAIN-BLIND, ON PURPOSE AND MECHANICALLY. A caller contributes a heading, a
   * subtitle, a notice, a body, an optional context and one commit verb, and nothing else — no
   * field, no state machine, no word of any one kind of act settles here. tooling/lint-one-ui
   * asserts it at the source, the same way it asserts it for the record window.
   *
   * WHAT THE SHELL OWNS IS NOT A SET OF DEFAULTS — IT IS THE ABSENCE OF PROPS. The footer's
   * geometry and the order of its two controls, the dismissal's word, the busy state, whether the
   * corner dismiss shows, which primitive renders the panel, and the one close path every exit runs
   * through: none of them can be overridden, which is what makes them true everywhere. What a
   * caller may differ on is a closed set — the snippets, `kind`, `width`, and the commit's outcome.
   * There is deliberately no `class` prop.
   *
   * THE KIND CHOOSES THE PRIMITIVE, which is the most valuable line in the contract. A `form` is a
   * Dialog, and keeps the corner dismiss (owner ruling, 2026-09-02); a `confirm` or `destructive`
   * is an AlertDialog, with the `alertdialog` role, no corner dismiss, and no dismissal on a press
   * outside — a question that can be dismissed by a stray press is not a question. The panels this
   * shell replaces each decided that for themselves and disagreed: four reached AlertDialog and
   * thirty did not, with no rule behind the split.
   *
   * A READING PANEL ASKS FOR NOTHING, AND ITS PROPS SAY SO BY TYPE. `kind="reading"` shows a thing
   * and may offer a step in place, beside the fact the step changes; its action bar carries only
   * the way out, and `commitLabel` and `onCommit` are refused by the type rather than merely
   * unused. The three acting kinds require both. So the shell's contract is not weakened by the
   * fourth kind — it is a discriminated union, and each arm is as strict as it was — which is what
   * makes a reading panel a variant of this shell rather than a third shell or a hand-composed one.
   *
   * THE CONTEXT PANE IS THE RECORD WINDOW'S, LENT. A form that needs something beside its fields —
   * the client a matter is being opened for, the standing that decides whether it may be — hands
   * it over as `context` and gets the record window's own right pane: the sunken surface, the
   * hairline, the width that takes whatever the fields do not need. Before the frame existed, the
   * one panel that needed this rebuilt all of it by hand in 647 lines.
   *
   * A CLOSE GESTURE NEVER DISCARDS SILENTLY. Every way out — the corner dismiss, Escape, a press
   * outside, the footer's own dismissal — runs through one guard, and while there is unsaved work
   * it asks. A caller that can see it has nothing to lose says so with `unsavedChanges` and the
   * question is skipped. The guard and its question are shared with the record window
   * (../../internal/close-guard.svelte.ts), so the product asks this in one voice.
   *
   * THE COMMIT OWNS THE CLOSE. `onCommit` reports "committed", "refused" or "done"; the shell
   * raises the busy state around it, closes on the first, stands its ground on the second, and on
   * the third stays open as a panel with nothing left to ask: the act happened and the reader is
   * shown what came of it, the bar ends at Close, the guard stands down. A caller never writes
   * `open` on the way out — that is what keeps the close to one path, and a close path with one
   * entrance is the only kind a guard can actually cover.
   *
   * FOCUS LANDS ON THE FIRST FIELD, not the first control. The header's close is first in the DOM
   * because the header is first in the frame, and a form that opened with its own dismiss focused
   * would be inviting the reader to leave. So the panel hands focus to the first focusable thing
   * in its primary pane, and only where there is none — a question with no fields — does the
   * primitive's own default (the dismissal) stand.
   *
   * ENTER COMMITS, BECAUSE THE PANE IS A FORM. The primary pane is a real <form> and the commit is
   * its submit button (associated by id, since the bar sits outside the pane), so the platform's
   * own implicit submission does the work: Enter in a field commits, a disabled commit stops it,
   * and a caller wires nothing. Ctrl+Enter or Cmd+Enter commits from a textarea, where Enter
   * itself must go on meaning a new line. Measured before it was built: none of the fifteen panels
   * on this shell had wired Enter, because each would have had to.
   *
   * A COMMIT THAT IS NOT SERVED YET STILL RENDERS. `commitSoon` names what the act waits on and the
   * shell wraps its own commit in the Soon affordance — disabled, badged, the dependency as its
   * accessible description — so a not-yet-built act reads in a panel exactly as it reads in a menu.
   * The panels that needed this before it existed each composed the affordance around a commit of
   * their own, which is what an allowance was recording.
   */
  import type { Snippet } from "svelte";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import * as Dialog from "../dialog/index.ts";
  import * as AlertDialog from "../alert-dialog/index.ts";
  import * as DropdownMenu from "../dropdown-menu/index.ts";
  import Button from "../button/index.ts";
  import SoonAffordance from "../maturity/soon-affordance.svelte";
  import type { SoonControlProperties } from "../maturity/soon-affordance.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { CloseGuard } from "../../internal/close-guard.svelte.ts";
  import { FrameExpansion, actionDialogExpansion } from "../../internal/frame-expansion.svelte.ts";
  import DiscardQuestion from "../../internal/discard-question.svelte";
  import RecordSubjectLine from "../record-reference/record-subject.svelte";
  import { subjectIsEmpty } from "../record-reference/record-reference-model.ts";
  import type { RecordSubject } from "../record-reference/types.ts";
  import {
    DISMISS_LABEL,
    LEAVE_LABEL,
    traitsOf,
    widthClass,
  } from "./action-dialog-model.ts";
  import type { ActingKind, ActionDialogWidth, ActionOutcome } from "./types.ts";

  /*
   * The props are a union on `kind`. An acting kind carries a commit and everything about it; a
   * reading kind carries none and cannot be handed one. Written as a type alias rather than inline
   * so the arms can be read side by side, which is the whole point of the union.
   */
  type Shared = {
    /** Whether the panel is showing. Bindable, so a surface can open and close it. */
    open?: boolean;
    /** The act, in the reader's words — "Write Off a Balance", never a name for the panel. */
    heading: string;
    /**
     * What is being acted on, named once. A record's own reference belongs here and only here;
     * repeating it in the body makes a reader check whether the two agree.
     *
     * A `RecordSubject` — the reference, and the few facts about the subject worth stating beside
     * it — which the design system renders. It is NOT a string, and that is the mechanism rather
     * than a preference: the slot took one until 2026-09-14, and eighteen of fifty-four call sites
     * used it for a paragraph about what a subsystem is for, which the owner had already struck
     * from the panel it was first noticed on. A sentence about the act has nowhere to go here,
     * because the heading is where the act is named. The snippet arm stays for a subject that
     * carries real markup.
     */
    subtitle?: RecordSubject | Snippet;
    /**
     * The failure band's PLACE, which is the shell's; its CONTENT, which is the caller's. The
     * design system cannot know what a failure reads like — that lives in the app, over the app's
     * own problem model — so the shell reserves a band between the body and the action bar, outside
     * the scroll and under the reader's eye when a commit comes back refused, and renders whatever
     * arrives in it. Same division as the record window's menu: the place here, the content there.
     * It is what lets the next change to how a failure reads touch one component instead of every
     * panel.
     */
    notice?: Snippet;
    /**
     * The panel's own menu: what can be done with the thing being shown rather than to it — copy
     * its link, download a copy — as DropdownMenu items. The same place and the same control as
     * the record window's kind's menu, so a record reads alike in either shell. Given, the header
     * leads its control set with it; withheld, nothing renders. Only a panel that offers the corner
     * controls draws it: a question is answered or declined, never browsed.
     */
    menu?: Snippet;
    /**
     * What stands before the heading: the picture of the person or the logo of the organization a
     * record is about, so the panel is recognised before it is read. A face, never a control strip;
     * the header's controls stay at its far end.
     */
    leading?: Snippet;
    /**
     * The body. Handed `busy` so ONE snippet renders the fields at rest and while the commit is in
     * flight — two snippets would be two layouts, and they would disagree within a week — and
     * `done` so the same snippet can show what the act came to, once it has.
     */
    fields?: Snippet<[{ busy: boolean; done: boolean }]>;
    /**
     * What stands beside the fields, in the record window's own right pane: the thing being acted
     * on, or the facts that decide whether the act may happen. Given, the panel opens at the record
     * width whatever `width` says, because two panes have a geometry of their own. Handed `busy`
     * and `done` for the same reason the fields are.
     */
    context?: Snippet<[{ busy: boolean; done: boolean }]>;
    /** Fired once each time the panel opens — where a caller clears its fields. Once per OPENING. */
    onOpen?: () => void;
    /** Fired after a dismissal that was not a commit, once the guard has allowed it. */
    onDismiss?: () => void;
    /**
     * Whether there is anything to lose. `true` (the default for an acting kind) makes every exit
     * ask first. A caller that can see its fields are untouched passes false and the question is
     * skipped. The default is the careful one because a caller that never thought about it should
     * get the question rather than the silence. A reading panel has nothing to lose and never asks.
     */
    unsavedChanges?: boolean;
    /**
     * How wide the panel opens. A closed set, not a class — and overruled by `context`, which
     * implies the record width.
     */
    width?: ActionDialogWidth;
    /**
     * Whether the frame fills the screen. Bindable; a caller that hands it `true` opens the panel
     * expanded by design. Left unbound, the session's own memory answers — a reader who filled the
     * screen with one form gets the next form the same way. Only a form or a reading panel offers
     * the control; a question ignores this entirely.
     */
    expanded?: boolean;
    /**
     * Whether focus returns to the trigger when the panel closes. True, and the right default: a
     * keyboard reader lands back where they were. False for the one shape that misbehaves — a
     * trigger revealed on focus (a per-row "request a change"), which a restored focus keeps
     * latched open after the panel has gone. The trade is that a keyboard reader re-enters the
     * row with Tab.
     */
    restoreFocus?: boolean;
  };

  type Acting = Shared & {
    /** What is being asked. Decides the primitive, the dismissal verb and the commit's colour. */
    kind?: ActingKind;
    /** The commit's own verb — "Write Off a Balance", never "OK", "Submit" or "Confirm". */
    commitLabel: string;
    /**
     * The same verb while the request is in flight — "Writing Off" to `commitLabel`'s "Write Off".
     * Two words for ONE verb rather than a second verb, which is why it sits beside its own label
     * and not in a slot of the caller's. Omitted, the label does not change.
     */
    commitBusyLabel?: string;
    /**
     * Why the commit is unavailable, if it is. The control is DISABLED and the reason is rendered
     * beside it rather than the control being hidden: an act that vanishes teaches a reader
     * nothing, and a refusal is stated where it is caused. Undefined means the commit is available.
     */
    commitRefusal?: string;
    /**
     * Do it. The shell raises the busy state, awaits, and lowers it. "committed" closes the panel;
     * "refused" leaves it standing with whatever the caller has put in the notice slot; "done"
     * leaves it standing with nothing left to ask, so the reader can see what came of it.
     */
    onCommit: () => Promise<ActionOutcome>;
    /**
     * The act is designed but not served yet: `reason` is what it waits on, as a noun phrase ("a
     * trust account being served"). The commit renders disabled inside the Soon affordance, with
     * the badge beside it and the dependency as its accessible description, and cannot be pressed
     * or submitted. The panel is still worth opening: its fields show the shape of what is coming.
     */
    commitSoon?: { reason: string };
  };

  type Reading = Shared & {
    /** A panel that shows a thing and asks for nothing. Any step it offers is seated in its body. */
    kind: "reading";
    commitLabel?: never;
    commitBusyLabel?: never;
    commitRefusal?: never;
    commitSoon?: never;
    onCommit?: never;
  };

  let {
    open = $bindable(false),
    kind = "form",
    heading,
    subtitle,
    notice,
    menu,
    leading,
    fields,
    context,
    commitLabel,
    commitBusyLabel,
    commitRefusal,
    commitSoon,
    onCommit,
    onOpen,
    onDismiss,
    unsavedChanges,
    width = "default",
    expanded = $bindable(),
    restoreFocus = true,
  }: Acting | Reading = $props();

  const traits = $derived(traitsOf(kind));
  const reading = $derived(kind === "reading");
  /*
   * Whether the header band draws its second line at all. A subject built from a record that has
   * not loaded carries neither a reference nor a fact, and an empty description element under the
   * heading is a gap a reader reads as a missing answer.
   */
  const hasSubtitle = $derived(
    typeof subtitle === "function" ? true : subtitle !== undefined && !subjectIsEmpty(subtitle),
  );

  /* The frame's expansion, shared with the record window; this shell's memory is its own. */
  const expansion = new FrameExpansion(actionDialogExpansion, {
    read: () => expanded,
    write: (next) => {
      expanded = next;
    },
  });
  const isExpanded = $derived(traits.expandable && expansion.expanded);

  /** Raised across the commit, and read by the panes as well as by both footer controls. */
  let busy = $state(false);

  /** The act happened and the panel stayed to show it. Nothing is left to ask or to lose. */
  let done = $state(false);

  /* Nothing to lose is the reading panel's default; the careful default is the acting kinds'. */
  const guarded = $derived(!done && (unsavedChanges ?? !reading));

  /*
   * The guard reads `unsavedChanges` at the moment of the gesture rather than holding it, because a
   * panel becomes dirty and clean again while it is open and a cached answer asks the wrong
   * question. A panel mid-commit has nothing to lose by waiting rather than by discarding, so the
   * busy state is not part of this — an exit while the request is in flight is refused outright
   * below instead.
   */
  const guard = new CloseGuard(() => guarded);

  /*
   * `onOpen` on the opening TRANSITION, never on the state. Written as a transition so a caller
   * that opens an already-configured panel is not reset under itself, and so the reset cannot
   * re-run when some unrelated piece of state the effect happened to read changes — which is
   * exactly how the hand-written version of this misbehaves in the panels it replaces.
   */
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      done = false;
      onOpen?.();
    }
    wasOpen = open;
  });

  /** Leave, without asking. The path a committed act and an allowed discard both take. */
  function close(): void {
    open = false;
  }

  /**
   * The one guard every exit runs through. A second exit that skipped the question would make the
   * question decorative, so there is exactly one of these and every gesture calls it.
   *
   * A commit in flight refuses to close at all: the request is already with the server, and a panel
   * that vanished mid-write would leave the reader unable to see what happened.
   */
  function requestClose(): void {
    if (busy) return;
    if (!guard.request("closeSurface")) return;
    close();
    onDismiss?.();
  }

  /** The reader chose to throw the work away. */
  function discardAndClose(): void {
    guard.release();
    close();
    onDismiss?.();
  }

  async function commit(): Promise<void> {
    if (
      busy ||
      done ||
      commitRefusal !== undefined ||
      commitSoon !== undefined ||
      onCommit === undefined
    ) {
      return;
    }
    busy = true;
    try {
      const outcome = await onCommit();
      if (outcome === "committed") close();
      else if (outcome === "done") done = true;
    } finally {
      // Lowered whatever happened, including a handler that threw: a panel stuck busy is a panel
      // the reader can neither commit nor leave, which is worse than the failure that caused it.
      busy = false;
    }
  }

  /**
   * The primary pane is a form, and the commit in the bar is its submit button by id. That is what
   * makes Enter commit: the platform's implicit submission fires the form's default button, and
   * only while that button is enabled — so a refused commit refuses Enter too, for free.
   */
  const formIdentifier = $props.id();

  /** The primary pane, so focus can be sent to its first field on open. */
  let pane = $state<HTMLFormElement | null>(null);

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    void commit();
  }

  /**
   * Ctrl+Enter or Cmd+Enter commits from anywhere in the pane. Enter alone already does, except in
   * a textarea, where it must go on meaning a new line — this is the one gesture that reaches the
   * commit from there without the reader leaving the field.
   */
  function commitOnModifiedEnter(event: KeyboardEvent): void {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    void commit();
  }

  const FOCUSABLE =
    "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), " +
    'button:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function keepFocusWhereItIs(event: Event): void {
    if (!restoreFocus) event.preventDefault();
  }

  function focusFirstField(event: Event): void {
    const first = pane?.querySelector<HTMLElement>(FOCUSABLE);
    if (first === null || first === undefined) return;
    event.preventDefault();
    first.focus();
  }

  const commitText = $derived(busy ? (commitBusyLabel ?? commitLabel ?? "") : (commitLabel ?? ""));
  /* The trait is null only for a reading kind, whose bar renders no commit at all. */
  const commitVariant = $derived(traits.commitVariant ?? "primary");
  const commitTitle = $derived(commitRefusal ?? commitText);
  const commitAccessibleName = $derived(
    commitRefusal === undefined ? commitText : `${commitLabel ?? ""}: ${commitRefusal}`,
  );

  /*
   * The panel's classes: the frame, and the width as a utility. Width is a utility because the
   * panel underneath already carries its default cap as one, and only a utility can replace a
   * utility. Everything else about the panel's geometry is the frame recipe's.
   */
  const panelClasses = $derived(
    mergeClasses(
      "mc-modal-frame",
      isExpanded
        ? expansion.panelClasses("")
        : widthClass(width, { withContext: context !== undefined }),
    ),
  );
</script>

{#snippet headerActions()}
  <!-- The corner dismiss, inline in the header band rather than pinned over it, so a long heading
       never runs beneath it and it sits where the record window's own close sits. A plain control
       rather than the dialog's Close part, so closing runs the unsaved-work guard the other exits
       run. -->
  {#if traits.showsCornerDismiss}
    <div class="mc-modal-frame-header-actions">
      {#if menu}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            data-action-dialog-action="menu"
            class="mc-modal-frame-header-action"
            title="More"
            aria-label="More"
          >
            <EllipsisVertical class="mc-modal-frame-header-icon" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            {@render menu()}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
      {#if traits.expandable}
        <button
          type="button"
          data-action-dialog-action="expand"
          class="mc-modal-frame-header-action"
          aria-pressed={isExpanded}
          title={expansion.label}
          aria-label={expansion.label}
          onclick={() => expansion.toggle()}
        >
          {#if isExpanded}
            <Minimize2 class="mc-modal-frame-header-icon" aria-hidden="true" />
          {:else}
            <Maximize2 class="mc-modal-frame-header-icon" aria-hidden="true" />
          {/if}
        </button>
      {/if}
      <button
        type="button"
        data-action-dialog-action="close"
        class="mc-modal-frame-header-action"
        title="Close"
        aria-label="Close"
        onclick={requestClose}
      >
        <X class="mc-modal-frame-header-icon" aria-hidden="true" />
      </button>
    </div>
  {/if}
{/snippet}

{#snippet subtitleContent()}
  {#if typeof subtitle === "function"}
    {@render subtitle()}
  {:else if subtitle}
    <RecordSubjectLine subject={subtitle} />
  {/if}
{/snippet}

{#snippet body()}
  <!-- On a narrow screen the two panes stand one above the other and the body scrolls as one:
       side by side at phone width, each got a sliver and the words broke a letter per line. -->
  <div class="mc-modal-frame-body mc-scrollbar max-md:flex-col max-md:overflow-y-auto">
    <!-- A form, so that Enter commits (see the head of this file). `novalidate` because a refusal
         is the shell's — stated beside the commit, never a browser bubble over a field. The keydown
         listener does not make the form interactive: it hears a shortcut from a field that already
         has focus, and does nothing for a reader who is not in one. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <form
      id={formIdentifier}
      bind:this={pane}
      class="mc-modal-frame-pane mc-action-dialog-fields mc-scrollbar max-md:w-full max-md:max-w-none max-md:flex-none max-md:overflow-visible"
      novalidate
      onsubmit={submit}
      onkeydown={commitOnModifiedEnter}
    >
      {#if fields}
        {@render fields({ busy, done })}
      {/if}
    </form>
    {#if context}
      <div
        class="mc-modal-frame-context mc-action-dialog-context max-md:w-full max-md:flex-none max-md:border-t max-md:border-s-0"
      >
        <div class="mc-modal-frame-context-body mc-scrollbar">
          {@render context({ busy, done })}
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet noticeBand()}
  <!-- The notice sits between the body and the action bar, outside the scroll: a refusal comes
       back from pressing the commit, and that is where the reader is looking when it does. Its
       content is the caller's; only this position is the shell's. An empty band draws nothing. -->
  {#if notice}
    <div class="mc-modal-frame-notice">
      {@render notice()}
    </div>
  {/if}
{/snippet}

{#snippet footer()}
  <!-- A plain div rather than <footer>: that maps to the contentinfo landmark, which may not sit
       inside a dialog. The classes carry the structure; the role would be wrong.

       The order is the shell's and is the same in every panel in the product — the dismissal at the
       weak hand, the commit last at the strong hand. A caller supplies one verb and nothing else.

       The two markers are what a scan reads: tooling/lint-one-ui asserts this set and this order
       against this file, the same way it asserts the record window's header set, so the promise
       cannot be quietly rearranged. -->
  <div class="mc-modal-frame-actions mc-action-dialog-actions">
    <!-- The refusal, READ ALOUD rather than only hovered. A `title` is not discoverable by anyone
         who is not already hunting for the reason, and the reader who most needs it is the one
         looking at a control that will not press. It sits at the weak end of the bar, so it never
         moves the two controls. It is also on the commit's accessible name, so the refusal reaches
         a screen reader from the control it is about. -->
    {#if commitRefusal !== undefined}
      <span class="me-auto text-xs text-text-muted">{commitRefusal}</span>
    {/if}
    <Button
      data-action-dialog-action="dismiss"
      variant="secondary"
      disabled={busy}
      onclick={requestClose}
    >
      {reading || done ? LEAVE_LABEL : DISMISS_LABEL}
    </Button>
    <!-- A reading panel asks for nothing, so its bar ends at the way out. The commit's marker is
         still the last thing in this source, which is the order the footer-set rule reads.

         The commit is the pane's submit button — `form` ties it to the form it sits outside of —
         which is what lets Enter in a field press it. It is one snippet rendered one of two ways
         so the bar holds exactly one commit in this source whether or not the act is served yet:
         the Soon affordance takes the same control and hands it the attributes that disable it
         and say why. -->
    {#if traits.commitVariant !== null && !done}
      {#snippet commitControl(soon?: SoonControlProperties)}
        <Button
          data-action-dialog-action="commit"
          type="submit"
          form={formIdentifier}
          variant={commitVariant}
          disabled={busy || commitRefusal !== undefined}
          title={commitTitle}
          aria-label={commitAccessibleName}
          {...soon ?? {}}
        >
          {commitText}
        </Button>
      {/snippet}
      {#if commitSoon === undefined}
        {@render commitControl()}
      {:else}
        <SoonAffordance reason={commitSoon.reason} control={commitControl} />
      {/if}
    {/if}
  </div>
{/snippet}

{#if traits.primitive === "alert-dialog"}
  <!-- A question. Bits gives an AlertDialog no dismissal on a press outside and no corner ✕ of its
       own, which is exactly what this kind wants — so the trait table describes the primitive
       rather than fighting it. Escape still reaches the guard through this binding. -->
  <AlertDialog.Root
    bind:open={
      () => open,
      (next) => {
        if (next) {
          open = true;
          return;
        }
        requestClose();
      }
    }
  >
    <AlertDialog.Content
      class={panelClasses}
      data-modal-shell="action-dialog"
      data-action-kind={kind}
      data-expanded={isExpanded ? "true" : "false"}
      onOpenAutoFocus={focusFirstField}
      onCloseAutoFocus={keepFocusWhereItIs}
    >
      <div class="mc-modal-frame-header">
        {#snippet identity()}
          <div class="mc-modal-frame-identity">
            <AlertDialog.Title class="mc-modal-frame-heading">{heading}</AlertDialog.Title>
            {#if hasSubtitle}
              <AlertDialog.Description class="mc-modal-frame-subtitle">
                {@render subtitleContent()}
              </AlertDialog.Description>
            {/if}
          </div>
        {/snippet}
        {#if leading}
          <div class="mc-modal-frame-lead">
            {@render leading()}
            {@render identity()}
          </div>
        {:else}
          {@render identity()}
        {/if}
        {@render headerActions()}
      </div>
      {@render body()}
      {@render noticeBand()}
      {@render footer()}
    </AlertDialog.Content>
  </AlertDialog.Root>
{:else}
  <Dialog.Root
    bind:open={
      () => open,
      (next) => {
        if (next) {
          open = true;
          return;
        }
        requestClose();
      }
    }
  >
    <Dialog.Content
      showClose={false}
      class={panelClasses}
      data-modal-shell="action-dialog"
      data-action-kind={kind}
      data-expanded={isExpanded ? "true" : "false"}
      onOpenAutoFocus={focusFirstField}
      onCloseAutoFocus={keepFocusWhereItIs}
    >
      <div class="mc-modal-frame-header">
        {#snippet identity()}
          <div class="mc-modal-frame-identity">
            <Dialog.Title class="mc-modal-frame-heading">{heading}</Dialog.Title>
            {#if hasSubtitle}
              <Dialog.Description class="mc-modal-frame-subtitle">
                {@render subtitleContent()}
              </Dialog.Description>
            {/if}
          </div>
        {/snippet}
        {#if leading}
          <div class="mc-modal-frame-lead">
            {@render leading()}
            {@render identity()}
          </div>
        {:else}
          {@render identity()}
        {/if}
        {@render headerActions()}
      </div>
      {@render body()}
      {@render noticeBand()}
      {@render footer()}
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- The question stands on its heading alone here. The sentence under it — that entries would be
     thrown away and nothing else had changed — restated what "Discard Your Changes?" already asks,
     and the owner struck it (2026-09-18). The record window keeps its own line, because a record
     being changed is a different stake from a form being filled. -->
<DiscardQuestion {guard} onDiscard={discardAndClose} />

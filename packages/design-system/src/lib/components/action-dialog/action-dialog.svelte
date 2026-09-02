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
   * THE COMMIT OWNS THE CLOSE. `onCommit` reports "committed" or "refused"; the shell raises the
   * busy state around it, closes on the first and stands its ground on the second. A caller never
   * writes `open` on the way out — that is what keeps the close to one path, and a close path with
   * one entrance is the only kind a guard can actually cover.
   *
   * FOCUS LANDS ON THE FIRST FIELD, not the first control. The header's close is first in the DOM
   * because the header is first in the frame, and a form that opened with its own dismiss focused
   * would be inviting the reader to leave. So the panel hands focus to the first focusable thing
   * in its primary pane, and only where there is none — a question with no fields — does the
   * primitive's own default (the dismissal) stand.
   */
  import type { Snippet } from "svelte";
  import X from "@lucide/svelte/icons/x";
  import * as Dialog from "../dialog/index.ts";
  import * as AlertDialog from "../alert-dialog/index.ts";
  import Button from "../button/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { CloseGuard } from "../../internal/close-guard.svelte.ts";
  import DiscardQuestion from "../../internal/discard-question.svelte";
  import {
    DISCARD_SENTENCE,
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
     */
    subtitle?: Snippet;
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
     * The body. Handed `busy` so ONE snippet renders the fields at rest and while the commit is in
     * flight — two snippets would be two layouts, and they would disagree within a week.
     */
    fields?: Snippet<[{ busy: boolean }]>;
    /**
     * What stands beside the fields, in the record window's own right pane: the thing being acted
     * on, or the facts that decide whether the act may happen. Given, the panel opens at the record
     * width whatever `width` says, because two panes have a geometry of their own. Handed `busy`
     * for the same reason the fields are.
     */
    context?: Snippet<[{ busy: boolean }]>;
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
     * "refused" leaves it standing with whatever the caller has put in the notice slot.
     */
    onCommit: () => Promise<ActionOutcome>;
  };

  type Reading = Shared & {
    /** A panel that shows a thing and asks for nothing. Any step it offers is seated in its body. */
    kind: "reading";
    commitLabel?: never;
    commitBusyLabel?: never;
    commitRefusal?: never;
    onCommit?: never;
  };

  let {
    open = $bindable(false),
    kind = "form",
    heading,
    subtitle,
    notice,
    fields,
    context,
    commitLabel,
    commitBusyLabel,
    commitRefusal,
    onCommit,
    onOpen,
    onDismiss,
    unsavedChanges,
    width = "default",
  }: Acting | Reading = $props();

  const traits = $derived(traitsOf(kind));
  const reading = $derived(kind === "reading");

  /* Nothing to lose is the reading panel's default; the careful default is the acting kinds'. */
  const guarded = $derived(unsavedChanges ?? !reading);

  /** Raised across the commit, and read by the panes as well as by both footer controls. */
  let busy = $state(false);

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
    if (open && !wasOpen) onOpen?.();
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
    if (busy || commitRefusal !== undefined || onCommit === undefined) return;
    busy = true;
    try {
      const outcome = await onCommit();
      if (outcome === "committed") close();
    } finally {
      // Lowered whatever happened, including a handler that threw: a panel stuck busy is a panel
      // the reader can neither commit nor leave, which is worse than the failure that caused it.
      busy = false;
    }
  }

  /** The primary pane, so focus can be sent to its first field on open. */
  let pane = $state<HTMLElement | null>(null);

  const FOCUSABLE =
    "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), " +
    'button:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusFirstField(event: Event): void {
    const first = pane?.querySelector<HTMLElement>(FOCUSABLE);
    if (first === null || first === undefined) return;
    event.preventDefault();
    first.focus();
  }

  const commitText = $derived(busy ? (commitBusyLabel ?? commitLabel ?? "") : (commitLabel ?? ""));
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
    mergeClasses("mc-modal-frame", widthClass(width, { withContext: context !== undefined })),
  );
</script>

{#snippet headerActions()}
  <!-- The corner dismiss, inline in the header band rather than pinned over it, so a long heading
       never runs beneath it and it sits where the record window's own close sits. A plain control
       rather than the dialog's Close part, so closing runs the unsaved-work guard the other exits
       run. -->
  {#if traits.showsCornerDismiss}
    <div class="mc-modal-frame-header-actions">
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

{#snippet body()}
  <div class="mc-modal-frame-body">
    <div bind:this={pane} class="mc-modal-frame-pane mc-action-dialog-fields">
      {#if fields}
        {@render fields({ busy })}
      {/if}
    </div>
    {#if context}
      <div class="mc-modal-frame-context mc-action-dialog-context">
        <div class="mc-modal-frame-context-body mc-scrollbar">
          {@render context({ busy })}
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
      {reading ? LEAVE_LABEL : DISMISS_LABEL}
    </Button>
    <!-- A reading panel asks for nothing, so its bar ends at the way out. The commit's marker is
         still the last thing in this source, which is the order the footer-set rule reads. -->
    {#if traits.commitVariant !== null}
      <Button
        data-action-dialog-action="commit"
        variant={traits.commitVariant}
        disabled={busy || commitRefusal !== undefined}
        title={commitTitle}
        aria-label={commitAccessibleName}
        onclick={commit}
      >
        {commitText}
      </Button>
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
      onOpenAutoFocus={focusFirstField}
    >
      <div class="mc-modal-frame-header">
        <div class="mc-modal-frame-identity">
          <AlertDialog.Title class="mc-modal-frame-heading">{heading}</AlertDialog.Title>
          {#if subtitle}
            <AlertDialog.Description class="mc-modal-frame-subtitle">
              {@render subtitle()}
            </AlertDialog.Description>
          {/if}
        </div>
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
      onOpenAutoFocus={focusFirstField}
    >
      <div class="mc-modal-frame-header">
        <div class="mc-modal-frame-identity">
          <Dialog.Title class="mc-modal-frame-heading">{heading}</Dialog.Title>
          {#if subtitle}
            <Dialog.Description class="mc-modal-frame-subtitle">
              {@render subtitle()}
            </Dialog.Description>
          {/if}
        </div>
        {@render headerActions()}
      </div>
      {@render body()}
      {@render noticeBand()}
      {@render footer()}
    </Dialog.Content>
  </Dialog.Root>
{/if}

<DiscardQuestion {guard} description={DISCARD_SENTENCE} onDiscard={discardAndClose} />

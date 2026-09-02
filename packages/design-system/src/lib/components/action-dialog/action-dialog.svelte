<script lang="ts">
  /*
   * ActionDialog — the panel an act is asked for in, and the only one there is.
   *
   * A record is READ and CHANGED in a RecordWindow; an act is ASKED FOR here. Between them they are
   * every modal surface the product has, so a reader learns two panels rather than one per screen.
   *
   * THE SHELL IS DOMAIN-BLIND, ON PURPOSE AND MECHANICALLY. A caller contributes a heading, a
   * subtitle, a notice, a body and one commit verb, and nothing else — no field, no state machine,
   * no word of any one kind of act settles here. tooling/lint-one-ui asserts it at the source, the
   * same way it asserts it for the record window.
   *
   * WHAT THE SHELL OWNS IS NOT A SET OF DEFAULTS — IT IS THE ABSENCE OF PROPS. The footer's
   * geometry and the order of its two controls, the dismissal's word, the busy state, whether the
   * corner dismiss shows, which primitive renders the panel, and the one close path every exit runs
   * through: none of them can be overridden, which is what makes them true everywhere. What a
   * caller may differ on is a closed set — the two snippets, `kind`, `width`, and the commit's
   * outcome. There is deliberately no `class` prop.
   *
   * THE KIND CHOOSES THE PRIMITIVE, which is the most valuable line in the contract. A `form` is a
   * Dialog; a `confirm` or `destructive` is an AlertDialog, with the `alertdialog` role, no corner
   * dismiss, and no dismissal on a press outside — a question that can be dismissed by a stray
   * press is not a question. The panels this shell replaces each decided that for themselves and
   * disagreed: four reached AlertDialog and thirty did not, with no rule behind the split.
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
   * FIT FIRST, CAP SECOND. A short panel sizes to its content and does not scroll; a panel that
   * genuinely exceeds the viewport caps, and then the BODY alone moves while the heading and the
   * action bar stay put. That is two utilities rather than a recipe — this component dresses
   * nothing, it composes what the Dialog and AlertDialog recipes already decide.
   */
  import type { Snippet } from "svelte";
  import * as Dialog from "../dialog/index.ts";
  import * as AlertDialog from "../alert-dialog/index.ts";
  import Button from "../button/index.ts";
  import { CloseGuard } from "../../internal/close-guard.svelte.ts";
  import DiscardQuestion from "../../internal/discard-question.svelte";
  import { DISCARD_SENTENCE, traitsOf, widthClass } from "./action-dialog-model.ts";
  import type { ActionDialogKind, ActionDialogWidth, ActionOutcome } from "./types.ts";

  let {
    open = $bindable(false),
    kind = "form",
    heading,
    subtitle,
    notice,
    fields,
    commitLabel,
    commitRefusal,
    onCommit,
    onOpen,
    onDismiss,
    unsavedChanges = true,
    width = "default",
  }: {
    /** Whether the panel is showing. Bindable, so a surface can open and close it. */
    open?: boolean;
    /** What is being asked. Decides the primitive, the dismissal verb and the commit's colour. */
    kind?: ActionDialogKind;
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
     * own problem model — so the shell reserves the slot directly beneath the subtitle and renders
     * whatever arrives in it. Same division as the record window's menu: the place here, the
     * content there. It is what lets the next change to how a failure reads touch one component
     * instead of every panel.
     */
    notice?: Snippet;
    /**
     * The body. Handed `busy` so ONE snippet renders the fields at rest and while the commit is in
     * flight — two snippets would be two layouts, and they would disagree within a week.
     */
    fields?: Snippet<[{ busy: boolean }]>;
    /** The commit's own verb — "Write Off a Balance", never "OK", "Submit" or "Confirm". */
    commitLabel: string;
    /**
     * Why the commit is unavailable, if it is. The control is DISABLED and titled with this rather
     * than hidden: an act that vanishes teaches a reader nothing, and a refusal is stated where it
     * is caused. Undefined means the commit is available.
     */
    commitRefusal?: string;
    /**
     * Do it. The shell raises the busy state, awaits, and lowers it. "committed" closes the panel;
     * "refused" leaves it standing with whatever the caller has put in the notice slot.
     */
    onCommit: () => Promise<ActionOutcome>;
    /**
     * Fired once each time the panel opens — where a caller clears its fields. Once per OPENING,
     * not per render, which is the bug in the hand-written effect this replaces: an effect that
     * reads other state as well as `open` re-runs mid-edit and wipes what the reader has typed.
     */
    onOpen?: () => void;
    /** Fired after a dismissal that was not a commit, once the guard has allowed it. */
    onDismiss?: () => void;
    /**
     * Whether there is anything to lose. `true` (the default) makes every exit ask first. A caller
     * that can see its fields are untouched passes false and the question is skipped. The default
     * is the careful one because a caller that never thought about it should get the question
     * rather than the silence.
     */
    unsavedChanges?: boolean;
    /** How wide the panel opens. A closed set, not a class. */
    width?: ActionDialogWidth;
  } = $props();

  const traits = $derived(traitsOf(kind));

  /** Raised across the commit, and read by the fields as well as by both footer controls. */
  let busy = $state(false);

  /*
   * The guard reads `unsavedChanges` at the moment of the gesture rather than holding it, because a
   * panel becomes dirty and clean again while it is open and a cached answer asks the wrong
   * question. A panel mid-commit has nothing to lose by waiting rather than by discarding, so the
   * busy state is not part of this — an exit while the request is in flight is refused outright
   * below instead.
   */
  const guard = new CloseGuard(() => unsavedChanges);

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
    if (busy || commitRefusal !== undefined) return;
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

  const commitTitle = $derived(commitRefusal ?? commitLabel);
  const commitAccessibleName = $derived(
    commitRefusal === undefined ? commitLabel : `${commitLabel}: ${commitRefusal}`,
  );

  /*
   * The panel's classes. `overflow-hidden` replaces the recipe's own `overflow-y: auto` so the BODY
   * scrolls rather than the whole panel — otherwise a long form scrolls its own commit off the
   * screen. Both are utilities because the panel underneath already carries its width cap as one,
   * and only a utility can replace a utility.
   */
  const panelClasses = $derived(`${widthClass(width)} gap-16 overflow-hidden`);
</script>

{#snippet body()}
  <!-- The notice sits above the fields and below the subtitle: a failure a reader has to scroll to
       find has not been reported. Its content is the caller's; only this position is the shell's. -->
  {#if notice}
    {@render notice()}
  {/if}
  {#if fields}
    <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto">
      {@render fields({ busy })}
    </div>
  {/if}
{/snippet}

{#snippet footer(dismiss: () => void)}
  <!-- A plain div rather than <footer>: that maps to the contentinfo landmark, which may not sit
       inside a dialog. The classes carry the structure; the role would be wrong.

       The order is the shell's and is the same in every panel in the product — the dismissal at the
       weak hand, the commit last at the strong hand. A caller supplies one verb and nothing else.

       The two markers are what a scan reads: tooling/lint-one-ui asserts this set and this order
       against this file, the same way it asserts the record window's header set, so the promise
       cannot be quietly rearranged. The wrapper class is a marker too and carries no recipe. -->
  <div class="mc-action-dialog-actions flex flex-none items-center justify-end gap-8">
    <Button data-action-dialog-action="dismiss" variant="secondary" disabled={busy} onclick={dismiss}>
      {traits.dismissLabel}
    </Button>
    <Button
      data-action-dialog-action="commit"
      variant={traits.commitVariant}
      disabled={busy || commitRefusal !== undefined}
      title={commitTitle}
      aria-label={commitAccessibleName}
      onclick={commit}
    >
      {commitLabel}
    </Button>
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
    <AlertDialog.Content class={panelClasses} data-modal-shell="action-dialog" data-action-kind={kind}>
      <div class="flex flex-none flex-col gap-4">
        <AlertDialog.Title>{heading}</AlertDialog.Title>
        {#if subtitle}
          <AlertDialog.Description>{@render subtitle()}</AlertDialog.Description>
        {/if}
      </div>
      {@render body()}
      {@render footer(requestClose)}
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
      showClose={traits.showsCornerDismiss}
      class={panelClasses}
      data-modal-shell="action-dialog"
      data-action-kind={kind}
    >
      <div class="flex flex-none flex-col gap-4">
        <Dialog.Title>{heading}</Dialog.Title>
        {#if subtitle}
          <Dialog.Description>{@render subtitle()}</Dialog.Description>
        {/if}
      </div>
      {@render body()}
      {@render footer(requestClose)}
    </Dialog.Content>
  </Dialog.Root>
{/if}

<DiscardQuestion {guard} description={DISCARD_SENTENCE} onDiscard={discardAndClose} />

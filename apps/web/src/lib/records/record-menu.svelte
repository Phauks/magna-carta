<script lang="ts">
  /*
   * RecordMenu — the right-click menu that speaks for a whole selection.
   *
   * This file renders a menu and decides nothing about it. Which verbs appear, what each is called,
   * what it counts, whether it is refused and in what words: all of that is a pure function over the
   * described selection, and it lives beside this file so it can be asserted without a browser. What
   * is left here is the four things only a rendered menu can do.
   *
   *   THE SEPARATOR RULE. Groups are drawn between hairlines, and a group with nothing in it took
   *   its rule with it before the model ever reached this file. Two rules with nothing between them
   *   are impossible by construction rather than by care.
   *
   *   A REFUSAL IS VISIBLE AND EXPLAINED. A verb this selection cannot take renders disabled with
   *   its reason on the hover AND as its accessible description, because a disabled row cannot be
   *   focused and a title alone would say nothing to anyone not using a mouse.
   *
   *   A NOT-YET-BUILT VERB LOOKS THE SAME AS EVERY OTHER ONE. It renders in full, disabled, wearing
   *   the Soon mark, with the dependency in the same place the refusals put their reason. The
   *   attributes and the sentence come from the product's one Soon composition rather than being
   *   written again here — a menu row is the case that composition's own note anticipates, where
   *   the badge carries the fact and a printed sentence under every disabled row would bury the
   *   menu it belongs to.
   *
   *   A DISPLAYED SHORTCUT WORKS. The window listener resolves a keystroke to the very action
   *   object a row is drawing, so the keycaps on the right of a row and the behaviour of those keys
   *   cannot come apart. A refused row is not reachable by its own keycaps either.
   */
  import type { Snippet } from "svelte";
  import * as ContextMenu from "@magna-carta/design-system/context-menu";
  import Keyboard from "@magna-carta/design-system/keyboard";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import { soonControlProperties } from "$lib/maturity/soon-affordance.ts";
  import {
    shortcutKeycaps,
    type RecordMenuAction,
    type RecordMenuChoice,
    type RecordMenuFlyout,
    type RecordMenuModel,
  } from "./record-menu-model.ts";
  import { isTypingTarget, shortcutAction } from "./record-menu-shortcuts.ts";

  let {
    menu,
    onAction,
    onChoice,
    shortcutsEnabled = true,
    class: className,
    children,
  }: {
    /** The menu for the current selection, already decided. */
    menu: RecordMenuModel;
    /** A verb was chosen. */
    onAction: (action: RecordMenuAction) => void;
    /** A choice inside a verb's flyout was picked. */
    onChoice: (flyout: RecordMenuFlyout, choice: RecordMenuChoice) => void;
    /**
     * Whether this menu's shortcuts listen on the window. One surface owns the keyboard at a time;
     * a second menu mounted beside the first turns its own off rather than both firing.
     */
    shortcutsEnabled?: boolean;
    /**
     * The trigger region's own classes.
     *
     * The trigger wraps whatever the menu is summoned over, so it sits in the middle of a height
     * chain: a table told to fill the screen cannot do it through an element that sizes to its
     * content. A surface that needs the region to carry height says so here.
     */
    class?: string;
    /** The region the menu is summoned over: the table, the icon grid, the empty space beneath. */
    children: Snippet;
  } = $props();

  const descriptionBase = $props.id();

  /** Where a row's reason or dependency is written, for the row to point its description at. */
  const descriptionIdentifier = (identifier: string): string =>
    `${descriptionBase}-${identifier}`;

  /**
   * What a row spreads onto itself: disabled or not, and where its explanation is.
   *
   * The two kinds of "cannot" answer differently — this selection cannot take this verb, versus
   * nobody can yet — so the Soon case takes its attributes and its wording from the product's one
   * Soon composition, and the refusal case says what it was handed.
   */
  function rowState(action: RecordMenuAction): {
    disabled: boolean;
    title?: string;
    "aria-describedby"?: string;
  } {
    if (action.soonDependency !== undefined) {
      return soonControlProperties(
        action.soonDependency,
        descriptionIdentifier(action.identifier),
      );
    }
    if (action.disabledReason !== undefined) {
      return {
        disabled: true,
        title: action.disabledReason,
        "aria-describedby": descriptionIdentifier(action.identifier),
      };
    }
    return { disabled: false };
  }

  /** The sentence a row's description carries, or null where the row has nothing to explain. */
  function rowExplanation(action: RecordMenuAction): string | null {
    const state = rowState(action);
    return state.title ?? null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!shortcutsEnabled) return;
    const action = shortcutAction(menu, event, {
      inTextField: isTypingTarget(event.target),
      hasTextSelection: (globalThis.getSelection?.()?.toString() ?? "") !== "",
    });
    if (action === null) return;
    event.preventDefault();
    onAction(action);
  }

  /** Whether a flyout's choices are a pick-one set rather than a list of things to do. */
  const isPickOne = (flyout: RecordMenuFlyout): boolean =>
    flyout.choices.some((choice) => choice.selected !== undefined);

  /** The choice the whole scope already carries, for a pick-one flyout's current value. */
  const pickedChoice = (flyout: RecordMenuFlyout): string =>
    flyout.choices.find((choice) => choice.selected === true)?.identifier ?? "";
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet actionRow(action: RecordMenuAction)}
  {@const Icon = action.icon}
  {@const state = rowState(action)}
  {@const explanation = rowExplanation(action)}
  <ContextMenu.Item
    disabled={state.disabled}
    title={state.title}
    aria-describedby={state["aria-describedby"]}
    closeOnSelect={action.staysOpen !== true}
    onSelect={() => onAction(action)}
  >
    <Icon class="size-16" aria-hidden="true" fill={action.marked === true ? "currentColor" : "none"} />
    <span>{action.label}</span>
    {#if action.soonDependency !== undefined}
      <MaturityBadge stage="soon" />
    {/if}
    {#if action.shortcut !== undefined}
      <span class="ms-auto flex items-center gap-4">
        {#each shortcutKeycaps(action.shortcut) as keycap (keycap)}
          <Keyboard>{keycap}</Keyboard>
        {/each}
      </span>
    {/if}
    {#if explanation !== null}
      <span id={descriptionIdentifier(action.identifier)} class="sr-only">{explanation}</span>
    {/if}
  </ContextMenu.Item>
{/snippet}

{#snippet choiceRow(flyout: RecordMenuFlyout, choice: RecordMenuChoice)}
  {@const soon =
    choice.soonDependency === undefined
      ? null
      : soonControlProperties(choice.soonDependency, descriptionIdentifier(choice.identifier))}
  {@const choiceExplanation = soon?.title ?? choice.disabledReason}
  <ContextMenu.Item
    disabled={choiceExplanation !== undefined}
    title={choiceExplanation}
    aria-describedby={choiceExplanation === undefined
      ? undefined
      : descriptionIdentifier(choice.identifier)}
    onSelect={() => onChoice(flyout, choice)}
  >
    <span>{choice.label}</span>
    {#if soon !== null}
      <MaturityBadge stage="soon" />
    {/if}
    {#if choiceExplanation !== undefined}
      <span id={descriptionIdentifier(choice.identifier)} class="sr-only">{choiceExplanation}</span>
    {/if}
  </ContextMenu.Item>
{/snippet}

{#snippet flyoutRow(flyout: RecordMenuFlyout)}
  {@const Icon = flyout.icon}
  <ContextMenu.Sub>
    <ContextMenu.SubTrigger
      disabled={flyout.disabledReason !== undefined}
      title={flyout.disabledReason}
      aria-describedby={flyout.disabledReason === undefined
        ? undefined
        : descriptionIdentifier(flyout.identifier)}
    >
      <Icon class="size-16" aria-hidden="true" />
      <span>{flyout.label}</span>
      {#if flyout.disabledReason !== undefined}
        <span id={descriptionIdentifier(flyout.identifier)} class="sr-only">
          {flyout.disabledReason}
        </span>
      {/if}
    </ContextMenu.SubTrigger>
    <ContextMenu.SubContent>
      {#if isPickOne(flyout)}
        <ContextMenu.RadioGroup
          bind:value={
            () => pickedChoice(flyout),
            (next) => {
              const choice = flyout.choices.find((candidate) => candidate.identifier === next);
              if (choice !== undefined) onChoice(flyout, choice);
            }
          }
        >
          {#each flyout.choices as choice (choice.identifier)}
            <ContextMenu.RadioItem value={choice.identifier}>{choice.label}</ContextMenu.RadioItem>
          {/each}
        </ContextMenu.RadioGroup>
      {:else}
        {#each flyout.choices as choice (choice.identifier)}
          {@render choiceRow(flyout, choice)}
        {/each}
      {/if}
    </ContextMenu.SubContent>
  </ContextMenu.Sub>
{/snippet}

<ContextMenu.Root>
  <ContextMenu.Trigger class={className}>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    {#each menu as group, index (group.identifier)}
      {#if index > 0}
        <ContextMenu.Separator />
      {/if}
      <ContextMenu.Group>
        {#each group.items as item (item.identifier)}
          {#if item.kind === "flyout"}
            {@render flyoutRow(item)}
          {:else}
            {@render actionRow(item)}
          {/if}
        {/each}
      </ContextMenu.Group>
    {/each}
  </ContextMenu.Content>
</ContextMenu.Root>

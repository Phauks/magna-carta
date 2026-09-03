<script lang="ts">
  /*
   * CreateControl (Tier 1 over Button, Tier 3 when it carries a menu) — the product's ONE control
   * for making something new on a screen: the matter header's "New Fee", the docket's "New
   * Matter", the directory's "New", the custody register's "New Packet". Every screen that creates
   * a record draws this and nothing else, so the control is found by position on every screen
   * and reads the same way on all of them.
   *
   * IT HOLDS ONE WIDTH. The inline size is a token (size.create-control), not a fit to the label,
   * and the label truncates inside it. A control that widened to fit "New Packet" and narrowed for
   * "New" would move whatever sits beside it — on every screen that is the search, which grows
   * toward the inline start and is reached for by where it is. The noun budget in create-label.ts
   * is what makes the truncation theoretical.
   *
   * IT NEVER LEAVES. A screen where nothing can be made right now — a permission the reader lacks,
   * a view with nothing to create into, a sample record — hands over a `refusal`, and the control
   * renders disabled carrying it as its title. Absent would reflow the row; disabled with the
   * reason is the standing rule for a control that is not pressable.
   *
   * ONE ACTION OR A MENU, SAME FOOTPRINT. `onpress` for a screen with one thing to make; `choices`
   * for one with several (Files: a document, a folder, an upload; Directory: a person, an
   * organization). A menu is marked by a chevron inside the same width. A menu whose every choice
   * is refused is not drawn as a menu: the control states the first refusal and stays shut,
   * because a glyph that has to be opened to learn it holds nothing pressable is chrome that
   * costs a control's width and returns nothing.
   */
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import Button, { buttonClasses } from "../button/index.ts";
  import * as DropdownMenu from "../dropdown-menu/index.ts";
  import { assertCreateNoun, CREATE_BARE_LABEL, createLabel } from "./create-label.ts";
  import type { CreateChoice } from "./types.ts";

  /*
   * A closed prop set, on purpose: the control renders as a Button or as a menu trigger, two
   * elements with two attribute types, and an open spread onto both is a union svelte-check
   * cannot represent. What a screen may vary is named here; the width, the glyph and the
   * disabled treatment are not on the list.
   */
  type Props = {
    /** The rendered button element. Bindable. */
    ref?: HTMLElement | null;
    class?: string;
    /**
     * The record this control makes, as one capitalised word: "Fee" reads as New Fee. Null reads
     * the bare "New", for a screen whose menu names the kinds itself.
     */
    noun?: string | null;
    /** The tooltip while the control is pressable. */
    title?: string;
    /**
     * Why the control cannot be pressed right now. Present, the control renders disabled with this
     * as its title; it never leaves the row.
     */
    refusal?: string;
    /** What one press does. Ignored when `choices` are given. */
    onpress?: () => void;
    /** The menu a press opens, for a screen with several things to make. */
    choices?: readonly CreateChoice[];
  };

  let {
    noun = null,
    title,
    refusal,
    onpress,
    choices,
    ref = $bindable(null),
    class: className,
  }: Props = $props();

  const label = $derived.by(() => {
    if (noun === null) return CREATE_BARE_LABEL;
    assertCreateNoun(noun);
    return createLabel(noun);
  });

  /** The refusal in force: the screen's own, or the menu's when every choice is refused. */
  const standingRefusal = $derived.by((): string | undefined => {
    if (refusal !== undefined) return refusal;
    if (choices !== undefined && choices.length > 0 && choices.every((choice) => choice.refusal !== undefined)) {
      return choices[0]?.refusal;
    }
    return undefined;
  });

  const disabled = $derived(standingRefusal !== undefined);
  const shownTitle = $derived(standingRefusal ?? title ?? label);
  const isMenu = $derived(choices !== undefined && choices.length > 0);
  const classes = $derived(mergeClasses("mc-create-control", className));
</script>

{#if isMenu && !disabled && choices !== undefined}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      bind:ref
      class="{buttonClasses({ variant: 'primary', size: 'default' })} {classes}"
      title={shownTitle}
      data-create-control
    >
      <Plus class="mc-create-control-glyph size-16" aria-hidden="true" />
      <span class="mc-create-control-label">{label}</span>
      <ChevronDown class="mc-create-control-chevron size-12" aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
      {#each choices as choice (choice.label)}
        <DropdownMenu.Item
          onSelect={choice.onselect}
          disabled={choice.refusal !== undefined}
          title={choice.refusal}
        >
          <choice.icon class="size-16" aria-hidden="true" />
          {choice.label}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else}
  <Button
    bind:ref
    class={classes}
    {disabled}
    title={shownTitle}
    onclick={() => onpress?.()}
    data-create-control
  >
    <Plus class="mc-create-control-glyph size-16" aria-hidden="true" />
    <span class="mc-create-control-label">{label}</span>
    {#if isMenu}
      <ChevronDown class="mc-create-control-chevron size-12" aria-hidden="true" />
    {/if}
  </Button>
{/if}

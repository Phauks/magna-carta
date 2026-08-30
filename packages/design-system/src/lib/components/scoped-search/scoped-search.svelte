<script lang="ts">
  /*
   * ScopedSearch (Tier 1: native elements, no Bits UI) — searching WITHIN the screen you are on,
   * as distinct from the top bar's command palette, which searches the application's own surfaces
   * and goes places. The two must never be confused with each other, so this control differs from
   * the palette in every dimension a reader notices: it lives in the screen's action row rather
   * than the chrome, it rests as an icon rather than a bar, its scope names the surface it is
   * searching, and it answers a different key.
   *
   * The shape is the standing rule for list screens in docs/conventions/design-corrections.md:
   * everything above the data that is not the data is a single row, with searching as an icon
   * control that opens what it needs when it is needed. So:
   *
   *   - It rests as an icon and costs the screen NO vertical space.
   *   - It expands on use and collapses again when left empty.
   *   - A live query keeps it open and carries the accent treatment, so a narrowed list always
   *     says on screen why it is narrowed.
   *   - There is no clear button in the field. Escape clears the query; a second Escape collapses
   *     the control and hands focus back to the icon that opened it.
   *
   * The control owns the query string and its own open/closed behaviour, and nothing else. Whether
   * that query filters rows already in the browser or goes to the server is the screen's business,
   * which is what lets one component serve a client-side table and a server-run register alike.
   *
   * The `scope` snippet is the surface's own control (a Select or a DropdownMenu trigger), seated
   * at the field's inline start. Its vocabulary belongs to the surface and never to this component
   * — and it never offers "everywhere", because searching everything is the top bar's job.
   */
  import { tick, type Snippet } from "svelte";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { InputSize } from "../input/variants.ts";

  type Props = {
    /** The query. Bindable — the screen reads it to narrow whatever it is showing. */
    value?: string;
    /** Whether the field is showing. Bindable, so a screen can open the control itself. */
    expanded?: boolean;
    /** Accessible name for both the icon and the field. Name the surface: "Search matters". */
    label?: string;
    /** Hint text shown while the field is empty (not an accessible label). */
    placeholder?: string;
    /** A short count rendered inside the field, at its inline end ("2 of 6"). */
    matchSummary?: string;
    /** Key that expands and focuses the control from anywhere on the page. Pass null for none. */
    shortcut?: string | null;
    /** Control height, from the same scale the Button and Input use. */
    size?: InputSize;
    /** Disables the control so it cannot be expanded or typed into; renders muted. */
    disabled?: boolean;
    /** Width utility for the expanded field. Width is a utility, never a recipe value. */
    fieldClass?: string;
    class?: string;
    /** The surface's own scope control, seated at the field's inline start. */
    scope?: Snippet;
    /** The underlying field element. */
    inputRef?: HTMLInputElement | null;
  };

  let {
    value = $bindable(""),
    expanded = $bindable(false),
    label = "Search",
    placeholder = "Search",
    matchSummary,
    shortcut = "/",
    size = "default",
    disabled = false,
    fieldClass = "w-3xs",
    class: className,
    scope,
    inputRef = $bindable(null),
  }: Props = $props();

  const searching = $derived(value.trim() !== "");

  let root = $state<HTMLDivElement | null>(null);
  let triggerRef = $state<HTMLButtonElement | null>(null);

  /*
   * Expanding hides the very button that was clicked, and hiding a focused element fires a
   * focusout with no relatedTarget — which reads exactly like the user walking away, and would
   * collapse the control on the same gesture that opened it. The flag marks the handover so the
   * collapse rule can tell "focus is leaving" from "focus is moving to the field".
   */
  let handingFocusToField = false;

  async function expand(): Promise<void> {
    if (disabled) return;
    handingFocusToField = true;
    expanded = true;
    await tick();
    inputRef?.focus();
    handingFocusToField = false;
  }

  async function collapse(): Promise<void> {
    expanded = false;
    await tick();
    triggerRef?.focus();
  }

  /*
   * Collapse-when-unused, measured against the WHOLE control rather than the field: the scope
   * control is a sibling inside the same row, so a plain blur handler on the field would collapse
   * the control the moment somebody reached for its scope.
   */
  function handleFocusOut(event: FocusEvent): void {
    if (handingFocusToField || searching || !expanded) return;
    const next = event.relatedTarget;
    if (next instanceof Node && root?.contains(next) === true) return;
    expanded = false;
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // The screen behind this control may also answer Escape (a dialog, a menu); a search that is
    // clearing or closing has consumed the key.
    event.stopPropagation();
    if (value !== "") {
      value = "";
      return;
    }
    void collapse();
  }

  function isTypingElsewhere(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  }

  $effect(() => {
    if (shortcut === null || shortcut === "" || disabled) return;
    const key = shortcut;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== key) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingElsewhere(event.target)) return;
      event.preventDefault();
      void expand();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });
</script>

<div
  bind:this={root}
  role="search"
  aria-label={label}
  data-searching={searching ? "true" : "false"}
  data-size={size}
  class={mergeClasses("mc-scoped-search", className)}
  onfocusout={handleFocusOut}
>
  <div
    class={mergeClasses("mc-scoped-search-field", fieldClass)}
    hidden={!expanded}
  >
    <SearchIcon class="mc-scoped-search-icon" aria-hidden="true" />
    {#if scope}
      <div class="mc-scoped-search-scope">{@render scope()}</div>
    {/if}
    <input
      bind:this={inputRef}
      bind:value
      type="search"
      class="mc-scoped-search-input w-full"
      aria-label={label}
      {placeholder}
      {disabled}
      onkeydown={handleKeyDown}
    />
    {#if matchSummary !== undefined && matchSummary !== ""}
      <span class="mc-scoped-search-summary">{matchSummary}</span>
    {/if}
  </div>
  <button
    bind:this={triggerRef}
    type="button"
    class="mc-scoped-search-trigger"
    aria-label={label}
    aria-expanded={expanded}
    {disabled}
    hidden={expanded}
    onclick={() => void expand()}
  >
    <SearchIcon class="mc-scoped-search-icon" aria-hidden="true" />
  </button>
</div>

<script lang="ts">
  /*
   * ScreenSearch (Tier 1: native elements, no Bits UI) — the product's ONE control for searching
   * within the screen you are on, as distinct from the top bar's command palette, which searches
   * the application's own surfaces and goes places. Every list screen uses this component; a screen
   * that hand-rolls a search box is the defect this exists to end, because eleven copies improve
   * one at a time and drift in between while one component improves for all eleven at once.
   *
   * THE SHAPE is the standing rule for list screens in docs/conventions/design-corrections.md —
   * everything above the data that is not the data is a single row, with searching as an icon
   * control that opens what it needs when it is needed:
   *
   *   - it rests as an icon and costs the screen NO vertical space;
   *   - it expands on use and collapses again when left empty;
   *   - a live query keeps it open and takes a single accent hairline at the field's edge, so a
   *     narrowed list always carries its reason on screen;
   *   - there is no clear button. Escape clears the query; a second Escape collapses the control
   *     and hands focus back to the icon that opened it.
   *
   * THE CALLING SHAPE is the same whether the query is answered in the browser or over the network,
   * which is what makes one component serve every screen. A screen hands over `onsearch` and says
   * when to run it: `searchOn="keystroke"` for data already here, `searchOn="pause"` for a request
   * that leaves the machine. The control owns the query string, the debounce, and the in-flight
   * flag; it owns no results and knows no transport. That division is deliberate — the previous
   * table-bound search box could only ever narrow rows already in the browser, so the screens whose
   * search ran on a server had to bypass it, and did.
   *
   * SEAMS, built and exercised in the catalog, wired to no screen yet. Each says what will use it:
   *
   *   - `scope` — the surface's own scope control, seated at the field's leading edge. Its
   *     vocabulary belongs to the surface ("Everything on this matter", "Files only", "This
   *     folder") and never says "everywhere", because searching everything is the top bar's job.
   *     The matter file manager's scope dropdown is the first thing that will sit here.
   *   - `matchSummary` — a short count inside the field's trailing edge, for a screen that wants
   *     the answer's size where the eye already is.
   *   - `shortcut` — a key that expands and focuses the control from anywhere on the page. Off by
   *     default and deliberately unarmed: a chord is only worth teaching once the screen search and
   *     the palette can be confused with each other, which happens when the palette gains matters
   *     and contacts as their registries ship.
   *   - `busy` / `data-busy` — the control reports a search in flight and dresses nothing yet. A
   *     screen shows its own progress in its results area, which is where the file-manager ruling
   *     puts it; when a treatment for the field itself is ruled on, it lands here, once.
   */
  import { flushSync, onDestroy, type Snippet } from "svelte";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { InputSize } from "../input/variants.ts";
  import { SEARCH_PAUSE_MILLISECONDS } from "./pause.ts";

  type Props = {
    /** The text in the field. Bindable. */
    value?: string;
    /** Whether the field is showing. Bindable, so a screen can open the control itself. */
    expanded?: boolean;
    /** Accessible name for both the icon and the field. Name the surface: "Search matters". */
    label?: string;
    /** Hint text shown while the field is empty (not an accessible label). */
    placeholder?: string;
    /**
     * What the screen does with the query. Return a promise and the control reports itself busy
     * until it settles. The control never touches the results.
     */
    onsearch?: (query: string) => void | Promise<void>;
    /**
     * When `onsearch` runs. "keystroke" for data already in the browser (a filter is cheap, so it
     * keeps up with typing); "pause" for a query that leaves the machine (it waits for typing to
     * stop, so one request goes out per thought).
     */
    searchOn?: "keystroke" | "pause";
    /** Whether a search is in flight. Bindable, so a screen that fetches itself can drive it. */
    busy?: boolean;
    /** Control height, from the same scale the Button and Input use. */
    size?: InputSize;
    /** Disables the control so it cannot be expanded or typed into; renders muted. */
    disabled?: boolean;
    /** Width utility for the expanded field. Width is a utility, never a recipe value. */
    fieldClass?: string;
    class?: string;
    /** Seam: the surface's own scope control, at the field's leading edge. */
    scope?: Snippet;
    /** Seam: a short count inside the field's trailing edge ("2 of 6"). */
    matchSummary?: string;
    /** Seam: a key that expands and focuses the control from anywhere. Off by default. */
    shortcut?: string | null;
    /** The underlying field element. */
    inputRef?: HTMLInputElement | null;
  };

  let {
    value = $bindable(""),
    expanded = $bindable(false),
    label = "Search",
    placeholder = "Search",
    onsearch,
    searchOn = "keystroke",
    busy = $bindable(false),
    size = "default",
    disabled = false,
    fieldClass = "w-3xs",
    class: className,
    scope,
    matchSummary,
    shortcut = null,
    inputRef = $bindable(null),
  }: Props = $props();

  const searching = $derived(value.trim() !== "");

  let root = $state<HTMLDivElement | null>(null);
  let triggerRef = $state<HTMLButtonElement | null>(null);

  /*
   * flushSync, not `await tick()`: the field does not exist until the DOM updates, so focus can
   * only move afterwards — and if that "afterwards" is a later task, everything the person does in
   * between goes somewhere else. Press the icon and start typing quickly and the first characters
   * land on the body instead of the field. Flushing synchronously puts the caret in the field
   * inside the same gesture that opened it, so there is no window to type into.
   */
  function expand(): void {
    if (disabled) return;
    flushSync(() => {
      expanded = true;
    });
    inputRef?.focus();
  }

  function collapse(): void {
    flushSync(() => {
      expanded = false;
    });
    triggerRef?.focus();
  }

  /*
   * Collapse-when-unused. The rule is "collapse when focus LANDS somewhere else", not "collapse
   * when focus leaves", and the difference is the whole reason this is not a one-line blur handler.
   *
   * Expanding hides the very icon that was pressed, and removing a focused element fires a focusout
   * whose relatedTarget is null — indistinguishable, at the moment it fires, from the person
   * clicking away. Trusting that event collapses the control on the same gesture that opened it.
   * Worse, the collapse can arrive a task LATER than the expansion, so the control looks correct
   * the instant it opens and is shut by the time anything reads it: a bug invisible to reasoning
   * about the code, and one that comes straight back if this settles for asking the event.
   *
   * Waiting for focus to settle and then asking where it actually IS answers the question the event
   * cannot, in whatever order the browser moves focus. Two consequences worth stating: it is
   * measured against the WHOLE control, so reaching for the scope control (a sibling in the same
   * row) keeps the field open; and focus landing NOWHERE — the body, after a click on bare
   * background — is not somewhere else, so the field stays. Every deliberate way out still works:
   * Escape, tabbing on, or clicking another control.
   */
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  function collapseWhenFocusSettlesElsewhere(): void {
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      if (!expanded || searching) return;
      const settled = document.activeElement;
      if (settled === null || settled === document.body) return;
      if (root?.contains(settled) === true) return;
      expanded = false;
    });
  }

  // --- the query lifecycle -------------------------------------------------------------------
  //
  // The field is never made to wait: `value` follows the keys immediately, and only the moment the
  // query REACHES the screen is governed by `searchOn`.
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  // Every dispatch takes a ticket. A promise that resolves after a newer one started cannot clear
  // the busy flag, so a slow early request never reports the screen idle while a later one runs.
  let latestDispatch = 0;

  function cancelPending(): void {
    if (pauseTimer !== undefined) clearTimeout(pauseTimer);
    pauseTimer = undefined;
  }

  function dispatch(query: string): void {
    cancelPending();
    if (onsearch === undefined) return;
    const ticket = (latestDispatch += 1);
    const outcome = onsearch(query);
    if (!(outcome instanceof Promise)) return;
    busy = true;
    void outcome.finally(() => {
      if (ticket === latestDispatch) busy = false;
    });
  }

  function queueDispatch(query: string): void {
    cancelPending();
    if (searchOn === "keystroke") {
      dispatch(query);
      return;
    }
    pauseTimer = setTimeout(() => dispatch(query), SEARCH_PAUSE_MILLISECONDS);
  }

  function handleInput(event: Event): void {
    value = (event.currentTarget as HTMLInputElement).value;
    queueDispatch(value);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // The screen behind this control may also answer Escape (a dialog, a menu); a search that is
    // clearing or closing has consumed the key.
    event.stopPropagation();
    if (value !== "") {
      value = "";
      // Clearing is not typing: the screen gets its rows back at once, with no pause to sit out.
      dispatch("");
      return;
    }
    collapse();
  }

  onDestroy(() => {
    cancelPending();
    if (settleTimer !== undefined) clearTimeout(settleTimer);
  });

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
      expand();
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
  data-busy={busy ? "true" : "false"}
  data-size={size}
  class={mergeClasses("mc-screen-search", className)}
  onfocusout={collapseWhenFocusSettlesElsewhere}
>
  <div class={mergeClasses("mc-screen-search-field", fieldClass)} hidden={!expanded}>
    <SearchIcon class="mc-screen-search-icon" aria-hidden="true" />
    {#if scope}
      <div class="mc-screen-search-scope">{@render scope()}</div>
    {/if}
    <input
      bind:this={inputRef}
      type="search"
      class="mc-screen-search-input w-full"
      aria-label={label}
      aria-busy={busy ? "true" : undefined}
      {value}
      {placeholder}
      {disabled}
      oninput={handleInput}
      onkeydown={handleKeyDown}
    />
    {#if matchSummary !== undefined && matchSummary !== ""}
      <span class="mc-screen-search-summary">{matchSummary}</span>
    {/if}
  </div>
  <button
    bind:this={triggerRef}
    type="button"
    class="mc-screen-search-trigger"
    aria-label={label}
    aria-expanded={expanded}
    {disabled}
    hidden={expanded}
    onclick={expand}
  >
    <SearchIcon class="mc-screen-search-icon" aria-hidden="true" />
  </button>
</div>

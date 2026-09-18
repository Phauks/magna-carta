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
   *   - it opens to the inline START into the field, which is for writing the query, and — where
   *     the surface fills the `panel` seam — DOWNWARD into that panel, which is for everything
   *     else: what the query reaches, and what it found;
   *   - it collapses again when left empty;
   *   - a live query keeps it open and takes a single accent hairline at the field's edge, so a
   *     narrowed list always carries its reason on screen;
   *   - a live query also carries an X at the field's trailing edge, which clears it and leaves the
   *     caret where it was. Escape still clears, and a second Escape collapses the control and
   *     hands focus back to the icon that opened it.
   *
   * TWO RULES HERE WERE REVERSED ON THE OWNER'S REVIEW (2026-09-02), and both had been deliberate:
   *
   *   1. There was no clear button, on the reasoning that Escape already clears. Escape is a
   *      keyboard affordance and nothing on screen advertises it, so a pointer user had no way to
   *      empty the field but to select the text and delete it. A glyph that says what it does beats
   *      a key that does not.
   *   2. A click on bare background did NOT collapse an empty field, because focus landing on the
   *      body was read as "focus went nowhere". To a person there is no such place: they clicked
   *      away, and the field should have closed. It now does — see the pointerdown watch below.
   *
   * The ruling is recorded in docs/conventions/design-corrections.md; this comment states the
   * reasoning so the next reader does not have to find it.
   *
   * THE FIELD READS "SEARCH", AND NOTHING MORE. Every screen used to hand in its own hint — "Search
   * the docket", "Search the firm's fees", "Search this matter's notes" — twenty-three spellings of
   * one word, and the owner struck them (2026-09-18: "it should just say 'Search'"). The control
   * sits in the screen's own header, so the screen is already named an inch to the left; the hint
   * was restating it. The placeholder is therefore not a prop: the one word is the component's, and
   * a screen names its surface only in `label`, which is the accessible name and never shows.
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
   *     STILL UNWIRED, and the matter search is the reason to be careful with it: that surface
   *     tried the seam and moved its scope OUT of the field, because a scope named in full took
   *     most of the field's width on a header line and because aiming a search is a different job
   *     from writing it. A screen whose scope is one short word may still want this.
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
  import XIcon from "@lucide/svelte/icons/x";
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
    /**
     * What Enter does, where the screen has somewhere to go with the whole query — a results page,
     * usually. Optional: a screen that narrows rows in place has no such destination, and Enter on
     * a field that already searched every keystroke should do nothing rather than something
     * invented. The pending debounce is flushed first, so the destination never opens on a query
     * one keystroke behind the field.
     */
    onsubmit?: (query: string) => void;
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
    /**
     * What the control opens DOWNWARD into, seated under the field and anchored to its trailing
     * edge: the surface's settings, its results, or both. Rendered INSIDE the control's own root,
     * which is the whole point — the collapse watches measure against that root, so reaching into
     * this panel is reaching into the control and does not close it. A panel rendered beside the
     * control instead collapses it on the first click, which is exactly the bug this replaced.
     */
    panel?: Snippet;
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
    onsearch,
    searchOn = "keystroke",
    onsubmit,
    busy = $bindable(false),
    size = "default",
    disabled = false,
    fieldClass = "w-3xs",
    class: className,
    scope,
    panel,
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
   * cannot, in whatever order the browser moves focus. One consequence worth stating: it is
   * measured against the WHOLE control, so reaching for the scope control (a sibling in the same
   * row) keeps the field open.
   *
   * This watch cannot see a click on bare background, and that is why the pointer watch below
   * exists rather than this one growing a case. Focus does not move when a person clicks a page's
   * empty margin — activeElement stays put or falls to the body — so there is no focus event to
   * read and no settled element that means "away". The click itself is the only evidence.
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

  /*
   * Collapse on a click that lands outside the control. This is the half the focus watch above
   * structurally cannot do: clicking a page's empty margin moves focus nowhere, so nothing fires
   * that says "away" — but the person plainly went away, and an empty field left open after it is
   * the defect the owner reported.
   *
   * pointerdown, not click: a click that starts inside the field and ends outside (a drag that
   * selects the query and overshoots) is not a way out, and pointerdown is where the two can still
   * be told apart. An EMPTY field only — a live query keeps the control open, which is the standing
   * rule that a narrowed list always carries its reason on screen, and the X is how you empty it.
   */
  $effect(() => {
    if (!expanded || searching) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && root?.contains(target) === true) return;
      expanded = false;
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  });

  /*
   * Clear, from the glyph rather than the key. The caret goes back into the field: a person who
   * cleared a search is nearly always about to type another one, and sending focus to the resting
   * icon instead would make them click twice to do it.
   */
  function clearQuery(): void {
    value = "";
    // Clearing is not typing: the screen gets its rows back at once, with no pause to sit out.
    dispatch("");
    inputRef?.focus();
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
    if (event.key === "Enter") {
      if (onsubmit === undefined) return;
      event.preventDefault();
      // The debounce is flushed rather than waited out: pressing Enter IS the person saying they
      // have finished typing, so the destination must not open on the query as it stood a
      // keystroke ago. cancelPending() alone would strand a "pause" screen with no search at all.
      dispatch(value);
      onsubmit(value);
      return;
    }
    if (event.key !== "Escape") return;
    // The screen behind this control may also answer Escape (a dialog, a menu); a search that is
    // clearing or closing has consumed the key.
    event.stopPropagation();
    if (value !== "") {
      clearQuery();
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
      placeholder="Search"
      {disabled}
      oninput={handleInput}
      onkeydown={handleKeyDown}
    />
    {#if matchSummary !== undefined && matchSummary !== ""}
      <span class="mc-screen-search-summary">{matchSummary}</span>
    {/if}
    {#if searching && !disabled}
      <!-- Only while there is something to clear: an X on an empty field is a control that does
           nothing, and it would sit in the row at rest pretending otherwise. -->
      <button
        type="button"
        class="mc-screen-search-clear"
        aria-label="Clear search"
        onclick={clearQuery}
      >
        <XIcon class="mc-screen-search-clear-icon" aria-hidden="true" />
      </button>
    {/if}
  </div>
  {#if panel && expanded}
    <!-- The panel shrink-wraps its content, so the surface sets its own width on what it renders
         here rather than through a prop this component would have to guess a default for. -->
    <div class="mc-screen-search-panel">{@render panel()}</div>
  {/if}
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

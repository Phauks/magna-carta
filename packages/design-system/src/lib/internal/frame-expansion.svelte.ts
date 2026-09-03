/*
 * The frame's expanded state — filling the viewport — owned once for both modal shells.
 *
 * The record window has always had this: a corner control that drops the frame's width cap so the
 * panel takes the screen, remembered for the browsing session so the next record opens the same
 * way. The action dialog had none, and the one panel in the app that wanted it rebuilt the whole
 * thing by hand — its own flag, the same two icons, the same three utilities — inside a raw dialog.
 * A capability that lives in one shell is a capability every other panel reinvents, so it lives
 * here, beneath both, and each shell keeps only its own control in its own header set.
 *
 * WHAT IS SHARED AND WHAT IS NOT. The state, the memory rule, the words on the control and the
 * geometry of an expanded frame are shared. The control itself stays in each shell's source,
 * because the header set is asserted at the source by tooling/lint-one-ui and a control that
 * arrived through a shared component would leave the set unreadable there.
 *
 * REMEMBERED PER SHELL, NEVER PERSISTED. A reader who wants records at full viewport wants every
 * record that way for the sitting; a reader who filled the screen with one form has said nothing
 * about the next question they are asked. So each shell has its own memory, module-scoped and
 * shared by every panel of that shell the session opens, and it is deliberately not stored: it is
 * a reading posture, not a preference the firm records, and a stored one would follow a reader
 * into a different day's work uninvited.
 *
 * A consumer that needs to own the state binds `expanded` on the shell instead; the shell then
 * follows the binding and the memory only records what the toggle did — which is also how a panel
 * OPENS expanded by design: the caller hands it `expanded` and the frame takes the screen at once.
 */

/** What a shell's memory holds: the one choice, for the session. */
export interface ExpansionMemory {
  expanded: boolean;
}

/** The record window's memory: every record window in the session shares it. */
export const recordWindowExpansion: ExpansionMemory = $state({ expanded: false });

/** The action dialog's memory: every expandable action dialog in the session shares it. */
export const actionDialogExpansion: ExpansionMemory = $state({ expanded: false });

/**
 * The utilities an expanded frame wears in place of its width cap. Utilities rather than a recipe,
 * for the reason recorded on the frame: the dialog panel underneath arrives wearing its own cap as
 * a utility, and only another utility can replace it. Filling the screen IS the gesture, so the
 * cap goes entirely.
 */
export const EXPANDED_FRAME_CLASSES = "h-screen w-screen max-w-none";

/** The two names the control answers to, one per state. What pressing it will do, not what it is. */
export const EXPAND_LABEL = "Fill the screen";
export const SHRINK_LABEL = "Shrink back to a window";

/**
 * A shell's expansion: what it reads, what pressing the control does, and what the frame wears.
 *
 * `bound` is the shell's own `expanded` prop — read and written through closures so the class
 * sees the prop's current value rather than a copy, and so a write reaches the caller's binding.
 * When the caller has not bound it, the shell's memory answers.
 */
export class FrameExpansion {
  readonly #memory: ExpansionMemory;
  readonly #bound: { read: () => boolean | undefined; write: (next: boolean) => void };

  constructor(
    memory: ExpansionMemory,
    bound: { read: () => boolean | undefined; write: (next: boolean) => void },
  ) {
    this.#memory = memory;
    this.#bound = bound;
  }

  /** Whether the frame fills the screen: the caller's binding where there is one, else the memory. */
  get expanded(): boolean {
    return this.#bound.read() ?? this.#memory.expanded;
  }

  /** What the control is called right now — what pressing it will do. */
  get label(): string {
    return this.expanded ? SHRINK_LABEL : EXPAND_LABEL;
  }

  /** Flip it, and record the choice for the session as well as for the caller. */
  toggle(): void {
    const next = !this.expanded;
    this.#memory.expanded = next;
    this.#bound.write(next);
  }

  /** The frame's sizing utilities: the expanded set, or the windowed set the shell hands over. */
  panelClasses(windowed: string): string {
    return this.expanded ? EXPANDED_FRAME_CLASSES : windowed;
  }
}

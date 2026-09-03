/*
 * The matter header's one create control, and how a section puts its own action behind it.
 *
 * THE LABEL IS THE REGISTRY'S; THE BEHAVIOUR IS THE PAGE'S. sections.ts says what each section
 * creates ("Fee", "File", nothing), so the control reads "New Fee" from the address alone and
 * holds that label and its fixed width whatever the page beneath it is doing. What PRESSING it does
 * is a fact only the section's page knows — the fee ledger opens its record window, the file
 * manager offers three ways something new lands — so the page CLAIMS the control for as long as
 * it is mounted, and lets it go when it is not. Between the two, the control is present, disabled,
 * and carries the reason.
 *
 * ONE CLAIM AT A TIME, AND ONLY FROM THE SECTION THE READER IS ON. A second component claiming
 * while a first still holds the control is refused with an error rather than quietly winning: two
 * claimants means two parts of one screen both believe they own the create action, which is
 * exactly the drift the control exists to end. Svelte tears the leaving page down before it mounts
 * the next, so ordinary navigation never trips this; only a genuine double claim does. The control
 * also refuses a claim whose section is not the one the address names, so a page cannot stand on
 * Costs and answer for Fees.
 *
 * WHY A CONTEXT AND NOT A MODULE SINGLETON. The slot belongs to one matter layout: constructed
 * there, handed down through context, and gone with it. A module-level store would outlive the
 * layout and carry a stale claim from one matter into the next.
 */
import { getContext, setContext, untrack } from "svelte";
import type { Component } from "svelte";

/** One item of a create control that offers a menu rather than one action. */
export interface MatterCreateChoice {
  /** What the item reads. Full phrase, title case: "New Folder", "Upload Files". */
  label: string;
  /** The Lucide glyph the item wears; every choice carries one so the menu reads as one set. */
  icon: Component;
  run: () => void;
  /** Present when the item cannot be pressed right now: it renders disabled carrying this line. */
  refusal?: string;
}

/** What a section's page puts behind the control: one action, or a menu of choices. */
export type MatterCreateDescription = {
  /** The tooltip on the control while it is pressable. */
  title: string;
  /**
   * Present when nothing can be created right now — a sample matter, a permission the reader
   * does not hold, a view with no destination. The control renders disabled carrying this line
   * instead of vanishing, so the header never changes shape.
   */
  refusal?: string;
} & (
  | { run: () => void; choices?: undefined }
  | { choices: readonly MatterCreateChoice[]; run?: undefined }
);

/** A description, bound to the section it answers for. */
export type MatterCreateClaim = MatterCreateDescription & {
  /** The section slug this claim answers for. The control refuses a claim for any other section. */
  section: string;
};

/**
 * The refusal every section states on a sample matter. One sentence in one place, so the control
 * says the same thing on every section rather than fourteen paraphrases of it.
 */
export const SAMPLE_MATTER_REFUSAL =
  "This is a sample matter. There is no firm record behind it, so nothing can be recorded against it.";

interface Holding {
  readonly owner: symbol;
  readonly claim: MatterCreateClaim;
}

/** The control's state: at most one claim, and who holds it. */
export class MatterCreateSlot {
  #holdings = $state.raw<readonly Holding[]>([]);

  /** The claim in force, or null while no section holds the control. */
  get held(): MatterCreateClaim | null {
    return this.#holdings[0]?.claim ?? null;
  }

  /** How many claimants hold the control. Anything above one is the defect the slot refuses. */
  get holderCount(): number {
    return this.#holdings.length;
  }

  /**
   * Put a claim behind the control. The same owner may claim again to replace what it said; a
   * different owner while one is held is refused.
   */
  claim(owner: symbol, claim: MatterCreateClaim): void {
    const rival = this.#holdings.find((holding) => holding.owner !== owner);
    if (rival !== undefined) {
      throw new Error(
        `The matter create control is already claimed for "${rival.claim.section}" and ` +
          `"${claim.section}" tried to claim it too. One section page claims the control, once; ` +
          "a second component on the screen that wants a create action goes through that page.",
      );
    }
    this.#holdings = [{ owner, claim }];
  }

  /** Let the control go. A release from an owner that does not hold it changes nothing. */
  release(owner: symbol): void {
    if (!this.#holdings.some((holding) => holding.owner === owner)) return;
    this.#holdings = this.#holdings.filter((holding) => holding.owner !== owner);
  }
}

const SLOT_KEY = Symbol("matter-create-slot");

/** Called once by the matter layout: constructs the slot and offers it to every page beneath. */
export function provideMatterCreateSlot(): MatterCreateSlot {
  const slot = new MatterCreateSlot();
  setContext(SLOT_KEY, slot);
  return slot;
}

/**
 * Called from a section page's script: puts the page's create action behind the header control
 * while the page is mounted. `describe` is read inside an effect, so a claim that depends on
 * state the page reads later — its permissions, a ledger's ref, the file manager's view — re-states
 * itself as that state settles; the control shows the reason meanwhile.
 */
export function claimMatterCreate(section: string, describe: () => MatterCreateDescription): void {
  const slot = getContext<MatterCreateSlot | undefined>(SLOT_KEY);
  if (slot === undefined) {
    throw new Error(
      `The "${section}" section claimed the create control outside the matter layout. The control ` +
        "exists only under /matters/[id], where the layout provides the slot.",
    );
  }
  const owner = Symbol(section);
  $effect(() => {
    // The page's own state is what this effect follows; the slot's holdings are not. Claiming
    // reads them (to refuse a rival) and then writes them, and an effect that depends on what it
    // writes re-runs itself without end.
    const claim: MatterCreateClaim = { ...describe(), section };
    untrack(() => {
      slot.claim(owner, claim);
    });
    return () => {
      slot.release(owner);
    };
  });
}

/*
 * A settings draft whose committed values live on the SERVER, for the settings pages that govern a
 * firm rather than a browser.
 *
 * The settings surface has one anatomy: a row renders a definition through a draft, the footer
 * counts what is staged and commits it, the masthead reads the same draft. That anatomy is typed on
 * `SettingsDraft`, whose committed values are per-browser local storage — right for a personal
 * preference, and wrong for firm policy: a firm setting with a server behind it must not keep a
 * per-browser copy that can disagree with the firm. This keeps the shape the rows and the footer
 * already understand and answers every question from the one read it made, so a page gets the whole
 * anatomy without a second implementation of it.
 *
 * IT IS GENERIC BECAUSE THE SECOND PAGE PROVED IT HAD TO BE. The calendar's week start was the
 * first server-backed setting and got a draft hardcoded to its one definition; the scan policy is
 * four settings, two of which live inside one nested object. A third bespoke draft would have been
 * three answers to the same question, so the field mapping moved into data a page declares and the
 * staging, counting, confirming and saving live here once.
 *
 * A SAVE THAT FAILS KEEPS THE STAGE. The member's choice is still on screen with the failure and
 * its Error ID beside it, and Save tries again under a fresh idempotency key; discarding it is the
 * member's call, never the failure's.
 *
 * NOTHING IS WRITTEN TO THE PER-BROWSER LEDGER. The local-storage drafts append a history entry on
 * save; for a firm setting that history would be one browser's recollection of a firm-wide fact,
 * silent about every change a colleague made. The record is the audit row the server writes with
 * the change.
 */
import type { ApiOutcome, Failure } from "$lib/api/request.ts";
import type { SettingDefinition, SettingValue } from "$lib/settings/settings-definitions.ts";
import { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";

/**
 * One setting on a server-backed page: how to read its value out of what the server said, and what
 * a staged value MEANS as a change to send.
 *
 * `applyTo` folds rather than returning a patch of its own, which is the part that earns its
 * keep: two settings can live inside one nested object on the wire (the scan tier and its score
 * floor both sit in `policy`), and two independently-built patches would overwrite each other on
 * merge. Folding into the accumulator lets each field see what the ones before it already wrote.
 */
export interface ServerBackedField<TSettings, TPatch> {
  readonly definition: SettingDefinition;
  /** The value in force, read off the settings the server returned. */
  valueOf(settings: TSettings): SettingValue;
  /**
   * The patch with this staged value folded into it, or null when the value is one the setting's
   * vocabulary does not carry — which is a control that has drifted from its definition, and is
   * dropped rather than sent.
   */
  applyTo(patch: TPatch, value: SettingValue, settings: TSettings): TPatch | null;
  /**
   * Why this staged value cannot be saved, said to the person who typed it, or undefined when it
   * can. Only a field somebody can type into needs one — a select cannot produce a value outside
   * its own options — and without it a value that folds to null would leave the footer counting a
   * change that Save then silently drops.
   */
  refusalFor?(value: SettingValue): string | undefined;
}

export interface ServerBackedDraftOptions<TSettings, TPatch> {
  /** The settings section this draft belongs to (settings-sections.ts). */
  readonly sectionId: string;
  readonly fields: readonly ServerBackedField<TSettings, TPatch>[];
  readonly read: () => Promise<ApiOutcome<TSettings>>;
  /** The write. The idempotency key is minted per attempt, so a retry is a new attempt. */
  readonly write: (patch: TPatch, idempotencyKey: string) => Promise<ApiOutcome<TSettings>>;
  /** Called with what the server said after a save landed — for a page that has to tell somebody. */
  readonly onSaved?: (settings: TSettings) => void;
}

export class ServerBackedSettingsDraft<TSettings, TPatch extends object> extends SettingsDraft {
  /** What the server said the firm's settings are; null until the read lands. */
  committed = $state<TSettings | null>(null);
  readFailure = $state<Failure | null>(null);
  saving = $state(false);
  saveFailure = $state<Failure | null>(null);

  #staged: Record<string, SettingValue> = $state({});
  readonly #options: ServerBackedDraftOptions<TSettings, TPatch>;

  constructor(options: ServerBackedDraftOptions<TSettings, TPatch>) {
    super(options.sectionId);
    this.#options = options;
  }

  /** Whether the read has answered with a value. A page renders its rows only once it has. */
  get loaded(): boolean {
    return this.committed !== null;
  }

  /** Every definition this page renders, in declared order — what a page maps its rows from. */
  get definitions(): readonly SettingDefinition[] {
    return this.#options.fields.map((field) => field.definition);
  }

  async load(): Promise<void> {
    const outcome = await this.#options.read();
    if (outcome.kind === "ok") {
      this.committed = outcome.value;
      this.readFailure = null;
      return;
    }
    this.readFailure = outcome.failure;
  }

  #fieldFor(definition: SettingDefinition): ServerBackedField<TSettings, TPatch> | undefined {
    return this.#options.fields.find((field) => field.definition.id === definition.id);
  }

  override value(definition: SettingDefinition): SettingValue {
    const field = this.#fieldFor(definition);
    // Before the read lands there is no committed value to state, and the definition's own default
    // is the honest stand-in: it is what a firm that has never set this reads back anyway.
    if (field === undefined || this.committed === null) return definition.defaultValue;
    return field.valueOf(this.committed);
  }

  override stagedValue(definition: SettingDefinition): SettingValue {
    const staged = this.#staged[definition.id];
    return staged === undefined ? this.value(definition) : staged;
  }

  override stage(definition: SettingDefinition, next: SettingValue): void {
    if (this.#fieldFor(definition) === undefined) return;
    // Staging the committed value back is an un-stage: a change undone before saving is no change.
    if (next === this.value(definition)) {
      delete this.#staged[definition.id];
      return;
    }
    this.#staged[definition.id] = next;
  }

  override isStaged(definition: SettingDefinition): boolean {
    return definition.id in this.#staged;
  }

  override get stagedCount(): number {
    return Object.keys(this.#staged).length;
  }

  override get stagedEntries(): ReadonlyArray<{
    definition: SettingDefinition;
    from: SettingValue;
    to: SettingValue;
  }> {
    // Declared order, not staging order: the recap reads down the page the member was looking at.
    return this.#options.fields
      .filter((field) => field.definition.id in this.#staged)
      .map((field) => ({
        definition: field.definition,
        from: this.value(field.definition),
        to: this.#staged[field.definition.id] as SettingValue,
      }));
  }

  /**
   * The first staged value that cannot be saved, and why. The footer reads this to refuse the
   * save where the button is, rather than letting a press do nothing.
   */
  override get saveRefusal(): string | undefined {
    for (const field of this.#options.fields) {
      const staged = this.#staged[field.definition.id];
      if (staged === undefined) continue;
      const refusal = field.refusalFor?.(staged);
      if (refusal !== undefined) return refusal;
    }
    return undefined;
  }

  override discard(): void {
    this.#staged = {};
    this.saveFailure = null;
  }

  /**
   * The footer calls this without awaiting it, as it does every draft's save; the outcome lands on
   * `saving` and `saveFailure`, which the page renders. `commit()` is the awaitable form.
   */
  override save(): void {
    void this.commit();
  }

  async commit(): Promise<void> {
    const settings = this.committed;
    if (settings === null || this.saving || this.stagedCount === 0) return;

    let patch = {} as TPatch;
    for (const field of this.#options.fields) {
      const staged = this.#staged[field.definition.id];
      if (staged === undefined) continue;
      const folded = field.applyTo(patch, staged, settings);
      // A value the vocabulary does not carry is dropped rather than sent: the alternative is
      // asking the server to store something the page could not have meant.
      if (folded !== null) patch = folded;
    }
    if (Object.keys(patch).length === 0) return;

    this.saving = true;
    this.saveFailure = null;
    // One key per attempt: a retry after a failure is a new attempt, and a duplicate of a landed
    // one is what the key on the server catches.
    const outcome = await this.#options.write(patch, crypto.randomUUID());
    this.saving = false;
    if (outcome.kind !== "ok") {
      this.saveFailure = outcome.failure;
      return;
    }
    this.committed = outcome.value;
    this.#staged = {};
    this.#options.onSaved?.(outcome.value);
  }
}

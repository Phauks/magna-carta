/*
 * Committed setting values + the per-page draft.
 *
 * Committed values are the values in force: localStorage-backed today (one key per setting id),
 * swapping to the firm settings backend when firm accounts arrive. Like developer-preferences,
 * these are per-browser state for now, so every storage hazard (private mode, quota, corrupt
 * payloads) is swallowed and the definition's default wins.
 *
 * SettingsDraft is the draft-mode page's staging area: edits stage locally, nothing lands until
 * save() commits the whole batch and writes it to the section's ledger
 * (settings-ledger-store.svelte.ts) in the same call — a saved change and its history entry
 * never diverge.
 */

import type { SettingDefinition, SettingValue } from "./settings-definitions.ts";
import { SETTING_DEFINITIONS, settingValueLabel } from "./settings-definitions.ts";
import { appendSettingsLedgerEntries } from "./settings-ledger-store.svelte.ts";

const STORAGE_KEY_PREFIX = "mc-setting-";

function storageKeyForSetting(settingId: string): string {
  return `${STORAGE_KEY_PREFIX}${settingId}`;
}

/*
 * Normalization on read: a stored value the definition cannot represent — an option removed in
 * a later build, a kind change, a hand-edited payload — must not render an impossible state
 * (a select showing a choice that is not in its list). The default wins over anything the
 * definition does not recognize.
 */
function normalizeValue(definition: SettingDefinition, candidate: unknown): SettingValue {
  switch (definition.kind) {
    case "switch":
      return typeof candidate === "boolean" ? candidate : definition.defaultValue;
    case "text":
      return typeof candidate === "string" ? candidate : definition.defaultValue;
    case "select":
      return typeof candidate === "string" &&
        definition.options?.some((option) => option.value === candidate)
        ? candidate
        : definition.defaultValue;
  }
}

function readStoredValue(definition: SettingDefinition): SettingValue {
  // The app is an SPA, but module init must not assume a browser (tests, prerender safety).
  if (typeof localStorage === "undefined") return definition.defaultValue;
  try {
    const raw = localStorage.getItem(storageKeyForSetting(definition.id));
    if (raw === null) return definition.defaultValue;
    return normalizeValue(definition, JSON.parse(raw));
  } catch {
    return definition.defaultValue;
  }
}

function persistValue(definition: SettingDefinition, value: SettingValue): void {
  if (typeof localStorage === "undefined") return;
  try {
    // JSON round-trip so booleans survive storage (localStorage only holds strings).
    localStorage.setItem(storageKeyForSetting(definition.id), JSON.stringify(value));
  } catch {
    // Storage unavailable; the live value still works for the session.
  }
}

function readAllCommittedValues(): Record<string, SettingValue> {
  const values: Record<string, SettingValue> = {};
  for (const definition of SETTING_DEFINITIONS) {
    values[definition.id] = readStoredValue(definition);
  }
  return values;
}

// Loaded once at module init (the definitions registry is the key space), then kept current by
// save() and the storage listener below — reads never mutate the cache, so
// committedSettingValue stays safe to call from inside a derived computation.
const committedValues = $state<Record<string, SettingValue>>(readAllCommittedValues());

/*
 * CROSS-TAB FOLLOW. "storage" fires in every OTHER same-origin tab when a key changes, so a
 * save in one tab restyles the same page in another. Last write wins; the re-read goes through
 * readStoredValue so the receiving tab re-normalizes the payload. Registered once at module
 * scope (one module instance per app), guarded so the module stays importable during SSR/tests
 * where `window` does not exist. `event.key === null` means `storage.clear()` — every setting's
 * key may have changed, so re-read them all.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === null) {
      for (const definition of SETTING_DEFINITIONS) {
        committedValues[definition.id] = readStoredValue(definition);
      }
      return;
    }
    if (!event.key.startsWith(STORAGE_KEY_PREFIX)) return;
    const settingId = event.key.slice(STORAGE_KEY_PREFIX.length);
    const definition = SETTING_DEFINITIONS.find((candidate) => candidate.id === settingId);
    if (definition === undefined) return;
    committedValues[definition.id] = readStoredValue(definition);
  });
}

/** The value in force for a setting; falls back to the definition's default. Reactive. */
export function committedSettingValue(definition: SettingDefinition): SettingValue {
  return committedValues[definition.id] ?? definition.defaultValue;
}

/**
 * One draft per draft-mode page visit. Edits stage in memory; save() commits the batch to
 * storage and the section ledger together; discard() (or navigating away — the instance is
 * page-local) drops it without a trace.
 */
export class SettingsDraft {
  readonly #sectionId: string;
  #staged: Record<string, SettingValue> = $state({});

  constructor(sectionId: string) {
    this.#sectionId = sectionId;
  }

  /** The committed value, untouched by staging — what the page's "current" column shows. */
  value(definition: SettingDefinition): SettingValue {
    return committedSettingValue(definition);
  }

  /** The staged value if present, else the committed value — what the control renders. */
  stagedValue(definition: SettingDefinition): SettingValue {
    const staged = this.#staged[definition.id];
    return staged === undefined ? committedSettingValue(definition) : staged;
  }

  stage(definition: SettingDefinition, next: SettingValue): void {
    // Staging the committed value back is an un-stage: a change undone before saving is no
    // change at all, so it neither counts toward stagedCount nor lands in the ledger.
    if (next === committedSettingValue(definition)) {
      delete this.#staged[definition.id];
      return;
    }
    this.#staged[definition.id] = next;
  }

  isStaged(definition: SettingDefinition): boolean {
    return definition.id in this.#staged;
  }

  get stagedCount(): number {
    return Object.keys(this.#staged).length;
  }

  get stagedEntries(): ReadonlyArray<{
    definition: SettingDefinition;
    from: SettingValue;
    to: SettingValue;
  }> {
    return SETTING_DEFINITIONS.filter(
      (definition) => definition.sectionId === this.#sectionId && definition.id in this.#staged,
    ).map((definition) => ({
      definition,
      from: committedSettingValue(definition),
      to: this.#staged[definition.id] as SettingValue,
    }));
  }

  /** True when any staged definition is marked consequential (confirm: true). */
  get requiresConfirm(): boolean {
    return this.stagedEntries.some((entry) => entry.definition.confirm === true);
  }

  /**
   * Why this draft cannot be saved as it stands, or undefined when it can.
   *
   * Always undefined here: a local-storage draft takes whatever its controls produce, and a
   * select or a switch cannot produce a value its definition does not carry. It exists on the
   * base because the FOOTER is shared — a draft that knows a staged value will not land has to
   * be able to say so where the Save button is, rather than letting somebody press a button that
   * silently does nothing. The server-backed draft is the one that answers it today, for the
   * settings a person can type a number into.
   */
  get saveRefusal(): string | undefined {
    return undefined;
  }

  discard(): void {
    this.#staged = {};
  }

  /**
   * Commit every staged value to storage and append the batch to the section's ledger, then
   * clear the stage. The ledger entries capture the labels of the old and new values before
   * the commit, so history reads in the vocabulary the user saw.
   */
  save(): void {
    const entries = this.stagedEntries;
    if (entries.length === 0) return;
    for (const entry of entries) {
      committedValues[entry.definition.id] = entry.to;
      persistValue(entry.definition, entry.to);
    }
    appendSettingsLedgerEntries(
      this.#sectionId,
      entries.map((entry) => ({
        settingId: entry.definition.id,
        label: entry.definition.label,
        from: settingValueLabel(entry.definition, entry.from),
        to: settingValueLabel(entry.definition, entry.to),
      })),
    );
    this.#staged = {};
  }
}

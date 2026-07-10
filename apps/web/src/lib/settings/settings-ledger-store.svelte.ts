/*
 * The append-only settings ledger — the change history a settings page shows beneath its
 * controls. Ledger semantics, the same discipline as the trust ledger: corrections are new
 * entries, history is never rewritten. There is no edit and no delete on purpose.
 *
 * Session/device-backed via localStorage today (one key per section); firm pages swap to the
 * firm audit trail when the backend lands — the read shape here is the shape that trail will
 * serve. The values are per-browser display history, not application data, so every storage
 * hazard (private mode, quota, corrupt payloads) is swallowed and an empty ledger wins.
 *
 * Stored entries are capped per section (newest kept, oldest dropped): this surface is a
 * recent-changes list, not the system of record, and localStorage shares one small origin-wide
 * quota with every other key — an unbounded ledger would eventually evict real preferences.
 */

import { SETTINGS_SECTIONS } from "./settings-sections.ts";

const STORAGE_KEY_PREFIX = "mc-settings-ledger-";
const MAX_ENTRIES_PER_SECTION = 200;

export interface SettingsLedgerEntry {
  /** crypto.randomUUID() at write time. */
  readonly id: string;
  readonly settingId: string;
  /** The definition label at write time — a later rename must not rewrite history. */
  readonly label: string;
  /** settingValueLabel of the old value. */
  readonly from: string;
  /** settingValueLabel of the new value. */
  readonly to: string;
  /** ISO timestamp. */
  readonly at: string;
}

function storageKeyForSection(sectionId: string): string {
  return `${STORAGE_KEY_PREFIX}${sectionId}`;
}

function isSettingsLedgerEntry(candidate: unknown): candidate is SettingsLedgerEntry {
  if (typeof candidate !== "object" || candidate === null) return false;
  const entry = candidate as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.settingId === "string" &&
    typeof entry.label === "string" &&
    typeof entry.from === "string" &&
    typeof entry.to === "string" &&
    typeof entry.at === "string"
  );
}

function readStoredEntries(sectionId: string): SettingsLedgerEntry[] {
  // The app is an SPA, but module init must not assume a browser (tests, prerender safety).
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKeyForSection(sectionId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalized on read: a malformed row (hand-edited, or persisted by an older build) is
    // dropped rather than allowed to break the whole section's history.
    return parsed.filter(isSettingsLedgerEntry).slice(0, MAX_ENTRIES_PER_SECTION);
  } catch {
    return [];
  }
}

function persist(sectionId: string, entries: readonly SettingsLedgerEntry[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKeyForSection(sectionId), JSON.stringify(entries));
  } catch {
    // Storage unavailable; the in-memory ledger still works for the session.
  }
}

function readAllSections(): Record<string, SettingsLedgerEntry[]> {
  const entriesBySection: Record<string, SettingsLedgerEntry[]> = {};
  for (const section of SETTINGS_SECTIONS) {
    entriesBySection[section.id] = readStoredEntries(section.id);
  }
  return entriesBySection;
}

// Loaded once per section at module init (the section registry is the key space), then kept
// current by appends here and by the storage listener below — reads never mutate the cache, so
// ledgerEntriesForSection stays safe to call from inside a derived computation.
const entriesBySection = $state<Record<string, SettingsLedgerEntry[]>>(readAllSections());

/*
 * CROSS-TAB FOLLOW. "storage" fires in every OTHER same-origin tab when a key changes, so
 * re-reading here makes a save in one tab land in all of them. Last write wins; the re-read
 * goes through readStoredEntries so the receiving tab re-normalizes the payload. Registered
 * once at module scope (one module instance per app), guarded so the module stays importable
 * during SSR/tests where `window` does not exist. `event.key === null` means `storage.clear()`
 * — every section's key may have changed, so re-read them all.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === null) {
      for (const section of SETTINGS_SECTIONS) {
        entriesBySection[section.id] = readStoredEntries(section.id);
      }
      return;
    }
    if (!event.key.startsWith(STORAGE_KEY_PREFIX)) return;
    const sectionId = event.key.slice(STORAGE_KEY_PREFIX.length);
    entriesBySection[sectionId] = readStoredEntries(sectionId);
  });
}

/** The section's ledger, newest first. Reactive — appends and cross-tab writes re-render. */
export function ledgerEntriesForSection(sectionId: string): readonly SettingsLedgerEntry[] {
  return entriesBySection[sectionId] ?? [];
}

/**
 * Append entries to a section's ledger (one save = one batch, sharing a timestamp). Append is
 * the only write this store offers — a correction is a new entry, never a rewrite.
 */
export function appendSettingsLedgerEntries(
  sectionId: string,
  entries: readonly Omit<SettingsLedgerEntry, "id" | "at">[],
): void {
  if (entries.length === 0) return;
  const at = new Date().toISOString();
  const stamped = entries.map((entry) => ({ ...entry, id: crypto.randomUUID(), at }));
  const next = [...stamped, ...(entriesBySection[sectionId] ?? [])].slice(
    0,
    MAX_ENTRIES_PER_SECTION,
  );
  entriesBySection[sectionId] = next;
  persist(sectionId, next);
}

import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { lookupDictionaryEntry } from "./dictionary.ts";
import {
  selectLocationForMergeStatement,
  selectMatterForMergeStatement,
  selectMatterPartiesForMergeStatement,
  toLocationMergeRow,
  toMatterMergeRow,
  toMatterPartyMergeRow,
  type LocationMergeColumns,
  type LocationMergeRow,
  type MatterMergeColumns,
  type MatterMergeRow,
  type MatterPartyMergeColumns,
} from "./merge-statements.ts";
import {
  manifestKeys,
  type FieldManifest,
  type MergeContext,
  type MergeListItem,
  type MergeSource,
  type MergeValue,
} from "./types.ts";

// THE HARD RULE OF THIS MODULE: a merge field never issues a query.
//
// Resolution reads AT MOST ONCE PER SOURCE — one matter read, one location read — regardless of how many
// placeholders a template has. A template with 140 fields costs the same number of reads as one with
// four. This is stated as a rule and asserted by test rather than left to care, because the natural
// implementation of a merge engine is a per-field resolver, and that is an N+1 generator pointed
// straight at a document with a hundred merge fields.
//
// The manifest is what makes the batching possible: normalization already recorded exactly which keys a
// template version uses, so the reads are PLANNED before any value is touched.

// The dictionary version the resolver was built against, recorded on the provenance row beside the
// engine version so a document assembled today stays explicable after the dictionary grows.
export const DICTIONARY_VERSION = 1;

// The time zone a document's dates render in. The design's rule is the MATTER'S OFFICE'S zone, never the
// server's and never the acting member's, so a filing date is the date it was in the office that filed
// it. The Locations model carries no time-zone column yet, so every office resolves to the platform's
// normalized zone today; this function is the one place that column plugs in when Locations gains it,
// rather than a default scattered through the formatters.
export function timeZoneForLocation(_location: LocationMergeRow | undefined): string {
  return "UTC";
}

export interface ResolutionInput {
  readonly matterId: MatterId;
  readonly manifest: FieldManifest;
  // The firm's own display name, resolved once by the caller from the firm record. It is not a per-firm
  // database fact, so it arrives as an input rather than as a read this module issues.
  readonly firmName: string;
  // The instant the assembly ran, supplied rather than read from the clock so an assembly is
  // reproducible and a test does not have to freeze time globally.
  readonly assembledAt: string;
}

export type ResolutionFailureReason = "matter-not-found";

export type ResolutionResult =
  | { readonly ok: true; readonly context: MergeContext; readonly reads: readonly MergeSource[] }
  | { readonly ok: false; readonly reason: ResolutionFailureReason; readonly detail: string };

// The sources a manifest actually needs. A template that names no location field never reads a location.
//
// The keys come from EVERY site the manifest records — plain placeholders, block conditions, and
// computed fields alike. That is what keeps the batching rule true once a condition can read anything
// the dictionary has: an expression must never be the reason a read happens late.
function sourcesFor(manifest: FieldManifest): Set<MergeSource> {
  const sources = new Set<MergeSource>();
  for (const key of manifestKeys(manifest)) {
    const entry = lookupDictionaryEntry(key);
    if (entry !== undefined) sources.add(entry.source);
  }
  return sources;
}

// Whether the manifest asks for a particular key anywhere. A collection is read only when something
// walks it — a repeat is a read, and a template with no repeat pays for none.
function manifestWants(manifest: FieldManifest, key: string): boolean {
  return manifestKeys(manifest).includes(key);
}

function textValue(text: string | null): MergeValue | undefined {
  return text === null || text === "" ? undefined : { kind: "text", text };
}

function instantValue(isoInstant: string | null): MergeValue | undefined {
  return isoInstant === null || isoInstant === "" ? undefined : { kind: "instant", isoInstant };
}

// The matter row supplies both the `matter` source and the slice-1 `party` source: a matter records its
// client's display name and code directly, so the client party costs no second read. Directory role links
// (`opposing.*`, `counsel.*`, and the rest) arrive in slice 2·6·2 as one further batched read over the
// matter's party links — one read for every role the manifest mentions, never one per role.
function valuesFromMatter(matter: MatterMergeRow, into: Map<string, MergeValue>): void {
  const set = (key: string, value: MergeValue | undefined): void => {
    if (value !== undefined) into.set(key, value);
  };
  set("matter.number", textValue(matter.matterNumber));
  set("matter.title", textValue(matter.title));
  set("matter.description", textValue(matter.description));
  set("matter.status", textValue(matter.status));
  set("matter.openedOn", instantValue(matter.openedAt));
  set("matter.eBilling", { kind: "boolean", value: matter.eBilling !== 0 });
  set("client.displayName", textValue(matter.clientDisplayName));
  set("client.code", textValue(matter.clientCode));
}

function valuesFromLocation(location: LocationMergeRow, into: Map<string, MergeValue>): void {
  const set = (key: string, value: MergeValue | undefined): void => {
    if (value !== undefined) into.set(key, value);
  };
  set("location.name", textValue(location.name));
  set("location.jurisdiction", textValue(location.jurisdiction));
  set("location.addressBlock", textValue(location.addressBlock));
  set("location.footer", textValue(location.footer));
  set("location.remitTo", textValue(location.remitTo));
}

export async function resolveMergeContext(
  database: SqlDatabase,
  input: ResolutionInput,
): Promise<ResolutionResult> {
  const sources = sourcesFor(input.manifest);
  const values = new Map<string, MergeValue>();
  const reads: MergeSource[] = [];

  // The location is the matter's, so a manifest that names a location field needs the matter row too —
  // one read, shared, not one per dependent source.
  const needsMatterRow = sources.has("matter") || sources.has("party") || sources.has("location");

  let matter: MatterMergeRow | undefined;
  if (needsMatterRow) {
    reads.push("matter");
    const { results } = await selectMatterForMergeStatement(
      database,
      input.matterId,
    ).all<MatterMergeColumns>();
    const row = results[0];
    if (row === undefined) {
      return { ok: false, reason: "matter-not-found", detail: `no such matter: ${input.matterId}` };
    }
    matter = toMatterMergeRow(row);
    valuesFromMatter(matter, values);
  }

  // The matter's parties: ONE read for the whole collection, never one per item. Repeats are the first
  // list-valued source, so this is where the batching rule meets its first real test.
  if (manifestWants(input.manifest, "matter.parties")) {
    reads.push("party");
    const { results } = await selectMatterPartiesForMergeStatement(
      database,
      input.matterId,
    ).all<MatterPartyMergeColumns>();
    const items: MergeListItem[] = results.map((row) => {
      const party = toMatterPartyMergeRow(row);
      const fields = new Map<string, MergeValue>([
        ["role", { kind: "text", text: party.role }],
        ["kind", { kind: "text", text: party.kind }],
      ]);
      const displayName = textValue(party.displayName);
      if (displayName !== undefined) fields.set("displayName", displayName);
      return { fields };
    });
    values.set("matter.parties", { kind: "list", items });
  }

  let location: LocationMergeRow | undefined;
  if (sources.has("location") && matter?.locationId != null) {
    reads.push("location");
    const { results } = await selectLocationForMergeStatement(
      database,
      matter.locationId,
    ).all<LocationMergeColumns>();
    const row = results[0];
    if (row !== undefined) {
      location = toLocationMergeRow(row);
      valuesFromLocation(location, values);
    }
  }

  if (sources.has("firm")) {
    const firmName = textValue(input.firmName);
    if (firmName !== undefined) values.set("firm.name", firmName);
  }

  const timeZone = timeZoneForLocation(location);

  if (sources.has("system")) {
    values.set("system.today", { kind: "instant", isoInstant: input.assembledAt });
  }

  // Absence is computed against what the MANIFEST asked for, not against the dictionary as a whole: a
  // key a template never uses is not missing from that template's assembly.
  const absentKeys = manifestKeys(input.manifest).filter((key) => !values.has(key));

  return { ok: true, context: { values, absentKeys, timeZone }, reads };
}

import type { RecordCustodianId } from "@magna-carta/identifiers/types";
import { DISCOVERY_LOAD_LANES, UNBUILT_LOAD_LANES, type DiscoveryLoadLane } from "./types.ts";
import { DiscoveryValidationError } from "./validation.ts";

// THE LOAD-SOURCE CONTRACT: what a person is declaring when they say "put this material into this
// review set". A load is declared BEFORE the material arrives, which is what makes the manifest's
// declared-versus-actual reconciliation possible and what makes a load resumable across a dropped
// connection.
//
// The contract's job is to make every choice that shapes the corpus VISIBLE at declaration, because
// the corpus is what a court is later told about. A source that could be swept in silently is a
// source a firm cannot honestly describe.

// ---------------------------------------------------------------------------------------------
// The transcript control
//
// Assistant transcripts are the firm's own WORK PRODUCT — protected, deletable, archivable, and
// discoverable in the way email is. They are also a corpus of the firm's own reasoning about a
// matter, and the difference between "we searched the client's records" and "we searched the client's
// records and our own notes about them" is one a person has to make deliberately, not one a default
// makes for them.
//
// So the control is REQUIRED and has NO DEFAULT. A declaration that does not state a transcript scope
// is refused; there is no value the platform supplies on the declarer's behalf, in either direction,
// because a silent exclusion is as much a decision made for somebody as a silent inclusion — it just
// fails in the other direction, and a firm that believed transcripts were in scope would find out
// after producing.
//
// The scope is recorded on the load itself, so the manifest can state what the corpus was drawn from
// rather than only what arrived.
export const TRANSCRIPT_SCOPES = ["exclude", "include"] as const;
export type TranscriptScope = (typeof TRANSCRIPT_SCOPES)[number];

// Which lanes could ever reach a transcript. A transcript is a record in the firm's own database, so
// only the internal lanes could sweep one; a production received from another party is that party's
// material by construction, and material collected from a client's system is the client's. The
// control is nonetheless carried on EVERY lane's declaration, because a load record that sometimes
// carries the scope and sometimes does not is a record whose silence means two different things.
export const TRANSCRIPT_REACHING_LANES: readonly DiscoveryLoadLane[] = [
  "internal-files",
  "internal-email",
];

export function laneCanReachTranscripts(lane: DiscoveryLoadLane): boolean {
  return TRANSCRIPT_REACHING_LANES.includes(lane);
}

// ---------------------------------------------------------------------------------------------
// The declaration

export interface LoadSourceDeclaration {
  readonly lane: DiscoveryLoadLane;
  // Required, no default. See the transcript control above.
  readonly transcriptScope: TranscriptScope;
  // What the loader claims is coming. The manifest reconciles it against what actually committed; a
  // mismatch is reported rather than corrected.
  readonly declaredDocumentCount: number;
  // Where this came from, in the loader's own words — the production letter's reference, the drive's
  // label, the mailbox's owner. Free text, because provenance is not a vocabulary.
  readonly sourceDescription: string | null;
  // The record custodian everything in this load is attributed to, when one load carries one
  // person's material. Null means attribution is per document, which is the ordinary case for a
  // production carrying several record custodians' records.
  readonly defaultRecordCustodianId: RecordCustodianId | null;
}

// Every way a declaration can be refused, as a code the route maps to a problem type. Refusals are BY
// NAME: a firm told "invalid request" learns nothing, and every one of these has a different fix.
export function validateLoadSourceDeclaration(declaration: LoadSourceDeclaration): void {
  if (!DISCOVERY_LOAD_LANES.includes(declaration.lane)) {
    throw new DiscoveryValidationError(
      "discovery-unknown-load-lane",
      `Unknown load lane ${JSON.stringify(declaration.lane)}.`,
    );
  }
  if (UNBUILT_LOAD_LANES.includes(declaration.lane)) {
    throw new DiscoveryValidationError(
      "discovery-load-lane-not-built",
      `Loads in the ${declaration.lane} lane are not built yet — collecting from a client's own ` +
        `system needs a collection tool, not an ingest path. Collect to a drive and load it as a ` +
        `received production, or load the firm's own copies from the matter.`,
    );
  }
  // The transcript control, enforced structurally. The type system already demands the field; this is
  // the runtime half, for a declaration arriving over the wire.
  if (!TRANSCRIPT_SCOPES.includes(declaration.transcriptScope)) {
    throw new DiscoveryValidationError(
      "discovery-transcript-scope-unstated",
      `Every load states whether assistant transcripts are in scope: "include" or "exclude". ` +
        `There is no default — transcripts are the firm's own work product, and whether they belong ` +
        `in a corpus is a decision a person makes, not one the platform makes for them.`,
    );
  }
  if (declaration.transcriptScope === "include") {
    // Accepted into the vocabulary, refused in the resolution, and refused BY NAME — the same device
    // the unbuilt lane uses. The alternative is worse in both directions: silently dropping an
    // "include" would produce a corpus that does not match what the loader declared, and pretending
    // to honour it would produce a manifest that claims a sweep that did not happen. The transcript
    // lane arrives with the review slice that gives a reviewer somewhere to read one.
    throw new DiscoveryValidationError(
      "discovery-transcript-lane-not-built",
      `Assistant transcripts cannot be loaded into a review set yet — the lane that resolves them ` +
        `arrives with the review surface. Declare the load with transcripts excluded, and load ` +
        `them in a later, separate load so the record says when they entered and who decided it.`,
    );
  }
  if (
    !Number.isInteger(declaration.declaredDocumentCount) ||
    declaration.declaredDocumentCount < 0
  ) {
    throw new DiscoveryValidationError(
      "discovery-invalid-declared-count",
      "The declared document count is a whole number of documents, zero or more.",
    );
  }
}

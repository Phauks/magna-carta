import { directoryIdentifierValue } from "@magna-carta/data-access/protected-field-registry";
import {
  readProtected,
  type ProtectedReadContext,
} from "@magna-carta/data-access/protected-fields";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import {
  findByIdentifier,
  type DirectoryIdentifierContext,
} from "@magna-carta/directory/identifiers";
import { findDuplicateCandidates } from "@magna-carta/directory/search";
import type { FirmId } from "@magna-carta/identifiers/types";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { createProfileFirmKeyProvider } from "./protected-generate.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The directory volume-shaped measured set: the conflicts exact-identifier blind-index lookup, an
// audited decrypt of a page of sealed SSN values, the duplicate-candidate generation (three blocking
// channels — phonetic, trigram FTS5, blind-index — unioned), and the related-party graph expansion
// (inbound + outbound edges). Each rides the REAL domain path (findByIdentifier / readProtected /
// findDuplicateCandidates / the edge expansion SQL), so the blind-index HMAC, the AES-GCM decrypt +
// per-read decrypt-audit write, the FTS5/phonetic joins, and the two-index OR union are all on the
// clock. The cost of these depends on the data SHAPE the directory generator laid down — a corpus with
// name history, a graph with a busy node, and a page of indexed identifiers.

// The read context every directory operation runs under: viewSensitiveIdentifiers permission (the
// blind-index lookup needs none, but the protected-list decrypt does), the seed-derived firm key, and
// the per-firm database for the decrypt-audit writes.
export interface DirectoryMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly context: FixtureContext;
  readonly identifierContext: DirectoryIdentifierContext;
  // The person whose identifiers + edges the measured reads target.
  readonly probePersonId: string;
  // The plaintext SSN-shaped value the blind-index probe + candidate generation match against — the
  // exact value the generator sealed for the probe person, so the lookup hits.
  readonly sampleIdentifierValue: string;
  readonly probeGivenName: string;
  readonly probeFamilyName: string;
  // A page of sealed identifiers to decrypt, prefetched once (the ciphertext is what a caller already
  // holds from its own row read — the measured cost is the decrypt + audit, not the fetch).
  readonly sampleEntityCiphertexts: readonly { readonly id: string; readonly ciphertext: string }[];
}

// How many identifier rows the read-protected-list op decrypts per iteration.
const PROTECTED_LIST_PAGE_LIMIT = 50;

// The read side derives its audit-row ids + clock from its OWN `${seed}:directory-measure` stream —
// disjoint from the seeded data and from the ledger/matters `${seed}:measure` and the protected
// `${seed}:protected-measure` streams, since the decrypt-audit writes share the audit_log table. The
// firm KEY still comes from the base seed — the same key that sealed the cached identifier ciphertexts,
// so they decrypt on replay.
export async function directoryMeasurementHandle(
  snapshot: LoadedSnapshot,
  seed: string,
): Promise<DirectoryMeasurementHandle> {
  const context = fixtureContext(`${seed}:directory-measure`);
  const { directoryProbes } = snapshot.manifest;
  const firmKeyProvider = await createProfileFirmKeyProvider(snapshot.manifest.seed);
  const readContext: ProtectedReadContext = {
    firmId: directoryProbes.firmId as FirmId,
    firmKeyVersion: directoryProbes.firmKeyVersion,
    firmKeyProvider,
    database: snapshot.database,
    effectivePermissions: new Set([directoryIdentifierValue.permission]),
    actorUserId: null,
    clock: context.clock,
    randomSource: context.randomSource,
  };

  // Prefetch a page of sealed SSN rows (id + ciphertext) the read-protected-list op decrypts. The
  // ciphertext is bound to its row id in the AAD, so the (id, ciphertext) pair is what readProtected
  // needs — never the entity id.
  const { results } = await snapshot.database
    .prepare(
      "SELECT id, value_ciphertext FROM directory_identifier WHERE identifier_type = 'ssn' AND deleted_at IS NULL ORDER BY id LIMIT ?1",
    )
    .bind(PROTECTED_LIST_PAGE_LIMIT)
    .all<{ id: string; value_ciphertext: string }>();
  const sampleEntityCiphertexts = results.map((row) => ({
    id: row.id,
    ciphertext: row.value_ciphertext,
  }));

  return {
    snapshot,
    context,
    identifierContext: readContext,
    probePersonId: directoryProbes.probePersonId,
    sampleIdentifierValue: directoryProbes.sampleSsnValue,
    probeGivenName: directoryProbes.probeGivenName,
    probeFamilyName: directoryProbes.probeFamilyName,
    sampleEntityCiphertexts,
  };
}

export const directoryMeasurements: readonly Measurement<DirectoryMeasurementHandle, unknown>[] = [
  {
    name: "directory.find-by-identifier",
    operation: async (handle) => {
      // The conflicts exact-identifier channel: derive the blind index for the SSN value, then match
      // value_blind_index equality — no decrypt, no permission, no audit.
      await findByIdentifier(handle.identifierContext, {
        type: "ssn",
        value: handle.sampleIdentifierValue,
      });
    },
  },
  {
    name: "directory.read-protected-list",
    operation: async (handle) => {
      // Reveal a page of sealed SSN values: each readProtected commits a decrypt-audit row, then
      // decrypts under the full AAD. Models a privileged view revealing a page of identifiers.
      for (const { id, ciphertext } of handle.sampleEntityCiphertexts) {
        await readProtected(
          handle.identifierContext,
          directoryIdentifierValue,
          { value_ciphertext: ciphertext },
          id,
        );
      }
    },
  },
  {
    name: "directory.candidate-generation",
    operation: async (handle) => {
      // Duplicate-candidate generation: the phonetic, trigram-FTS5, and blind-index channels run in
      // parallel and union by entity id. The probe person's name + SSN drives all three channels.
      await findDuplicateCandidates(handle.identifierContext, {
        kind: "person",
        given: handle.probeGivenName,
        family: handle.probeFamilyName,
        identifiers: [{ type: "ssn", value: handle.sampleIdentifierValue }],
      });
    },
  },
  {
    name: "directory.graph-expansion",
    operation: async (handle) => {
      // The related-party expansion: every active edge where the probe entity is either endpoint. The
      // OR over the two indexed endpoint columns resolves as a two-index union (a MULTI-INDEX OR), not
      // a table scan.
      await graphExpansionStatement(handle.snapshot, handle.probePersonId).all();
    },
  },
];

// Nothing is allowlisted: every EXPLAIN'd hot path must walk an index. The blind-index lookup searches
// the (identifier_type, value_blind_index) index; the phonetic channel seeks the code-leading index; the
// edge expansion resolves as a two-index OR union.
export const DIRECTORY_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// The snapshot database is the node:sqlite adapter, so every statement it prepares carries the SQL
// text + bindings the EXPLAIN probe needs (the D1-shaped return type omits them). Recovering the
// runtime shape here keeps the probes on the REAL SQL — no literal copy to drift.
function captured(statement: { bind(...values: unknown[]): unknown }): NodeSqlStatement {
  return statement as unknown as NodeSqlStatement;
}

// The related-party graph-expansion read: every non-deleted edge touching the entity as from OR to.
// The SQL mirrors readEdges' shape minus the temporal upper bound (the EXPLAIN-probed expansion is the
// hot-path skeleton — the OR over the two endpoint indexes is what we hold scan-free at volume).
function graphExpansionStatement(snapshot: LoadedSnapshot, entityId: string): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        "SELECT id, from_entity_id, to_entity_id, edge_type FROM directory_edge WHERE (from_entity_id = ?1 OR to_entity_id = ?1) AND deleted_at IS NULL",
      )
      .bind(entityId),
  );
}

// The find-by-identifier blind-index equality probe SQL — the value_blind_index lookup identifiers.ts
// runs (literal here: identifiers.ts does not export the statement builder, and the value is a derived
// blind index, not a stable probe value). The bound blind-index value is irrelevant to the plan shape;
// a fixed placeholder string suffices for the EXPLAIN.
function findByIdentifierPlanStatement(snapshot: LoadedSnapshot): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        "SELECT entity_id FROM directory_identifier WHERE identifier_type = ?1 AND value_blind_index = ?2 AND deleted_at IS NULL",
      )
      .bind("ssn", "blind-index-probe"),
  );
}

// The phonetic candidate channel's blocking probe: it matches `code` ACROSS all schemes (no scheme
// bound), so it must seek the code-leading index, not the (scheme, code) index. The EXPLAIN here holds
// that seek scan-free at volume — a single code value is the shape the channel's `code IN (...)` reduces
// to per term. (Literal here: search.ts does not export the channel statement, and the code is derived.)
function phoneticChannelPlanStatement(snapshot: LoadedSnapshot): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        "SELECT dn.entity_id FROM directory_name_phonetic_code AS pc JOIN directory_name AS dn ON pc.name_id = dn.id WHERE pc.code = ?1 AND dn.entity_kind = ?2 AND dn.deleted_at IS NULL",
      )
      .bind("phonetic-code-probe", "person"),
  );
}

export function directoryHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { directoryProbes } = snapshot.manifest;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "directory.find-by-identifier",
      statement: findByIdentifierPlanStatement(snapshot),
    },
    {
      label: "directory.candidate-generation.phonetic-channel",
      statement: phoneticChannelPlanStatement(snapshot),
    },
    {
      label: "directory.graph-expansion",
      statement: graphExpansionStatement(snapshot, directoryProbes.probePersonId),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}

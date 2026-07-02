import {
  firmSecretValue,
  incidentDescription,
} from "@magna-carta/data-access/protected-field-registry";
import {
  blindIndexValue,
  protectedField,
  readProtected,
  type ProtectedFieldDeclaration,
  type ProtectedReadContext,
} from "@magna-carta/data-access/protected-fields";
import { getSecret } from "@magna-carta/data-access/secret-statements";
import { normalizeToDigits } from "@magna-carta/encryption/normalize";
import type { FirmId } from "@magna-carta/identifiers/types";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { createProfileFirmKeyProvider } from "./protected-generate.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The protected() crypto chokepoint's volume-shaped measured set: an audited decrypt of a page of
// sealed incident descriptions, a keyed secret read-and-decrypt, and the blind-index derivation cost.
// Each rides the REAL chokepoint (readProtected / getSecret / blindIndexValue), so the AES-GCM decrypt,
// the per-read decrypt-audit write, and the HKDF subkey + HMAC are all on the clock. The cost of these
// operations depends on the firm key (cached after the first unwrap), not on data volume — they are
// per-operation costs, not list scans — so the probe measures the chokepoint, not table growth.
// Directory-scale indexed protected volume rides slice 1·3, where an indexed protected column exists.

// A synthetic blind-index declaration — not registered (1·2 has no indexed protected column). It only
// exercises the derivation path (HKDF index subkey + truncated HMAC) the Directory's indexed
// identifiers will pay per value in slice 1·3. The permission is unused on the blind-index path.
const blindIndexProbeDeclaration: ProtectedFieldDeclaration = protectedField({
  table: "load_profile_probe",
  column: "identifier",
  purpose: "pii",
  permission: incidentDescription.permission,
  blindIndex: {
    name: "ssn",
    normalize: normalizeToDigits,
    lengthBits: 32,
    column: "identifier_blind_index",
  },
});

export interface ProtectedMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly context: FixtureContext;
  // The read context every protected operation runs under: owner permissions (both protected fields),
  // the seed-derived firm key, and the per-firm database for the decrypt-audit writes.
  readonly readContext: ProtectedReadContext;
  // The page of sealed incidents to decrypt, prefetched once (the ciphertext is what a caller already
  // holds from its own row read — the measured cost is the decrypt + audit, not the fetch).
  readonly incidentCiphertexts: readonly { readonly id: string; readonly ciphertext: string }[];
  readonly secretName: string;
  readonly blindIndexSampleValue: string;
}

// The read side derives its audit-row ids + clock from its OWN `${seed}:protected-measure` stream —
// disjoint from both the seeded data and the ledger/matters `${seed}:measure` stream, since the
// decrypt-audit writes share the audit_log table with the matters measurements' audit rows. The firm
// KEY still comes from the base seed — the same key that sealed the cached ciphertexts, so they
// decrypt on replay.
export async function protectedMeasurementHandle(
  snapshot: LoadedSnapshot,
  seed: string,
): Promise<ProtectedMeasurementHandle> {
  const context = fixtureContext(`${seed}:protected-measure`);
  const { protectedProbes } = snapshot.manifest;
  const firmKeyProvider = await createProfileFirmKeyProvider(snapshot.manifest.seed);
  const readContext: ProtectedReadContext = {
    firmId: protectedProbes.firmId as FirmId,
    firmKeyVersion: protectedProbes.firmKeyVersion,
    firmKeyProvider,
    database: snapshot.database,
    effectivePermissions: new Set([incidentDescription.permission, firmSecretValue.permission]),
    actorUserId: null,
    clock: context.clock,
    randomSource: context.randomSource,
  };

  const incidentCiphertexts: { id: string; ciphertext: string }[] = [];
  for (const id of protectedProbes.incidentIds) {
    const { results } = await snapshot.database
      .prepare("SELECT description_ciphertext FROM incident WHERE id = ?1")
      .bind(id)
      .all<{ description_ciphertext: string }>();
    const row = results[0];
    if (row !== undefined) incidentCiphertexts.push({ id, ciphertext: row.description_ciphertext });
  }

  return {
    snapshot,
    context,
    readContext,
    incidentCiphertexts,
    secretName: protectedProbes.secretName,
    blindIndexSampleValue: protectedProbes.blindIndexSampleValue,
  };
}

export const protectedMeasurements: readonly Measurement<ProtectedMeasurementHandle, unknown>[] = [
  {
    name: "protected.incident-decrypt-page",
    operation: async (handle) => {
      // Reveal a page of sealed descriptions: each readProtected commits a decrypt-audit row, then
      // decrypts under the full AAD. Models the diagnostics view revealing a page of incidents.
      for (const { id, ciphertext } of handle.incidentCiphertexts) {
        await readProtected(
          handle.readContext,
          incidentDescription,
          { description_ciphertext: ciphertext },
          id,
        );
      }
    },
  },
  {
    name: "protected.firm-secret-read",
    operation: async (handle) => {
      // A keyed protected read: name lookup (indexed) → audited decrypt.
      await getSecret(handle.readContext, handle.secretName);
    },
  },
  {
    name: "protected.blind-index-compute",
    operation: async (handle) => {
      // The blind-index derivation cost (HKDF index subkey + truncated HMAC) per identifier.
      await blindIndexValue(
        handle.readContext,
        blindIndexProbeDeclaration,
        handle.blindIndexSampleValue,
      );
    },
  },
];

// Both protected reads must walk an index, never scan — nothing is allowlisted.
export const PROTECTED_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// The keyed-read hot paths. The SQL mirrors the secrets store's read (firm_secret by unique name) and
// the by-id incident fetch the decrypt page resolves against; both must SEARCH an index / the primary
// key, never SCAN. (No exported statement builder exists for either read, so the SQL is literal here.)
export function protectedHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { protectedProbes } = snapshot.manifest;
  const probes: readonly { label: string; sql: string; bindings: readonly unknown[] }[] = [
    {
      label: "firm-secret.read-by-name",
      sql: "SELECT id, ciphertext FROM firm_secret WHERE name = ?1",
      bindings: [protectedProbes.secretName],
    },
    {
      label: "incident.read-by-id",
      sql: "SELECT id, description_ciphertext FROM incident WHERE id = ?1",
      bindings: [protectedProbes.incidentIds[0]],
    },
  ];
  return probes.map(({ label, sql, bindings }) => ({
    label,
    details: explainStatement(snapshot.raw, sql, bindings),
  }));
}

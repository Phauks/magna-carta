import { createHash } from "node:crypto";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { incidentDescription } from "@magna-carta/data-access/protected-field-registry";
import { composeProtectedWrite } from "@magna-carta/data-access/protected-fields";
import { putSecret } from "@magna-carta/data-access/secret-statements";
import { importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import {
  createFirmKeyProvider,
  type FirmKeyProvider,
} from "@magna-carta/data-access/firm-key-provider";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { ProtectedVolume } from "./profile.ts";

// The protected-field volume: diagnostic incidents whose descriptions are SEALED at rest, and named
// firm secrets whose values are sealed too. Every write rides the REAL crypto chokepoint
// (composeProtectedWrite / the secrets store), so the encrypt-on-write cost and the stored ciphertext
// shape are production-faithful. The matching audited decrypt-on-read is what the protected
// measurement layer puts on the clock.
//
// THE FIRM KEY IS DERIVED FROM THE SEED, not minted with getRandomValues: the snapshot artifact is
// cached and replayed, so the measurement run must reproduce the exact key that sealed the cached
// ciphertexts. A real firm's key lives wrapped in the control plane, which the per-firm snapshot does
// not model; deriving it from the seed is the load-profile stand-in. (The AES-GCM IV inside each
// ciphertext is still random per value, so the sealed columns are NOT byte-reproducible across two
// fresh generations — only the key is. Determinism assertions therefore exclude the sealed columns.)

// The seed-derived firm-key version. One version this slice mints, matching the worker provisioner.
export const PROTECTED_FIRM_KEY_VERSION = 1;

const BLIND_INDEX_PAGE_LIMIT = 50;

// Probe identifiers the protected measurement layer binds its real operations to — deterministic for a
// given profile + seed, recorded in the snapshot manifest.
export interface ProtectedProbes {
  // The fixture firm the sealed values are bound to (part of every AAD; reproduced on the read side).
  readonly firmId: FirmId;
  readonly firmKeyVersion: number;
  // A page of incident ids whose sealed descriptions the protected list read decrypts.
  readonly incidentIds: readonly string[];
  // A firm-secret name the keyed protected read fetches and decrypts.
  readonly secretName: string;
  // A plausible sensitive identifier the blind-index probe derives an index over (the per-value cost
  // the Directory's indexed identifiers will pay in slice 1·3).
  readonly blindIndexSampleValue: string;
}

export interface ProtectedGenerationResult {
  readonly incidentCount: number;
  readonly firmSecretCount: number;
  readonly probes: ProtectedProbes;
}

// 32 deterministic bytes from the seed under a label — the load-profile stand-in for key material that
// production reads from the wrapped control-plane key. Distinct labels keep the root KEK and the firm
// key independent.
function deterministicKeyBytes(seed: string, label: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(`${seed}:${label}`).digest());
}

// Builds the firm-key provider the seed implies, through the REAL key path: import the derived root
// KEK, AES-KW-wrap the derived firm key, and hand the wrapped form to createFirmKeyProvider. Both the
// generation and measurement sides call this with the snapshot's seed and get the same key, so a
// cached ciphertext sealed at generation decrypts on replay.
export async function createProfileFirmKeyProvider(seed: string): Promise<FirmKeyProvider> {
  const rootKekBase64 = Buffer.from(deterministicKeyBytes(seed, "protected-root-kek")).toString(
    "base64",
  );
  const rootKek = await importRootKek(rootKekBase64);
  const wrappedFirmKey = await wrapFirmKey(
    rootKek,
    deterministicKeyBytes(seed, "protected-firm-key"),
  );
  return createFirmKeyProvider({
    rootKekBase64,
    readWrappedKey: async () => ({
      wrappedFirmKey,
      firmKeyVersion: PROTECTED_FIRM_KEY_VERSION,
    }),
  });
}

// A plausible sensitive identifier (an SSN-shaped value) for the blind-index probe — never a real one.
function sampleSensitiveIdentifier(context: FixtureContext): string {
  const digits = context.faker.string.numeric({ length: 9 });
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

const SECRET_NAME_POOL = [
  "integration.smtp.password",
  "integration.docusign.client_secret",
  "integration.stripe.api_key",
  "integration.quickbooks.refresh_token",
  "integration.lawpay.secret_key",
  "integration.clio.client_secret",
  "webhook.signing_secret",
  "search.container.token",
] as const;

// Generate the protected volume on the same FixtureContext the ledger/practice generation used,
// reusing one mirrored member id as the incidents' reporter (the incident.reported_by column).
export async function generateProtectedVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: ProtectedVolume,
  reportedByMemberId: UserId,
  options: SeedingOptions,
): Promise<ProtectedGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const firmId = newIdentifier("firm", randomSource);
  const firmKeyProvider = await createProfileFirmKeyProvider(context.seed);
  const writeContext = { firmId, firmKeyVersion: PROTECTED_FIRM_KEY_VERSION, firmKeyProvider };

  // --- Sealed incident descriptions through the protected-field chokepoint (encrypted-only: the
  // plaintext `description` column is written NULL, as the live route does). ---
  const incidentIds: string[] = [];
  for (let index = 0; index < volume.incidentCount; index += 1) {
    const incidentId = newIdentifier("incident", randomSource);
    const description = faker.lorem.sentences(faker.number.int({ min: 1, max: 4 }));
    const sealed = await composeProtectedWrite(
      writeContext,
      incidentDescription,
      incidentId,
      description,
    );
    const now = clock.now();
    await commitEffectBatch(
      database,
      {
        statements: [
          database
            .prepare(
              "INSERT INTO incident (id, error_ids, breadcrumbs, description, description_ciphertext, context, reported_by, created_at) " +
                "VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7)",
            )
            .bind(
              incidentId,
              JSON.stringify([]),
              JSON.stringify([]),
              sealed.ciphertextValue,
              JSON.stringify({ route: "/app", appVersion: "0.0.0", clientAt: now }),
              reportedByMemberId,
              now,
            ),
        ],
        outboxMessages: [],
      },
      { now: () => now },
    );
    if (incidentIds.length < BLIND_INDEX_PAGE_LIMIT) incidentIds.push(incidentId);
    clock.advanceMinutes(1);
  }

  // --- Named firm secrets through the secrets store (sealed under the firm secrets key). ---
  for (let index = 0; index < volume.firmSecretCount; index += 1) {
    const name = SECRET_NAME_POOL[index % SECRET_NAME_POOL.length]!;
    // Distinct names past the pool so each is its own row (name is UNIQUE).
    const uniqueName = index < SECRET_NAME_POOL.length ? name : `${name}.${index}`;
    await putSecret(
      { ...writeContext, database, clock },
      uniqueName,
      faker.string.alphanumeric({ length: 48 }),
    );
  }

  if (incidentIds.length === 0) {
    throw new Error("load-profile: protected volume generated no incident to decrypt");
  }

  return {
    incidentCount: volume.incidentCount,
    firmSecretCount: volume.firmSecretCount,
    probes: {
      firmId,
      firmKeyVersion: PROTECTED_FIRM_KEY_VERSION,
      incidentIds,
      secretName: SECRET_NAME_POOL[0],
      blindIndexSampleValue: sampleSensitiveIdentifier(context),
    },
  };
}

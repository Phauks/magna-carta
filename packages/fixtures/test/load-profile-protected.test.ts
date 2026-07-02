import {
  firmSecretValue,
  incidentDescription,
} from "@magna-carta/data-access/protected-field-registry";
import {
  readProtected,
  type ProtectedReadContext,
} from "@magna-carta/data-access/protected-fields";
import { getSecret } from "@magna-carta/data-access/secret-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import {
  createProfileFirmKeyProvider,
  generateProtectedVolume,
} from "../src/load-profile/protected-generate.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";

const TINY = scaleProfile(ledgerVolume, 0.002).protected; // a handful of incidents + a couple secrets

describe("load-profile protected volume", () => {
  it("refuses to run without the seeding opt-in", async () => {
    const local = createLocalPerFirmDatabase();
    const reporter = newIdentifier("user") as UserId;
    await expect(
      generateProtectedVolume(local.database, fixtureContext("guard"), TINY, reporter, {
        allowSeeding: false,
      }),
    ).rejects.toThrow(/allowSeeding/);
  });

  it("seals every incident description and firm secret through the real chokepoint", async () => {
    const local = createLocalPerFirmDatabase();
    const reporter = newIdentifier("user") as UserId;
    const result = await generateProtectedVolume(
      local.database,
      fixtureContext("protected"),
      TINY,
      reporter,
      { allowSeeding: true },
    );

    expect(result.incidentCount).toBe(TINY.incidentCount);
    expect(result.firmSecretCount).toBe(TINY.firmSecretCount);
    expect(result.probes.firmId).toMatch(/^firm_/);
    expect(result.probes.incidentIds.length).toBeGreaterThan(0);

    // Every incident is encrypted-only: a sealed ciphertext, NULL plaintext.
    const { results: incidents } = await local.database
      .prepare("SELECT id, description, description_ciphertext FROM incident")
      .all<{ id: string; description: string | null; description_ciphertext: string | null }>();
    expect(incidents.length).toBe(TINY.incidentCount);
    for (const incident of incidents) {
      expect(incident.description).toBeNull();
      expect(typeof incident.description_ciphertext).toBe("string");
    }

    const { results: secrets } = await local.database
      .prepare("SELECT name, ciphertext FROM firm_secret")
      .all<{ name: string; ciphertext: string }>();
    expect(secrets.length).toBe(TINY.firmSecretCount);
  });

  it("the seed-derived key decrypts the sealed values it wrote (replay correctness)", async () => {
    const local = createLocalPerFirmDatabase();
    const reporter = newIdentifier("user") as UserId;
    const seed = "protected-roundtrip";
    const result = await generateProtectedVolume(
      local.database,
      fixtureContext(seed),
      TINY,
      reporter,
      { allowSeeding: true },
    );

    // A FRESH provider derived from the same seed — the replay path: it must reproduce the exact key.
    const firmKeyProvider = await createProfileFirmKeyProvider(seed);
    const readContext: ProtectedReadContext = {
      firmId: result.probes.firmId,
      firmKeyVersion: result.probes.firmKeyVersion,
      firmKeyProvider,
      database: local.database,
      effectivePermissions: new Set([incidentDescription.permission, firmSecretValue.permission]),
      actorUserId: null,
      clock: fixtureContext(`${seed}:measure`).clock,
    };

    const incidentId = result.probes.incidentIds[0]!;
    const { results } = await local.database
      .prepare("SELECT description_ciphertext FROM incident WHERE id = ?1")
      .bind(incidentId)
      .all<{ description_ciphertext: string }>();
    const description = await readProtected(
      readContext,
      incidentDescription,
      { description_ciphertext: results[0]!.description_ciphertext },
      incidentId,
    );
    expect(description).not.toBeNull();
    expect((description as string).length).toBeGreaterThan(0);

    const secret = await getSecret(readContext, result.probes.secretName);
    expect(secret).not.toBeNull();
    expect((secret as string).length).toBeGreaterThan(0);
  });
});

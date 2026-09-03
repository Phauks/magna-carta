import { directoryIdentifierValue } from "@magna-carta/data-access/protected-field-registry";
import { ProtectedReadForbiddenError } from "@magna-carta/data-access/protected-fields";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { IDENTIFIER_TYPES, type IdentifierType } from "@magna-carta/directory/types";
import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { assemble } from "../src/assemble.ts";
import { DICTIONARY, lookupDictionaryEntry } from "../src/dictionary.ts";
import {
  MEMBER_PROTECTED_SOURCES,
  PROTECTED_IDENTIFIER_SOURCES,
  protectedIdentifierSourcesIn,
} from "../src/protected-bindings.ts";
import { normalizeTemplate } from "../src/normalize.ts";
import { readPackage, readPartText, writePackage } from "../src/ooxml/package.ts";
import { resolveMergeContext } from "../src/resolve.ts";
import type { FieldManifest, ManifestField } from "../src/types.ts";
import { buildDocx, documentXml, paragraphOfRuns } from "./support/docx-fixture.ts";

// A one-paragraph template, normalized exactly as registration would leave it.
function templateOf(text: string): Uint8Array {
  const read = readPackage(buildDocx({ document: documentXml(paragraphOfRuns(text)) }));
  if (!read.ok) throw new Error(`fixture unreadable: ${read.reason}`);
  const normalized = normalizeTemplate(read.value);
  if (normalized.failures.length > 0) {
    throw new Error(`fixture failed normalization: ${JSON.stringify(normalized.failures)}`);
  }
  return writePackage(normalized.parts);
}

function documentTextOf(bytes: Uint8Array): string {
  const read = readPackage(bytes);
  if (!read.ok) throw new Error(`produced document unreadable: ${read.reason}`);
  return readPartText(read.value, "word/document.xml") ?? "";
}

// A protected merge field resolves through the decrypt-permission-plus-audit chokepoint and through
// nothing else, and a member who may not decrypt gets a DECLARED ABSENCE naming the field and the
// permission — not the value, not a silent blank, and not a failed assembly. These are the assertions
// that hold that shape in place; the audit row itself is asserted against the real chokepoint in
// apps/api-worker/test/document-assembly-protected-binding.test.ts, because a decrypt that writes no audit
// row is a property of the chokepoint, not of a fake.

const SEALED_VALUE = "123-45-6789";
const MATTER_ID = "matter_TESTMATTER000000000" as MatterId;
const CLIENT_ENTITY_ID = "directoryPerson_TESTCLIENT000";

const MATTER_ROW = {
  id: MATTER_ID,
  title: "Acme Holdings v. Riverside",
  description: "A contract dispute.",
  status: "open",
  location_id: null,
  client_display_name: "Acme Holdings LLC",
  client_code: "ACME-001",
  matter_number: "2026-0042",
  opened_at: "2026-02-01T09:00:00.000Z",
  e_billing: 0,
};

function partyRow(role: string, entityId: string, displayName: string) {
  return { role, entity_id: entityId, display_name: displayName, kind: "person" };
}

const CLIENT_PARTIES = [
  partyRow("client", CLIENT_ENTITY_ID, "Acme Holdings LLC"),
  partyRow("opposing_party", "directoryPerson_TESTOPPOSING00", "Riverside Partners"),
];

interface RecordedRead {
  readonly sql: string;
}

function databaseOver(parties: readonly ReturnType<typeof partyRow>[]): {
  database: SqlDatabase;
  reads: RecordedRead[];
} {
  const reads: RecordedRead[] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        bind() {
          reads.push({ sql });
          return statement;
        },
        all() {
          return Promise.resolve({
            results: sql.includes("matter_party") ? parties : [MATTER_ROW],
          });
        },
      };
      return statement;
    },
  } as unknown as SqlDatabase;
  return { database, reads };
}

function manifestOf(...keys: readonly string[]): FieldManifest {
  const fields: ManifestField[] = keys.map((key) => ({
    key,
    format: null,
    occurrences: 1,
    parts: ["word/document.xml"],
    forms: ["brace"],
  }));
  return {
    fields,
    totalOccurrences: fields.length,
    unconvertedMergeFields: [],
    legacyFormFields: [],
    unboundContentControls: [],
    unboundFormFields: [],
    blocks: [],
    computedFields: [],
  };
}

// The chokepoint's own refusal, constructed from the same declaration the directory identifier read
// runs under — not a look-alike. What this package catches is the real class, so a test that threw an
// imitation would prove nothing about the path that matters.
function forbidden(): ProtectedReadForbiddenError {
  return new ProtectedReadForbiddenError(directoryIdentifierValue);
}

const SOCIAL_SECURITY_NUMBER_KEY = "client.socialSecurityNumber";

async function resolveWith(
  read: ((entityId: string, identifierType: IdentifierType) => Promise<string | null>) | undefined,
  keys: readonly string[] = [SOCIAL_SECURITY_NUMBER_KEY],
  parties: readonly ReturnType<typeof partyRow>[] = CLIENT_PARTIES,
) {
  const { database, reads } = databaseOver(parties);
  const result = await resolveMergeContext(database, {
    matterId: MATTER_ID,
    manifest: manifestOf(...keys),
    firmName: "Example Firm",
    assembledAt: "2026-08-05T12:00:00.000Z",
    currencyCode: "USD",
    readProtectedIdentifier: read,
  });
  if (!result.ok) throw new Error(`resolution failed: ${result.reason}`);
  return { context: result.context, reads, sources: result.reads };
}

describe("the protected merge sources", () => {
  it("declares one key per sealed identifier type, every one of them protected", () => {
    expect(PROTECTED_IDENTIFIER_SOURCES.map((source) => source.identifierType).sort()).toEqual(
      [...IDENTIFIER_TYPES].sort(),
    );
    for (const source of PROTECTED_IDENTIFIER_SOURCES) {
      const entry = lookupDictionaryEntry(source.key);
      expect(entry, `${source.key} is missing from the dictionary`).toBeDefined();
      expect(entry?.sensitivity).toBe("protected");
      expect(entry?.source).toBe("protectedIdentifier");
      // A visible marker, never a silent blank: a member who may not decrypt has to be able to see
      // where the value would have been.
      expect(entry?.absence).toBe("placeholder");
    }
  });

  it("is the only place the dictionary declares a protected entry", () => {
    const protectedKeys = DICTIONARY.filter((entry) => entry.sensitivity === "protected").map(
      (entry) => entry.key,
    );
    expect(protectedKeys.sort()).toEqual(
      [
        ...PROTECTED_IDENTIFIER_SOURCES.map((source) => source.key),
        ...MEMBER_PROTECTED_SOURCES.map((source) => source.key),
      ].sort(),
    );
  });

  it("recognises only the keys it declares, deduplicated", () => {
    expect(
      protectedIdentifierSourcesIn([
        SOCIAL_SECURITY_NUMBER_KEY,
        SOCIAL_SECURITY_NUMBER_KEY,
        "matter.number",
        "client.displayName",
      ]).map((source) => source.key),
    ).toEqual([SOCIAL_SECURITY_NUMBER_KEY]);
  });
});

describe("a member who holds the decrypt permission", () => {
  it("resolves the sealed value through the reader, for the matter's client", async () => {
    const asked: Array<{ entityId: string; identifierType: string }> = [];
    const { context } = await resolveWith(async (entityId, identifierType) => {
      asked.push({ entityId, identifierType });
      return SEALED_VALUE;
    });

    expect(context.values.get(SOCIAL_SECURITY_NUMBER_KEY)).toEqual({
      kind: "text",
      text: SEALED_VALUE,
    });
    expect(context.absentKeys).not.toContain(SOCIAL_SECURITY_NUMBER_KEY);
    // WHOSE value it is comes from the matter's client party link, never from a second lookup.
    expect(asked).toEqual([{ entityId: CLIENT_ENTITY_ID, identifierType: "ssn" }]);
  });

  it("costs one decrypt per protected key the manifest names, and one party read whatever happens", async () => {
    const keys = PROTECTED_IDENTIFIER_SOURCES.map((source) => source.key);
    let decrypts = 0;
    const { reads } = await resolveWith(async () => {
      decrypts += 1;
      return SEALED_VALUE;
    }, [...keys, ...keys, "matter.number", "opposingParty.displayName"]);

    // Bounded by the template: the manifest names each protected key twice and one decrypt happens per
    // KEY, not per placeholder.
    expect(decrypts).toBe(PROTECTED_IDENTIFIER_SOURCES.length);
    // And the party read the protected sources need is the one the role sources already issued.
    expect(reads.filter((read) => read.sql.includes("matter_party"))).toHaveLength(1);
  });

  it("reports an absence when the client holds no identifier of that type", async () => {
    const { context } = await resolveWith(async () => null);
    expect(context.values.has(SOCIAL_SECURITY_NUMBER_KEY)).toBe(false);
    expect(context.absentKeys).toContain(SOCIAL_SECURITY_NUMBER_KEY);
    expect(context.absenceReasons.get(SOCIAL_SECURITY_NUMBER_KEY)).toContain(
      "Social Security number",
    );
  });
});

describe("a member who does not hold the decrypt permission", () => {
  it("lands on a declared absence naming the field and the permission, and never the value", async () => {
    const { context } = await resolveWith(() => Promise.reject(forbidden()));

    expect(context.values.has(SOCIAL_SECURITY_NUMBER_KEY)).toBe(false);
    expect(context.absentKeys).toContain(SOCIAL_SECURITY_NUMBER_KEY);
    const reason = context.absenceReasons.get(SOCIAL_SECURITY_NUMBER_KEY) ?? "";
    expect(reason).toContain("Social Security number");
    expect(reason).toContain(directoryIdentifierValue.permission);
    expect(reason).not.toContain(SEALED_VALUE);
  });

  it("costs exactly one refused attempt however many protected keys the template binds", async () => {
    let attempts = 0;
    const { context } = await resolveWith(
      () => {
        attempts += 1;
        return Promise.reject(forbidden());
      },
      PROTECTED_IDENTIFIER_SOURCES.map((source) => source.key),
    );

    // One permission guards every sealed identifier, so the first refusal answers the rest.
    expect(attempts).toBe(1);
    for (const source of PROTECTED_IDENTIFIER_SOURCES) {
      expect(context.absentKeys).toContain(source.key);
      expect(context.absenceReasons.get(source.key)).toContain(directoryIdentifierValue.permission);
    }
  });

  it("still produces the document, with a visible marker where the value would be", async () => {
    const { context } = await resolveWith(() => Promise.reject(forbidden()));
    const merged = assemble(
      templateOf("Client tax identity: {{client.socialSecurityNumber}}"),
      context,
    );

    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const text = documentTextOf(merged.bytes);
    expect(text).toContain("[CLIENT&apos;S SOCIAL SECURITY NUMBER]");
    expect(text).not.toContain(SEALED_VALUE);
    expect(text).not.toContain("{{");
    const absence = merged.absences.find((one) => one.key === SOCIAL_SECURITY_NUMBER_KEY);
    expect(absence?.rendered).toBe("placeholder");
    expect(absence?.reason).toContain(directoryIdentifierValue.permission);
  });
});

describe("the resolution refuses to guess", () => {
  it("reports a reason naming the count when the matter links no single client", async () => {
    const twoClients = [
      partyRow("client", "directoryPerson_TESTCLIENTONE0", "Acme Holdings LLC"),
      partyRow("Client", "directoryPerson_TESTCLIENTTWO0", "Acme Subsidiary LLC"),
    ];
    let attempts = 0;
    const { context } = await resolveWith(
      () => {
        attempts += 1;
        return Promise.resolve(SEALED_VALUE);
      },
      [SOCIAL_SECURITY_NUMBER_KEY],
      twoClients,
    );

    // Nothing is decrypted for a subject nobody could name: an unread value cannot leak.
    expect(attempts).toBe(0);
    expect(context.absentKeys).toContain(SOCIAL_SECURITY_NUMBER_KEY);
    expect(context.absenceReasons.get(SOCIAL_SECURITY_NUMBER_KEY)).toContain("2 clients");
  });

  it("reports an absence when the assembly has no way to read protected values at all", async () => {
    const { context } = await resolveWith(undefined);
    expect(context.absentKeys).toContain(SOCIAL_SECURITY_NUMBER_KEY);
    expect(context.absenceReasons.get(SOCIAL_SECURITY_NUMBER_KEY)).toContain("protected value");
  });

  it("does not swallow a failure that is not a refusal", async () => {
    await expect(
      resolveWith(() => Promise.reject(new Error("the firm key provider is unreachable"))),
    ).rejects.toThrow("the firm key provider is unreachable");
  });
});

describe("a resolved protected value stays in memory", () => {
  it("appears in the resolved values and in nothing else the context carries", async () => {
    const { context } = await resolveWith(
      async () => SEALED_VALUE,
      [SOCIAL_SECURITY_NUMBER_KEY, "client.employerIdentificationNumber", "matter.number"],
    );

    // Everything the context hands a caller BESIDES the values map — the absent keys and the reasons —
    // is what gets recorded, reported, and counted. A plaintext in any of it would be a plaintext on a
    // provenance row, in a response, or in a metric.
    const reported = JSON.stringify({
      absentKeys: context.absentKeys,
      absenceReasons: [...context.absenceReasons],
    });
    expect(reported).not.toContain(SEALED_VALUE);
    expect(context.values.get(SOCIAL_SECURITY_NUMBER_KEY)).toEqual({
      kind: "text",
      text: SEALED_VALUE,
    });
  });

  it("never becomes a key a failure names", async () => {
    // matter.number is a `fail` entry; a template asking for it against a matter that has one still
    // assembles, and the failure surface (which names KEYS) has no route to a value in any case.
    const { context } = await resolveWith(async () => SEALED_VALUE);
    const merged = assemble(templateOf("{{client.socialSecurityNumber}}"), context);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(JSON.stringify(merged.absences)).not.toContain(SEALED_VALUE);
    expect(JSON.stringify(merged.expressions)).not.toContain(SEALED_VALUE);
  });
});

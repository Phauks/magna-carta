import { ProtectedReadForbiddenError } from "@magna-carta/data-access/protected-fields";
import { directoryIdentifierValue } from "@magna-carta/data-access/protected-field-registry";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { lookupDictionaryEntry } from "../src/dictionary.ts";
import { resolveMergeContext } from "../src/resolve.ts";
import { STAFFING_SOURCES, staffingKeysFor, staffingSourcesIn } from "../src/staffing-bindings.ts";
import type { FieldManifest, ManifestField } from "../src/types.ts";

// The staffing source: the firm's own people, staffed onto the matter, read the way the party
// subjects are read. The two load-bearing properties mirror the party axis exactly — ambiguity is
// an answer naming the count, and every member subject rides the ONE staffing read — plus one of
// its own: a protected bar number is only ever decrypted for a slot that RESOLVED, so an ambiguous
// staffing slot leaves no decrypt attempt and no audit trail.

const MATTER_ID = "matter_TESTMATTER000000000" as MatterId;

interface StaffingRow {
  role: string;
  member_user_id: string;
  display_name: string | null;
  title?: string | null;
  professional_email?: string | null;
  direct_dial?: string | null;
  entity_id?: string | null;
  name_prefix?: string | null;
  name_given?: string | null;
  name_middle?: string | null;
  name_family?: string | null;
  name_suffix?: string | null;
}

function recordingDatabase(staffing: readonly StaffingRow[]) {
  const reads: { sql: string; bindings: readonly unknown[] }[] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        bind(...bindings: unknown[]) {
          reads.push({ sql, bindings });
          return statement;
        },
        all: () => Promise.resolve({ results: sql.includes("matter_assignment") ? staffing : [] }),
      };
      return statement;
    },
  } as unknown as SqlDatabase;
  return { database, reads };
}

function manifestOf(keys: readonly string[]): FieldManifest {
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
    blocks: [],
    computedFields: [],
  };
}

const input = {
  matterId: MATTER_ID,
  firmName: "Riverside Law LLP",
  assembledAt: "2026-08-07T12:00:00.000Z",
  currencyCode: "USD",
};

async function resolve(
  staffing: readonly StaffingRow[],
  keys: readonly string[],
  readProtectedIdentifier?: (entityId: string, identifierType: string) => Promise<string | null>,
) {
  const { database, reads } = recordingDatabase(staffing);
  const result = await resolveMergeContext(database, {
    ...input,
    manifest: manifestOf(keys),
    ...(readProtectedIdentifier === undefined
      ? {}
      : {
          readProtectedIdentifier: readProtectedIdentifier as never,
        }),
  });
  if (!result.ok) throw new Error(`resolution failed: ${result.detail}`);
  return { context: result.context, sources: result.reads, reads };
}

const RESPONSIBLE: StaffingRow = {
  role: "responsibleAttorney",
  member_user_id: "user_RESPONSIBLE00000000",
  display_name: "Rowan Ashcroft",
  title: "Partner",
  professional_email: "r.ashcroft@marchettivale.example",
  direct_dial: "(775) 555-0114",
  entity_id: "directoryPerson_RESPONSIBLE000000",
  name_prefix: "Dr.",
  name_given: "Rowan",
  name_family: "Ashcroft",
};

// ---------------------------------------------------------------------------------------------
// The dictionary the member subjects contribute
// ---------------------------------------------------------------------------------------------

describe("the staffing sources as dictionary entries", () => {
  it("puts every member subject's key set in the shipped dictionary, all on the staffing read", () => {
    for (const source of STAFFING_SOURCES) {
      for (const key of staffingKeysFor(source)) {
        const entry = lookupDictionaryEntry(key);
        expect(entry, key).toBeDefined();
        expect(entry?.source, key).toBe("staffing");
        expect(entry?.sensitivity, key).toBe("ordinary");
      }
      // Beside them, the one protected fact a pleading states about the firm's own people.
      const barNumber = lookupDictionaryEntry(`${source.key}.barNumber`);
      expect(barNumber?.source).toBe("protectedIdentifier");
      expect(barNumber?.sensitivity).toBe("protected");
    }
  });

  it("recognises staffing keys and nothing else", () => {
    expect(
      staffingSourcesIn(["supervisingAttorney.displayName", "opposingParty.displayName"]).map(
        (source) => source.key,
      ),
    ).toEqual(["supervisingAttorney"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

describe("member subjects resolve from the one staffing read", () => {
  it("fills the responsible attorney's facets from the labelled matter-row arm", async () => {
    const { context, reads } = await resolve(
      [RESPONSIBLE],
      [
        "responsibleAttorney.displayName",
        "responsibleAttorney.title",
        "responsibleAttorney.emailAddress",
        "responsibleAttorney.directDial",
      ],
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.sql).toContain("responsible_member_id");
    expect(context.values.get("responsibleAttorney.displayName")).toEqual({
      kind: "name",
      display: "Rowan Ashcroft",
      isOrganisation: false,
      prefix: "Dr.",
      given: "Rowan",
      family: "Ashcroft",
    });
    expect(context.values.get("responsibleAttorney.title")).toEqual({
      kind: "text",
      text: "Partner",
    });
    expect(context.values.get("responsibleAttorney.emailAddress")).toEqual({
      kind: "text",
      text: "r.ashcroft@marchettivale.example",
    });
    expect(context.values.get("responsibleAttorney.directDial")).toEqual({
      kind: "text",
      text: "(775) 555-0114",
    });
  });

  it("matches an assignment role by its letters and digits, the way party roles match", async () => {
    const { context } = await resolve(
      [
        RESPONSIBLE,
        {
          role: "Supervising Attorney",
          member_user_id: "user_SUPERVISING00000000",
          display_name: "Devon Marchetti",
        },
      ],
      ["supervisingAttorney.displayName"],
    );
    expect(context.values.get("supervisingAttorney.displayName")).toEqual({
      kind: "name",
      display: "Devon Marchetti",
      isOrganisation: false,
    });
  });

  it("answers two supervising attorneys with an absence naming the count, and .all as the way out", async () => {
    const two: StaffingRow[] = [
      {
        role: "supervising_attorney",
        member_user_id: "user_SUPERVISINGA0000000",
        display_name: "Devon Marchetti",
      },
      {
        role: "supervisingAttorney",
        member_user_id: "user_SUPERVISINGB0000000",
        display_name: "Priya Vale",
      },
    ];
    const { context } = await resolve(two, [
      "supervisingAttorney.displayName",
      "supervisingAttorney.all",
    ]);
    expect(context.values.has("supervisingAttorney.displayName")).toBe(false);
    const reason = context.absenceReasons.get("supervisingAttorney.displayName");
    expect(reason).toContain("2 members");
    expect(reason).toContain("supervisingAttorney.all");
    // The reason names counts and roles only — never a candidate the resolution refused to choose.
    expect(reason).not.toContain("Marchetti");
    expect(reason).not.toContain("Vale");
    const collection = context.values.get("supervisingAttorney.all") as {
      items: { fields: Map<string, unknown> }[];
    };
    expect(collection.items).toHaveLength(2);
  });

  it("answers an unstaffed role with an ordinary absence naming the role", async () => {
    const { context } = await resolve([RESPONSIBLE], ["assignedParalegal.displayName"]);
    expect(context.absenceReasons.get("assignedParalegal.displayName")).toContain(
      "staffs no member in the assigned paralegal role",
    );
  });

  it("treats a missing profile fact as an ordinary absence with no reason", async () => {
    const { context } = await resolve(
      [
        RESPONSIBLE,
        {
          role: "billing_attorney",
          member_user_id: "user_BILLING000000000000",
          display_name: "Priya Vale",
        },
      ],
      ["billingAttorney.displayName", "billingAttorney.title"],
    );
    expect(context.values.get("billingAttorney.displayName")).toEqual({
      kind: "name",
      display: "Priya Vale",
      isOrganisation: false,
    });
    expect(context.values.has("billingAttorney.title")).toBe(false);
    expect(context.absenceReasons.has("billingAttorney.title")).toBe(false);
    expect(context.absentKeys).toEqual(["billingAttorney.title"]);
  });
});

// ---------------------------------------------------------------------------------------------
// The protected bar number
// ---------------------------------------------------------------------------------------------

describe("a member's bar number through the protected read path", () => {
  it("decrypts through the chokepoint reader for a slot that resolved, naming the mapped entity", async () => {
    const asked: Array<{ entityId: string; identifierType: string }> = [];
    const { context } = await resolve(
      [RESPONSIBLE],
      ["responsibleAttorney.barNumber"],
      async (entityId, identifierType) => {
        asked.push({ entityId, identifierType });
        return "14212";
      },
    );
    expect(asked).toEqual([
      { entityId: "directoryPerson_RESPONSIBLE000000", identifierType: "bar_number" },
    ]);
    expect(context.values.get("responsibleAttorney.barNumber")).toEqual({
      kind: "text",
      text: "14212",
    });
  });

  it("attempts NO read for an ambiguous slot — an absence before any decrypt, so no audit trail", async () => {
    const asked: string[] = [];
    const two: StaffingRow[] = [
      {
        role: "supervising_attorney",
        member_user_id: "user_SUPERVISINGA0000000",
        display_name: "Devon Marchetti",
        entity_id: "directoryPerson_SUPERVISINGA0000",
      },
      {
        role: "supervising_attorney",
        member_user_id: "user_SUPERVISINGB0000000",
        display_name: "Priya Vale",
        entity_id: "directoryPerson_SUPERVISINGB0000",
      },
    ];
    const { context } = await resolve(two, ["supervisingAttorney.barNumber"], async (entityId) => {
      asked.push(entityId);
      return "14212";
    });
    expect(asked).toEqual([]);
    expect(context.values.has("supervisingAttorney.barNumber")).toBe(false);
    expect(context.absenceReasons.get("supervisingAttorney.barNumber")).toContain("2 members");
  });

  it("reports a member the Directory does not mirror as an absence naming the missing mapping", async () => {
    const asked: string[] = [];
    const unmapped: StaffingRow = { ...RESPONSIBLE, entity_id: null };
    const { context } = await resolve(
      [unmapped],
      ["responsibleAttorney.barNumber"],
      async (entityId) => {
        asked.push(entityId);
        return "14212";
      },
    );
    expect(asked).toEqual([]);
    expect(context.absenceReasons.get("responsibleAttorney.barNumber")).toContain(
      "no Directory record mapped",
    );
  });

  it("turns the chokepoint's refusal into an absence naming the field and the permission", async () => {
    const { context } = await resolve([RESPONSIBLE], ["responsibleAttorney.barNumber"], () =>
      Promise.reject(new ProtectedReadForbiddenError(directoryIdentifierValue)),
    );
    expect(context.values.has("responsibleAttorney.barNumber")).toBe(false);
    const reason = context.absenceReasons.get("responsibleAttorney.barNumber");
    expect(reason).toContain(directoryIdentifierValue.permission);
    expect(reason).toContain("bar number");
  });
});

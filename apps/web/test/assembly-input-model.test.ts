import { describe, expect, it } from "vitest";
import {
  FIXTURE_MERGE_FIELD_CATALOG,
  FIXTURE_TEMPLATE_FIELD_MANIFESTS,
} from "@magna-carta/merge-field-catalog-contract/fixture-catalog";
import type {
  MergeFieldCatalog,
  TemplateFieldManifest,
} from "@magna-carta/merge-field-catalog-contract/types";
import {
  buildAssemblyInputPlan,
  emptyAssemblyInputValues,
  validateAssemblyInput,
} from "../src/lib/document-assembly/assembly-input-model.ts";

/*
 * The assembly input area's model. The behaviours pinned here are the ones whose failure produces a
 * document with a blank where a name should be: which fields get an input at all, which block the
 * assembly when empty, and whether typed text is the kind of value the field takes.
 */
const CATALOG: MergeFieldCatalog = {
  revision: "test",
  entries: [
    {
      key: "matter.number",
      label: "Matter number",
      group: "matter",
      valueType: "text",
      description: "The firm's identifying number.",
      exampleRendering: "2026-0142",
      availability: "automatic",
      availabilityNote: "Filled from the matter record.",
      sensitivity: "ordinary",
      formats: ["plain"],
    },
    {
      key: "matter.retainerAmount",
      label: "Retainer amount",
      group: "matter",
      valueType: "money",
      description: "The retainer the engagement calls for.",
      exampleRendering: "$3,500.00",
      availability: "manual",
      availabilityNote: "Entered when the document is assembled.",
      sensitivity: "ordinary",
      formats: ["currency"],
    },
    {
      key: "matter.courtCaseNumber",
      label: "Court case number",
      group: "matter",
      valueType: "text",
      description: "The number the court assigned.",
      exampleRendering: "PR-2026-004417",
      availability: "conditional",
      availabilityNote: "Filled once the matter has been filed.",
      sensitivity: "ordinary",
      formats: ["plain"],
    },
    {
      key: "client.displayName",
      label: "Client name",
      group: "parties",
      valueType: "text",
      description: "The client's name.",
      exampleRendering: "Marisol Ashcroft",
      availability: "automatic",
      availabilityNote: "Filled from the Directory.",
      sensitivity: "ordinary",
      formats: ["plain"],
    },
    {
      key: "client.taxIdentifier",
      label: "Client tax identifier",
      group: "parties",
      valueType: "text",
      description: "The client's tax identification number.",
      exampleRendering: "Shown only with permission",
      availability: "conditional",
      availabilityNote: "Protected: the read is audited.",
      sensitivity: "protected",
      formats: ["masked"],
    },
    {
      key: "custom.decedentDateOfDeath",
      label: "Decedent date of death",
      group: "custom",
      valueType: "date",
      description: "A firm-defined field.",
      exampleRendering: "January 8, 2026",
      availability: "manual",
      availabilityNote: "Entered when the document is assembled.",
      sensitivity: "ordinary",
      formats: ["long"],
    },
    {
      key: "custom.bonded",
      label: "Personal representative bonded",
      group: "custom",
      valueType: "boolean",
      description: "A firm-defined field.",
      exampleRendering: "Yes",
      availability: "manual",
      availabilityNote: "Entered when the document is assembled.",
      sensitivity: "ordinary",
      formats: ["yesNo"],
    },
  ],
};

const MANIFEST: TemplateFieldManifest = {
  templateVersionId: "test-template",
  templateName: "Test template",
  placeholders: [
    { key: "matter.number", occurrences: 2 },
    { key: "matter.retainerAmount", occurrences: 1, format: "currencyWords" },
    { key: "matter.courtCaseNumber", occurrences: 1 },
    { key: "client.displayName", occurrences: 3 },
    { key: "client.taxIdentifier", occurrences: 1 },
    { key: "custom.decedentDateOfDeath", occurrences: 1 },
    { key: "custom.bonded", occurrences: 1 },
    { key: "matter.filingDeadline", occurrences: 1 },
  ],
  unrecognizedKeys: ["matter.filingDeadline"],
  detectedConversions: [],
};

const PLAN = buildAssemblyInputPlan(MANIFEST, CATALOG);

function fieldFor(key: string) {
  return PLAN.groups.flatMap((group) => group.fields).find((field) => field.key === key);
}

describe("building the input plan", () => {
  it("groups by source in the canonical order", () => {
    expect(PLAN.groups.map((group) => group.group)).toEqual(["matter", "parties", "custom"]);
  });

  it("gives an input only to the fields a person can actually fill", () => {
    expect(fieldFor("matter.retainerAmount")?.requiresEntry).toBe(true);
    expect(fieldFor("custom.decedentDateOfDeath")?.requiresEntry).toBe(true);
    // Automatic fields are context, not inputs — an empty box invites retyping what the firm knows.
    expect(fieldFor("matter.number")?.requiresEntry).toBe(false);
    expect(fieldFor("client.displayName")?.requiresEntry).toBe(false);
  });

  it("offers an input for a conditional field, because the matter's data may not cover it", () => {
    expect(fieldFor("matter.courtCaseNumber")?.requiresEntry).toBe(true);
    // ... but does not BLOCK on it, since the matter's own data may still supply it.
    expect(fieldFor("matter.courtCaseNumber")?.required).toBe(false);
  });

  it("puts the fields needing entry first within their group", () => {
    const matterGroup = PLAN.groups.find((group) => group.group === "matter");
    expect(matterGroup?.fields.map((field) => field.key)).toEqual([
      "matter.retainerAmount",
      "matter.courtCaseNumber",
      "matter.number",
    ]);
  });

  it("keeps an unrecognized placeholder as a visible row, not a silent drop", () => {
    expect(PLAN.unrecognizedKeys).toEqual(["matter.filingDeadline"]);
    const unknown = fieldFor("matter.filingDeadline");
    expect(unknown?.disposition).toBe("unrecognized");
    expect(unknown?.requiresEntry).toBe(false);
  });

  it("names the protected fields, so a surface can warn before an audited read", () => {
    expect(PLAN.protectedKeys).toEqual(["client.taxIdentifier"]);
  });

  it("carries the per-placeholder format and the occurrence count through", () => {
    expect(fieldFor("matter.retainerAmount")?.format).toBe("currencyWords");
    expect(fieldFor("client.displayName")?.occurrences).toBe(3);
  });

  it("counts the work honestly", () => {
    expect(PLAN.entryFieldCount).toBe(5);
    expect(PLAN.automaticFieldCount).toBe(2);
  });

  it("merges a duplicated placeholder into one field, so two inputs cannot disagree", () => {
    const duplicated = buildAssemblyInputPlan(
      {
        ...MANIFEST,
        placeholders: [
          { key: "matter.number", occurrences: 2 },
          { key: "matter.number", occurrences: 3 },
        ],
        unrecognizedKeys: [],
      },
      CATALOG,
    );
    const fields = duplicated.groups.flatMap((group) => group.fields);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.occurrences).toBe(5);
  });

  it("seeds a blank form with exactly the fields that take input", () => {
    expect(Object.keys(emptyAssemblyInputValues(PLAN)).toSorted()).toEqual(
      [
        "custom.bonded",
        "custom.decedentDateOfDeath",
        "matter.courtCaseNumber",
        "matter.retainerAmount",
        "client.taxIdentifier",
      ].toSorted(),
    );
  });
});

describe("validating a filled form", () => {
  const filled = {
    "matter.retainerAmount": "3500.00",
    "matter.courtCaseNumber": "PR-2026-004417",
    "client.taxIdentifier": "masked",
    "custom.decedentDateOfDeath": "2026-01-08",
    "custom.bonded": "yes",
  };

  it("blocks on the unrecognized placeholder however complete the rest is", () => {
    const summary = validateAssemblyInput(PLAN, filled);
    expect(summary.ready).toBe(false);
    expect(summary.issues.some((issue) => issue.key === "matter.filingDeadline")).toBe(true);
  });

  it("passes once the template carries only known fields", () => {
    const clean = buildAssemblyInputPlan(
      {
        ...MANIFEST,
        placeholders: MANIFEST.placeholders.filter((p) => p.key !== "matter.filingDeadline"),
        unrecognizedKeys: [],
      },
      CATALOG,
    );
    expect(validateAssemblyInput(clean, filled).ready).toBe(true);
  });

  it("errors on a required field left empty — a blank must never reach a filing quietly", () => {
    const summary = validateAssemblyInput(PLAN, { ...filled, "matter.retainerAmount": "  " });
    const issue = summary.issues.find((candidate) => candidate.key === "matter.retainerAmount");
    expect(issue?.severity).toBe("error");
    expect(summary.ready).toBe(false);
  });

  it("only WARNS on a conditional field left empty, naming what will happen", () => {
    const summary = validateAssemblyInput(PLAN, { ...filled, "matter.courtCaseNumber": "" });
    const issue = summary.issues.find((candidate) => candidate.key === "matter.courtCaseNumber");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("blank");
  });

  it("rejects an amount that is not an amount", () => {
    const summary = validateAssemblyInput(PLAN, { ...filled, "matter.retainerAmount": "a lot" });
    expect(summary.issues.find((issue) => issue.key === "matter.retainerAmount")?.severity).toBe(
      "error",
    );
  });

  it("rejects an amount with more precision than money has", () => {
    const summary = validateAssemblyInput(PLAN, { ...filled, "matter.retainerAmount": "3500.123" });
    expect(summary.errorCount).toBeGreaterThan(0);
  });

  it("rejects a date that does not exist", () => {
    const summary = validateAssemblyInput(PLAN, {
      ...filled,
      "custom.decedentDateOfDeath": "2026-02-30",
    });
    expect(
      summary.issues.find((issue) => issue.key === "custom.decedentDateOfDeath")?.severity,
    ).toBe("error");
  });

  it("accepts a real leap day", () => {
    const summary = validateAssemblyInput(PLAN, {
      ...filled,
      "custom.decedentDateOfDeath": "2024-02-29",
    });
    expect(summary.issues.some((issue) => issue.key === "custom.decedentDateOfDeath")).toBe(false);
  });

  it("rejects anything but yes or no on a yes-or-no field", () => {
    const summary = validateAssemblyInput(PLAN, { ...filled, "custom.bonded": "maybe" });
    expect(summary.issues.find((issue) => issue.key === "custom.bonded")?.severity).toBe("error");
  });

  it("counts errors and warnings apart, and only errors block", () => {
    const summary = validateAssemblyInput(PLAN, { ...filled, "matter.courtCaseNumber": "" });
    expect(summary.warningCount).toBe(1);
    expect(summary.errorCount).toBe(1); // the unrecognized placeholder, nothing else
  });
});

describe("against the shipped fixtures", () => {
  it("plans every fixture template without losing a placeholder", () => {
    for (const manifest of FIXTURE_TEMPLATE_FIELD_MANIFESTS) {
      const plan = buildAssemblyInputPlan(manifest, FIXTURE_MERGE_FIELD_CATALOG);
      const planned = plan.groups.flatMap((group) => group.fields).length;
      const distinctKeys = new Set(manifest.placeholders.map((p) => p.key)).size;
      expect(planned).toBe(distinctKeys);
    }
  });

  it("reports the probate petition's unrecognized placeholder as a blocking error", () => {
    const manifest = FIXTURE_TEMPLATE_FIELD_MANIFESTS.find(
      (candidate) => candidate.templateVersionId === "probate-petition-v2",
    );
    const plan = buildAssemblyInputPlan(manifest!, FIXTURE_MERGE_FIELD_CATALOG);
    const summary = validateAssemblyInput(plan, emptyAssemblyInputValues(plan));
    expect(summary.ready).toBe(false);
    expect(summary.issues.some((issue) => issue.key === "matter.filingDeadline")).toBe(true);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { prepareFormTemplateVersion } from "../src/pdf-form.ts";
import type { DictionaryEntry } from "../src/dictionary.ts";
import type { FieldManifest } from "../src/types.ts";
import {
  engineReader,
  engineScrub,
  entry,
  intakeFormBytes,
  startEngine,
} from "./support/form-fixture.ts";

// Registering a fillable PDF as a template, against the committed intake-form fixture.
//
// The whole point of these assertions is what the manifest is HONEST about. Two failures have already
// bitten this platform — a Word `FORMTEXT` and a content control showing its placeholder, both of which
// bound nothing, reported no absence, and filed a document that read as finished — and an AcroForm field
// set is the same shape of trap with a hundred more boxes on it.

const DICTIONARY: readonly DictionaryEntry[] = [
  entry("client.displayName", "text", "fail"),
  entry("matter.number", "text", "placeholder"),
  entry("matter.openedOn", "date", "blank", "long"),
  entry("client.county", "text", "placeholder"),
  entry("client.feeWaiver", "boolean", "placeholder", "yesNo"),
];

async function prepare(
  confirmMappings: readonly { readonly fieldName: string; readonly mergeKey: string }[] = [],
  libraryMappings = new Map<string, string>(),
) {
  return prepareFormTemplateVersion(intakeFormBytes(), engineReader, engineScrub, {
    dictionary: DICTIONARY,
    libraryMappings,
    confirmMappings,
  });
}

function manifestOf(result: Awaited<ReturnType<typeof prepare>>): FieldManifest {
  if (!result.ok) throw new Error(`preparation refused: ${result.reason} — ${result.detail}`);
  return result.preparation.manifest;
}

describe("registering a fillable PDF", () => {
  beforeAll(startEngine);

  it("accounts for every field the form declares — none dropped, none defaulted to text", async () => {
    const result = await prepare([{ fieldName: "Client_Name", mergeKey: "client.displayName" }]);
    if (!result.ok) throw new Error(result.detail);
    const manifest = result.preparation.manifest;

    // The fixture declares ten fields. Every one of them is either bound (a manifest field's site) or
    // listed as unbound with a reason — the sum has to be the whole field set, because a field that is
    // in neither list is a box nobody knows is there.
    const boundSites = manifest.fields.flatMap((field) => field.formFields ?? []);
    const accounted = [
      ...boundSites.map((site) => site.fieldName),
      ...manifest.unboundFormFields.map((field) => field.fieldName),
    ].sort();
    expect(accounted).toEqual(
      [
        "Attorney_Signature",
        "Client_Name",
        "Client_Name_Verification",
        "Fee_Waiver_Requested",
        "Filing_County",
        "Petitioner_Address",
        "Previously_Entered",
        "Print_This_Form",
        "Unstated_Box",
        "matter.number",
      ].sort(),
    );
    expect(result.preparation.formFields).toHaveLength(10);
  });

  it("reports a field whose type the form does not state as unclassified, never as text", async () => {
    const manifest = manifestOf(await prepare());
    const unstated = manifest.unboundFormFields.find((field) => field.fieldName === "Unstated_Box");
    expect(unstated).toBeDefined();
    expect(unstated?.kind).toBe("unclassified");
    expect(unstated?.reason).toBe("unclassified");
  });

  it("reports a push button and a signature field as not fillable rather than dropping them", async () => {
    const manifest = manifestOf(await prepare());
    const byName = new Map(manifest.unboundFormFields.map((field) => [field.fieldName, field]));
    expect(byName.get("Print_This_Form")?.reason).toBe("not-fillable");
    expect(byName.get("Print_This_Form")?.kind).toBe("pushButton");
    expect(byName.get("Attorney_Signature")?.reason).toBe("not-fillable");
    expect(byName.get("Attorney_Signature")?.kind).toBe("signature");
  });

  it("NEVER binds a field because its name matches a merge key — it proposes and waits", async () => {
    // `matter.number` is a box on the form whose name IS a merge key, character for character. Nothing
    // fills it in: a name is not a confirmation, and the whole mapping library exists because the firm
    // has to say what its own document means.
    const manifest = manifestOf(await prepare());
    expect(manifest.fields.map((field) => field.key)).not.toContain("matter.number");
    const proposed = manifest.unboundFormFields.find(
      (field) => field.fieldName === "matter.number",
    );
    expect(proposed?.reason).toBe("no-confirmed-mapping");
    expect(proposed?.proposedMergeKey).toBe("matter.number");

    // Confirmed, it binds — and only then.
    const confirmed = manifestOf(
      await prepare([{ fieldName: "matter.number", mergeKey: "matter.number" }]),
    );
    expect(confirmed.fields.map((field) => field.key)).toContain("matter.number");
  });

  it("proposes nothing for a field whose name merely resembles a merge key", async () => {
    const manifest = manifestOf(await prepare());
    const clientName = manifest.unboundFormFields.find(
      (field) => field.fieldName === "Client_Name",
    );
    expect(clientName?.proposedMergeKey).toBe("");
  });

  it("binds a field the firm confirmed on an EARLIER registration, from the library", async () => {
    const library = new Map([["Client_Name", "client.displayName"]]);
    const result = await prepare([], library);
    if (!result.ok) throw new Error(result.detail);
    expect(result.preparation.manifest.fields.map((field) => field.key)).toContain(
      "client.displayName",
    );
    // A binding that came out of the library is not re-confirmed: it is already the firm's answer, and
    // re-writing it would bump its applied count for a registration that confirmed nothing.
    expect(result.preparation.confirmedMergeFieldMappings).toEqual([]);
  });

  it("records the page, the required flag, and the option set on each bound site", async () => {
    const manifest = manifestOf(
      await prepare([
        { fieldName: "Petitioner_Address", mergeKey: "matter.number" },
        { fieldName: "Filing_County", mergeKey: "client.county" },
      ]),
    );
    const address = manifest.fields
      .find((field) => field.key === "matter.number")
      ?.formFields?.find((site) => site.fieldName === "Petitioner_Address");
    expect(address?.required).toBe(true);
    expect(address?.page).toBe(0);

    const county = manifest.fields.find((field) => field.key === "client.county")?.formFields?.[0];
    expect(county?.kind).toBe("choice");
    expect(county?.options).toEqual(["Clark", "Washoe", "Elko"]);
    expect(county?.page).toBe(1);
  });

  it("records two boxes filling one merge field as two sites on one manifest entry", async () => {
    const manifest = manifestOf(
      await prepare([
        { fieldName: "Client_Name", mergeKey: "client.displayName" },
        { fieldName: "Client_Name_Verification", mergeKey: "client.displayName" },
      ]),
    );
    const field = manifest.fields.find((entry_) => entry_.key === "client.displayName");
    expect(field?.occurrences).toBe(2);
    expect(field?.formFields?.map((site) => site.fieldName)).toEqual([
      "Client_Name",
      "Client_Name_Verification",
    ]);
    // The pages the merge field appears on, in the slot a Word manifest uses for part names — the field
    // inspector's question is "where in the document", and a page answers it.
    expect(field?.parts).toEqual(["page 1", "page 2"]);
  });

  it("SAYS SO when the form binds nothing at all", async () => {
    const result = await prepare();
    if (!result.ok) throw new Error(result.detail);
    expect(result.preparation.manifest.fields).toEqual([]);
    const codes = result.preparation.warnings.map((warning) => warning.code);
    expect(codes).toContain("no-placeholders");
    expect(
      result.preparation.warnings.find((warning) => warning.code === "no-placeholders")?.detail,
    ).toMatch(/none of them is bound/);
  });

  it("warns about the boxes nothing fills in, and about the box of no stated type", async () => {
    const result = await prepare([{ fieldName: "Client_Name", mergeKey: "client.displayName" }]);
    if (!result.ok) throw new Error(result.detail);
    const details = result.preparation.warnings
      .filter((warning) => warning.code === "unbound-form-field")
      .map((warning) => warning.detail);
    expect(details.some((detail) => detail.includes('"matter.number"'))).toBe(true);
    expect(details.some((detail) => detail.includes('"Unstated_Box"'))).toBe(true);
  });

  it("refuses a confirmed mapping onto a merge field this firm does not have", async () => {
    const result = await prepare([
      { fieldName: "Client_Name", mergeKey: "custom.customField_gone" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("binding-names-unknown-field");
    expect(result.detail).toContain("custom.customField_gone");
    // The whole field set rides the refusal, so the correction is one edit rather than another upload.
    expect(result.formFields.length).toBeGreaterThan(0);
  });

  it("clears the entries the uploaded form arrived carrying", async () => {
    // The fixture's `Previously_Entered` box holds a name. A template that carried the last client's
    // answers into every document assembled from it is the worst thing this pipeline could do.
    const uploaded = await engineReader(intakeFormBytes());
    expect(uploaded?.find((field) => field.name === "Previously_Entered")?.value).toBe(
      "Rowan Ashcroft",
    );

    const result = await prepare();
    if (!result.ok) throw new Error(result.detail);
    const stored = await engineReader(result.preparation.bytes);
    expect(stored?.find((field) => field.name === "Previously_Entered")?.value ?? null).toBeNull();
    // And the stored form is still a form — a scrub that took the fields out with the metadata would be
    // a template that fills nothing in.
    expect(stored?.length).toBe(10);
  });

  it("refuses a document that is not a readable PDF, and one with no fillable boxes", async () => {
    const notAPdf = await prepareFormTemplateVersion(
      new TextEncoder().encode("this is not a PDF"),
      engineReader,
      engineScrub,
      { dictionary: DICTIONARY },
    );
    expect(notAPdf.ok).toBe(false);
    if (!notAPdf.ok) expect(notAPdf.reason).toBe("not-a-pdf-form");

    const noFields = await prepareFormTemplateVersion(
      intakeFormBytes(),
      async () => [],
      engineScrub,
      { dictionary: DICTIONARY },
    );
    expect(noFields.ok).toBe(false);
    if (!noFields.ok) expect(noFields.reason).toBe("no-form-fields");
  });

  it("carries none of the word-processing constructs, and no expression sites", async () => {
    const manifest = manifestOf(
      await prepare([{ fieldName: "Client_Name", mergeKey: "client.displayName" }]),
    );
    expect(manifest.unconvertedMergeFields).toEqual([]);
    expect(manifest.legacyFormFields).toEqual([]);
    expect(manifest.unboundContentControls).toEqual([]);
    expect(manifest.blocks).toEqual([]);
    expect(manifest.computedFields).toEqual([]);
  });
});
